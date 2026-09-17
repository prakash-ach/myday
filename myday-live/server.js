/* MYDAY — server.
 * Node 18+, no npm packages. Serves the app and keeps each account's data
 * in its own file. Sessions survive restarts.
 *
 *   APP_PORT   default 8080
 *   DATA_DIR   default /var/lib/myday
 *   COOKIE_SECURE=0 only for local http testing
 */

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { DATA_DIR, usersFile, stateFile, readJson, writeJson, verifyPassword } = require("./store");

const PORT = Number(process.env.APP_PORT || process.env.PORT || 8080);
const PUBLIC_DIR = path.join(__dirname, "public");
const SESSIONS = path.join(DATA_DIR, "sessions.json");
const TEAM = path.join(DATA_DIR, "team.json");            // who may see what
const ASSIGNMENTS = path.join(DATA_DIR, "assignments.json"); // tasks handed between people
const SHARED = path.join(DATA_DIR, "shared.json");           // one task, several people
const TTL = Number(process.env.SESSION_TTL_DAYS || 30) * 864e5;
const SECURE = process.env.COOKIE_SECURE !== "0";
const MAX_BODY = 60 * 1024 * 1024;     // photos ride along in the state blob

fs.mkdirSync(DATA_DIR, { recursive: true });

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json" };

/* ---------------- sessions ---------------- */
let sessions = new Map();
(function load() {
  const raw = readJson(SESSIONS);
  if (raw && Array.isArray(raw.list)) {
    const now = Date.now();
    raw.list.forEach((s) => { if (s.expires > now) sessions.set(s.token, s); });
  }
})();
const saveSessions = () => writeJson(SESSIONS, { list: [...sessions.values()] });

function sessionFor(req) {
  const hit = (req.headers.cookie || "").split(";").map((c) => c.trim()).find((c) => c.startsWith("sid="));
  if (!hit) return null;
  const s = sessions.get(decodeURIComponent(hit.slice(4)));
  if (!s) return null;
  if (s.expires < Date.now()) { sessions.delete(s.token); saveSessions(); return null; }
  if (s.expires - Date.now() < TTL - 864e5) { s.expires = Date.now() + TTL; saveSessions(); }
  return s;
}

const cookie = (token, maxAge) =>
  ["sid=" + encodeURIComponent(token), "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=" + maxAge]
    .concat(SECURE ? ["Secure"] : []).join("; ");

/* ---------------- throttle ---------------- */
const attempts = new Map();
const ipOf = (req) => {
  const f = req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"];
  return (typeof f === "string" && f) ? f.split(",")[0].trim() : (req.socket.remoteAddress || "?");
};
function throttled(ip) { const a = attempts.get(ip); return !!(a && a.until > Date.now()); }
function noteFail(ip) {
  const a = attempts.get(ip) || { n: 0, first: Date.now(), until: 0 };
  if (Date.now() - a.first > 9e5) { a.n = 0; a.first = Date.now(); }
  a.n++; if (a.n >= 8) a.until = Date.now() + 9e5;
  attempts.set(ip, a);
}

/* ---------------- helpers ---------------- */
const send = (res, code, body, headers = {}) => {
  res.writeHead(code, Object.assign({ "cache-control": "no-store" }, headers));
  res.end(body);
};
const json = (res, code, obj, headers = {}) =>
  send(res, code, JSON.stringify(obj), Object.assign({ "content-type": "application/json; charset=utf-8" }, headers));

function body(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on("data", (c) => {
      n += c.length;
      if (n > MAX_BODY) { reject(new Error("too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
const isJson = (req) => (req.headers["content-type"] || "").startsWith("application/json");

async function serveStatic(req, res, urlPath) {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const full = path.join(PUBLIC_DIR, rel);
  if (!full.startsWith(PUBLIC_DIR)) return send(res, 403, "Forbidden");
  try {
    const stat = await fsp.stat(full);
    const data = await fsp.readFile(full);
    const type = MIME[path.extname(full).toLowerCase()] || "application/octet-stream";

    /* An update replaces app.js but keeps the name, so a long cache would
       leave people staring at the old app. Instead: tag it, and let the
       browser ask "has this changed?" every time. Unchanged is a 304 with
       no body, so it stays fast, and a new build shows up immediately. */
    const tag = '"' + stat.size.toString(36) + "-" + Math.floor(stat.mtimeMs).toString(36) + '"';
    if (req.headers["if-none-match"] === tag) {
      return send(res, 304, "", { etag: tag, "cache-control": "no-cache" });
    }
    const headers = { "content-type": type, etag: tag, "cache-control": "no-cache" };

    if (/gzip/.test(req.headers["accept-encoding"] || "") && data.length > 4096) {
      return send(res, 200, zlib.gzipSync(data), { ...headers, "content-encoding": "gzip" });
    }
    send(res, 200, data, headers);
  } catch (e) {
    // Unknown path inside a single-page app: hand back the app itself.
    if (!path.extname(rel)) {
      try {
        const html = await fsp.readFile(path.join(PUBLIC_DIR, "index.html"));
        return send(res, 200, html, { "content-type": MIME[".html"] });
      } catch (_) {}
    }
    send(res, 404, "Not found");
  }
}

/* ---------------- team and permissions ----------------
 * The first account created is the owner. The owner decides which
 * sections each of the others can see. This lives on the server so a
 * user cannot grant themselves anything by editing their own browser.
 */
const ALL_SECTIONS = ["dashboard", "today", "tasks", "calendar", "projects",
  "auctions", "development", "notes", "goals", "habits", "settings"];
const STARTER_SECTIONS = ["dashboard", "today", "tasks", "calendar", "notes", "settings"];

function readTeam() {
  const t = readJson(TEAM);
  return t && t.users ? t : { owner: null, users: {} };
}
function writeTeam(t) { writeJson(TEAM, t, true); }

/* The owner is whoever was created first, unless one is already named. */
function ownerName() {
  const team = readTeam();
  if (team.owner) return team.owner;
  const db = readJson(usersFile()) || { users: [] };
  const first = db.users.slice().sort((a, b) =>
    String(a.created || "").localeCompare(String(b.created || "")))[0];
  if (first) { team.owner = first.username; writeTeam(team); return first.username; }
  return null;
}

function sectionsFor(username) {
  if (username === ownerName()) return ALL_SECTIONS.slice();
  const team = readTeam();
  const rec = team.users[username];
  return rec && Array.isArray(rec.sections) ? rec.sections : STARTER_SECTIONS.slice();
}

function userFromSession(s) {
  if (!s) return null;
  const db = readJson(usersFile()) || { users: [] };
  return db.users.find((u) => u.id === s.userId) || null;
}

/* ---------------- routes ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;

  if (p === "/api/login" && req.method === "POST") {
    const ip = ipOf(req);
    if (!isJson(req)) return json(res, 400, { error: "bad request" });
    if (throttled(ip)) return json(res, 429, { error: "Too many attempts. Wait fifteen minutes." });
    let b; try { b = JSON.parse(await body(req)); } catch (e) { return json(res, 400, { error: "bad body" }); }
    const username = String(b.username || "").trim().toLowerCase();
    const password = String(b.password || "");
    const db = readJson(usersFile()) || { users: [] };
    const user = db.users.find((u) => u.username === username);
    if (!user || !verifyPassword(password, user)) {
      noteFail(ip);
      return json(res, 401, { error: "That username and password don't match." });
    }
    attempts.delete(ip);
    const token = crypto.randomBytes(32).toString("base64url");
    sessions.set(token, { token, userId: user.id, expires: Date.now() + TTL });
    saveSessions();
    return json(res, 200, { username: user.username, displayName: user.displayName || user.username },
      { "set-cookie": cookie(token, Math.floor(TTL / 1000)) });
  }

  if (p === "/api/logout" && req.method === "POST") {
    const s = sessionFor(req);
    if (s) { sessions.delete(s.token); saveSessions(); }
    return json(res, 200, { ok: true }, { "set-cookie": cookie("", 0) });
  }

  if (p === "/api/me") {
    const s = sessionFor(req);
    if (!s) return json(res, 401, { error: "not signed in" });
    const db = readJson(usersFile()) || { users: [] };
    const u = db.users.find((x) => x.id === s.userId);
    if (!u) return json(res, 401, { error: "not signed in" });
    return json(res, 200, { username: u.username, displayName: u.displayName || u.username });
  }

  if (p.startsWith("/api/state/")) {
    const s = sessionFor(req);
    if (!s) return json(res, 401, { error: "not signed in" });
    const key = decodeURIComponent(p.slice("/api/state/".length));
    if (!key || key.length > 80) return json(res, 400, { error: "bad key" });

    if (req.method === "GET") {
      const stored = readJson(stateFile(s.userId, key));
      if (!stored) return json(res, 404, { error: "no value" });
      return json(res, 200, { key, value: stored.value });
    }
    if (req.method === "PUT") {
      if (!isJson(req)) return json(res, 400, { error: "bad request" });
      let b; try { b = JSON.parse(await body(req)); } catch (e) { return json(res, 400, { error: "bad body" }); }
      if (typeof b.value !== "string") return json(res, 400, { error: "value must be a string" });
      try { writeJson(stateFile(s.userId, key), { key, value: b.value, at: Date.now() }, key === "myday_proto_v1"); }
      catch (e) { return json(res, 500, { error: "write failed" }); }
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: "method not allowed" });
  }

  /* Who I am, what I can see, and — for the owner — everyone else. */
  if (p === "/api/team" && req.method === "GET") {
    const s2 = sessionFor(req);
    const me = userFromSession(s2);
    if (!me) return json(res, 401, { error: "not signed in" });
    const owner = ownerName();
    const isOwner = me.username === owner;
    const db = readJson(usersFile()) || { users: [] };
    const out = {
      me: { username: me.username, displayName: me.displayName || me.username,
            owner: isOwner, sections: sectionsFor(me.username) },
      all: ALL_SECTIONS,
      people: db.users.map((u) => ({
        username: u.username,
        displayName: u.displayName || u.username,
        owner: u.username === owner,
        sections: isOwner ? sectionsFor(u.username) : undefined,
      })),
    };
    return json(res, 200, out);
  }

  /* The owner changes what someone can see. */
  if (p.startsWith("/api/team/") && req.method === "PUT") {
    const s2 = sessionFor(req);
    const me = userFromSession(s2);
    if (!me) return json(res, 401, { error: "not signed in" });
    if (me.username !== ownerName()) return json(res, 403, { error: "only the owner can do that" });
    const who = decodeURIComponent(p.slice("/api/team/".length));
    if (who === ownerName()) return json(res, 400, { error: "the owner always sees everything" });
    let b; try { b = JSON.parse(await body(req)); } catch (e) { return json(res, 400, { error: "bad body" }); }
    const wanted = Array.isArray(b.sections) ? b.sections.filter((x) => ALL_SECTIONS.indexOf(x) >= 0) : [];
    const team = readTeam();
    team.users[who] = { sections: [...new Set(["settings", ...wanted])] };
    writeTeam(team);
    return json(res, 200, { username: who, sections: team.users[who].sections });
  }

  /* Hand a task to someone else. */
  if (p === "/api/assign" && req.method === "POST") {
    const s2 = sessionFor(req);
    const me = userFromSession(s2);
    if (!me) return json(res, 401, { error: "not signed in" });
    let b; try { b = JSON.parse(await body(req)); } catch (e) { return json(res, 400, { error: "bad body" }); }
    const to = String(b.to || "").trim().toLowerCase();
    const db = readJson(usersFile()) || { users: [] };
    if (!db.users.some((u) => u.username === to)) return json(res, 400, { error: "no such person" });
    if (!b.task || typeof b.task !== "object") return json(res, 400, { error: "no task" });
    const store = readJson(ASSIGNMENTS) || { items: [] };
    store.items.push({
      id: crypto.randomBytes(8).toString("hex"),
      to, from: me.username, fromName: me.displayName || me.username,
      task: b.task, at: Date.now(), claimed: false,
    });
    // Keep it tidy: drop claimed items older than a month.
    store.items = store.items.filter((x) => !x.claimed || x.at > Date.now() - 30 * 864e5);
    writeJson(ASSIGNMENTS, store, true);
    return json(res, 200, { ok: true });
  }

  /* Anything waiting for me. */
  if (p === "/api/assignments" && req.method === "GET") {
    const s2 = sessionFor(req);
    const me = userFromSession(s2);
    if (!me) return json(res, 401, { error: "not signed in" });
    const store = readJson(ASSIGNMENTS) || { items: [] };
    const mine = store.items.filter((x) => x.to === me.username && !x.claimed);
    return json(res, 200, { items: mine });
  }

  if (p === "/api/assignments/claim" && req.method === "POST") {
    const s2 = sessionFor(req);
    const me = userFromSession(s2);
    if (!me) return json(res, 401, { error: "not signed in" });
    let b; try { b = JSON.parse(await body(req)); } catch (e) { return json(res, 400, { error: "bad body" }); }
    const ids = Array.isArray(b.ids) ? b.ids : [];
    const store = readJson(ASSIGNMENTS) || { items: [] };
    store.items.forEach((x) => { if (x.to === me.username && ids.indexOf(x.id) >= 0) x.claimed = true; });
    writeJson(ASSIGNMENTS, store, true);
    return json(res, 200, { ok: true });
  }

  /* ---------------- shared tasks ----------------
   * Unlike an assignment, which is a copy, a shared task is one record
   * that everybody on it reads and writes. Tick it off and everyone
   * sees it ticked, and who did it.
   */
  if (p === "/api/shared" && req.method === "GET") {
    const s2 = sessionFor(req);
    const me = userFromSession(s2);
    if (!me) return json(res, 401, { error: "not signed in" });
    const store = readJson(SHARED) || { items: [] };
    const mine = store.items.filter((x) =>
      x.owner === me.username || (x.members || []).indexOf(me.username) >= 0);
    return json(res, 200, { items: mine, me: me.username });
  }

  if (p === "/api/shared" && req.method === "POST") {
    const s2 = sessionFor(req);
    const me = userFromSession(s2);
    if (!me) return json(res, 401, { error: "not signed in" });
    let b; try { b = JSON.parse(await body(req)); } catch (e) { return json(res, 400, { error: "bad body" }); }
    const store = readJson(SHARED) || { items: [] };
    const db = readJson(usersFile()) || { users: [] };
    const known = (list) => (Array.isArray(list) ? list : [])
      .map((x) => String(x).trim().toLowerCase())
      .filter((x) => db.users.some((u) => u.username === x));

    if (b.id) {
      const item = store.items.find((x) => x.id === b.id);
      if (!item) return json(res, 404, { error: "gone" });
      const isOwner = item.owner === me.username;
      const isMember = (item.members || []).indexOf(me.username) >= 0;
      if (!isOwner && !isMember) return json(res, 403, { error: "not yours" });
      // Anyone on it can edit the details; only the owner changes who's on it.
      ["title", "space", "category", "date", "time", "repeat", "repeatDays",
       "repeatEvery", "repeatUntil", "priority", "note", "subtasks"].forEach((k) => {
        if (b[k] !== undefined) item[k] = b[k];
      });
      if (b.members !== undefined) {
        if (!isOwner) return json(res, 403, { error: "only the owner can change who's on it" });
        item.members = known(b.members).filter((x) => x !== item.owner);
      }
      item.updatedAt = Date.now();
      item.updatedBy = me.username;
      writeJson(SHARED, store, true);
      return json(res, 200, { item });
    }

    const item = {
      id: crypto.randomBytes(8).toString("hex"),
      owner: me.username,
      ownerName: me.displayName || me.username,
      members: known(b.members).filter((x) => x !== me.username),
      title: String(b.title || "").slice(0, 300),
      space: b.space || "company", category: b.category || "",
      date: b.date || "", time: b.time || "", repeat: b.repeat || "none",
      repeatDays: b.repeatDays || null, repeatEvery: b.repeatEvery || 1,
      repeatUntil: b.repeatUntil || null,
      priority: b.priority || "normal", note: b.note || "",
      subtasks: Array.isArray(b.subtasks) ? b.subtasks : [],
      done: {},                       // dateKey -> { by, at }
      createdAt: Date.now(), updatedAt: Date.now(), updatedBy: me.username,
    };
    store.items.push(item);
    writeJson(SHARED, store, true);
    return json(res, 200, { item });
  }

  if (/^\/api\/shared\/[^/]+\/done$/.test(p) && req.method === "POST") {
    const s2 = sessionFor(req);
    const me = userFromSession(s2);
    if (!me) return json(res, 401, { error: "not signed in" });
    const id = decodeURIComponent(p.split("/")[3]);
    let b; try { b = JSON.parse(await body(req)); } catch (e) { return json(res, 400, { error: "bad body" }); }
    const store = readJson(SHARED) || { items: [] };
    const item = store.items.find((x) => x.id === id);
    if (!item) return json(res, 404, { error: "gone" });
    if (item.owner !== me.username && (item.members || []).indexOf(me.username) < 0)
      return json(res, 403, { error: "not yours" });
    const key = String(b.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return json(res, 400, { error: "bad date" });
    item.done = item.done || {};
    if (b.done) item.done[key] = { by: me.displayName || me.username, at: Date.now() };
    else delete item.done[key];
    item.updatedAt = Date.now();
    writeJson(SHARED, store, true);
    return json(res, 200, { item });
  }

  if (/^\/api\/shared\/[^/]+$/.test(p) && req.method === "DELETE") {
    const s2 = sessionFor(req);
    const me = userFromSession(s2);
    if (!me) return json(res, 401, { error: "not signed in" });
    const id = decodeURIComponent(p.split("/")[3]);
    const store = readJson(SHARED) || { items: [] };
    const item = store.items.find((x) => x.id === id);
    if (!item) return json(res, 404, { error: "gone" });
    if (item.owner !== me.username) {
      // A member can take themselves off it instead of deleting it.
      item.members = (item.members || []).filter((x) => x !== me.username);
      writeJson(SHARED, store, true);
      return json(res, 200, { left: true });
    }
    store.items = store.items.filter((x) => x.id !== id);
    writeJson(SHARED, store, true);
    return json(res, 200, { deleted: true });
  }

  if (p === "/api/health") return json(res, 200, { ok: true, accounts: (readJson(usersFile()) || { users: [] }).users.length });

  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
  return serveStatic(req, res, p);
});

setInterval(() => {
  const now = Date.now(); let changed = false;
  sessions.forEach((s, t) => { if (s.expires < now) { sessions.delete(t); changed = true; } });
  if (changed) saveSessions();
}, 36e5).unref();

server.listen(PORT, "127.0.0.1", () => {
  const n = (readJson(usersFile()) || { users: [] }).users.length;
  console.log(`MYDAY on 127.0.0.1:${PORT}, data in ${DATA_DIR}, ${n} account(s)`);
  if (!n) console.log("No accounts yet:  node manage.js add yourname");
});
