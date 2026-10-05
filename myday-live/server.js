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
const { propose } = require("./lib/propose");
const { parseOnmInvoice } = require("./lib/extract-onm");
const google = require("./lib/google");
const { readDocument } = require("./lib/documents");
const watcher = require("./lib/watcher");
const ai = require("./lib/ai");

/* What the AI needs to know about a person: their categories, so drafted
   tasks land somewhere real, and their name. */
function aiOptsFor(u) {
  let cats = { company: [], personal: [] };
  try {
    const st = readJson(stateFile(u.id, "myday_proto_v1"));
    let v = st && st.value;
    if (typeof v === "string") v = JSON.parse(v);
    if (v && v.categories) cats = { company: v.categories.company || [], personal: v.categories.personal || [] };
  } catch (e) {}
  return { categories: cats, userName: u.displayName || u.username };
}

/* Senders that should never become a task. Overridable per account. */
const DEFAULT_MUTE = [
  "sales@mobilesentrix.com",
  "konok@mobilesentrix.com",
  "bstock.com", "b-stock.com", "b-stock",
  "subject:auction bid", "subject:you have been outbid", "subject:engagement",
  "noreply@", "no-reply@", "donotreply@",
];

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

/* One-shot values for the Google sign-in round trip. */
const oauthStates = new Map();

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
  "auctions", "automation", "development", "notes", "goals", "habits", "settings"];
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

  /* Everything you have, as one file you can keep anywhere. */
  if (p === "/api/export" && req.method === "GET") {
    const s2 = sessionFor(req);
    const me = userFromSession(s2);
    if (!me) return json(res, 401, { error: "not signed in" });
    const out = { app: "myday", version: 1, exportedAt: new Date().toISOString(),
      username: me.username, keys: {} };
    try {
      fs.readdirSync(DATA_DIR)
        .filter((f) => f.startsWith("state-" + me.id + "-") && f.endsWith(".json"))
        .forEach((f) => {
          const stored = readJson(path.join(DATA_DIR, f));
          if (stored && stored.key) out.keys[stored.key] = stored.value;
        });
    } catch (e) {}
    return send(res, 200, JSON.stringify(out), {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="myday-${me.username}-${new Date().toISOString().slice(0,10)}.json"`,
    });
  }

  /* Put one of those files back. The current data is snapshotted first. */
  if (p === "/api/import" && req.method === "POST") {
    const s2 = sessionFor(req);
    const me = userFromSession(s2);
    if (!me) return json(res, 401, { error: "not signed in" });
    let b; try { b = JSON.parse(await body(req)); } catch (e) { return json(res, 400, { error: "that file isn't readable" }); }
    if (!b || b.app !== "myday" || !b.keys) return json(res, 400, { error: "that isn't a MYDAY export" });
    let n = 0;
    Object.keys(b.keys).forEach((k) => {
      if (typeof b.keys[k] !== "string") return;
      writeJson(stateFile(me.id, k), { key: k, value: b.keys[k], at: Date.now() }, true);
      n++;
    });
    return json(res, 200, { restored: n });
  }

  /* ---------------- automation ----------------
   * Give it an email and it proposes tasks. It saves nothing: the
   * proposals go to the Automation Inbox for you to approve. The same
   * code will run against Gmail once that's connected.
   */
  if (p === "/api/automation/preview" && req.method === "POST") {
    const s2 = sessionFor(req);
    const me = userFromSession(s2);
    if (!me) return json(res, 401, { error: "not signed in" });
    let b; try { b = JSON.parse(await body(req)); } catch (e) { return json(res, 400, { error: "bad body" }); }

    const email = {
      from: String(b.from || ""), subject: String(b.subject || ""),
      body: String(b.body || ""), date: String(b.date || "").slice(0, 10),
      attachmentText: String(b.attachmentText || ""),
    };
    try {
      const r = propose(email, {
        today: new Date().toISOString().slice(0, 10),
        knownSuppliers: Array.isArray(b.knownSuppliers) ? b.knownSuppliers : [],
        supplierAddresses: b.supplierAddresses || {},
        ownDomains: Array.isArray(b.ownDomains) ? b.ownDomains : ["mobilesentrix.com"],
        ownNames: b.ownNames || ["mobilesentrix", "apt-ability"],
        people: b.people || {},
        mute: b.mute || DEFAULT_MUTE,
      });

      /* If it smells like an O&M invoice, pull the line items out too. */
      let auction = null;
      const text = email.attachmentText || email.body;
      if (/Invoice no\.?:/i.test(text) && /Cell Phone/i.test(text)) {
        const parsed = parseOnmInvoice(text);
        if (parsed.rows.length) auction = parsed;
      }
      return json(res, 200, { ...r, auction });
    } catch (e) {
      return json(res, 500, { error: "couldn't read that", detail: String(e && e.message) });
    }
  }

  /* ---------------- connecting Gmail ----------------
   * The secret stays on the server. The browser is told only whether a
   * mailbox is connected and which address it is.
   */
  if (p === "/api/google/status" && req.method === "GET") {
    const s2 = sessionFor(req);
    const me = userFromSession(s2);
    if (!me) return json(res, 401, { error: "not signed in" });
    const configured = google.isConfigured();
    const t = google.readTokens(DATA_DIR, me.id);
    return json(res, 200, {
      configured,
      connected: !!(t && t.refresh_token),
      email: t ? t.email || "" : "",
      connectedAt: t ? t.connectedAt || null : null,
      lastSync: t ? t.lastSync || null : null,
      label: t ? t.label || "" : "",
      redirectUri: google.redirectUri(),
      hint: configured ? "" : "No client details on the server yet. Put them in /etc/myday/secrets.env.",
    });
  }

  if (p === "/api/google/connect" && req.method === "GET") {
    const s2 = sessionFor(req);
    const me = userFromSession(s2);
    if (!me) return json(res, 401, { error: "not signed in" });
    if (!google.isConfigured()) return json(res, 400, { error: "the server has no Google client details yet" });
    // A one-shot state value, tied to this session, so nobody can replay the callback.
    const st = google.newState();
    oauthStates.set(st, { userId: me.id, at: Date.now() });
    for (const [k, v] of oauthStates) if (Date.now() - v.at > 600000) oauthStates.delete(k);
    return json(res, 200, { url: google.authUrl(st) });
  }

  if (p === "/api/google/callback" && req.method === "GET") {
    const code = url.searchParams.get("code");
    const st = url.searchParams.get("state");
    const err = url.searchParams.get("error");
    const page = (title, detail, good) => send(res, 200,
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
       <title>${title}</title>
       <body style="margin:0;background:#0E1116;color:#E9EDF3;font-family:ui-sans-serif,-apple-system,'Segoe UI',Roboto,sans-serif;
         display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px">
         <div style="max-width:420px;text-align:center">
           <div style="font-size:40px">${good ? "✓" : "⚠"}</div>
           <h1 style="font-size:20px;margin:10px 0 6px">${title}</h1>
           <p style="font-size:14px;color:#8C97A8;line-height:1.7;margin:0 0 20px">${detail}</p>
           <a href="/" style="display:inline-block;background:#2FBF87;color:#07130D;text-decoration:none;
             padding:11px 20px;border-radius:10px;font-weight:700;font-size:14px">Back to MYDAY</a>
         </div></body>`,
      { "content-type": "text/html; charset=utf-8" });

    if (err) return page("Gmail wasn't connected", "Google said: " + err.replace(/[<>]/g, ""), false);
    if (!code || !st) return page("Something was missing", "Google didn't send back what was expected.", false);
    const pending = oauthStates.get(st);
    oauthStates.delete(st);
    if (!pending) return page("That link has expired", "Start again from the Automation page.", false);

    try {
      const tok = await google.exchangeCode(code);
      if (!tok.refresh_token) {
        const old = google.readTokens(DATA_DIR, pending.userId);
        if (old && old.refresh_token) tok.refresh_token = old.refresh_token;
      }
      if (!tok.refresh_token) {
        return page("No lasting permission was given",
          "Google didn't return a refresh token, so this would stop working within the hour. Try connecting again.", false);
      }
      google.writeTokens(DATA_DIR, pending.userId, {
        refresh_token: tok.refresh_token,
        access_token: tok.access_token,
        expires_at: Date.now() + (tok.expires_in || 3600) * 1000,
        connectedAt: Date.now(),
      });
      let who = "";
      try {
        const prof = await google.profile(DATA_DIR, pending.userId);
        who = prof.emailAddress || "";
        const t2 = google.readTokens(DATA_DIR, pending.userId);
        google.writeTokens(DATA_DIR, pending.userId, { ...t2, email: who });
      } catch (e) { /* the mailbox is connected even if the name lookup failed */ }
      return page("Gmail connected", who ? `Reading ${who}, and only reading.` : "MYDAY can now read your mail.", true);
    } catch (e) {
      return page("Couldn't finish connecting", String(e && e.message || e).replace(/[<>]/g, ""), false);
    }
  }

  if (p === "/api/google/disconnect" && req.method === "POST") {
    const s2 = sessionFor(req);
    const me = userFromSession(s2);
    if (!me) return json(res, 401, { error: "not signed in" });
    google.forget(DATA_DIR, me.id);
    return json(res, 200, { ok: true });
  }

  /* A look at what's in the mailbox, without saving anything. */
  if (p === "/api/google/messages" && req.method === "GET") {
    const s2 = sessionFor(req);
    const me = userFromSession(s2);
    if (!me) return json(res, 401, { error: "not signed in" });
    try {
      const label = url.searchParams.get("label") || "";
      const max = Math.min(25, Number(url.searchParams.get("max") || 10));
      const ids = await google.listMessages(DATA_DIR, me.id, { label, max });
      const out = [];
      for (const m of ids.slice(0, max)) {
        try { out.push(await google.getMessage(DATA_DIR, me.id, m.id)); }
        catch (e) { out.push({ id: m.id, error: String(e && e.message) }); }
      }
      const t = google.readTokens(DATA_DIR, me.id);
      if (t) google.writeTokens(DATA_DIR, me.id, { ...t, lastSync: Date.now(), label });
      return json(res, 200, { messages: out });
    } catch (e) {
      return json(res, 400, { error: String(e && e.message || e) });
    }
  }

  /* ---------------- scan the mailbox ----------------
   * Finds mail with attachments, downloads the PDFs and spreadsheets,
   * reads them, and returns what it found. Saves nothing: everything
   * comes back for you to approve.
   */
  if (p === "/api/automation/scan" && req.method === "POST") {
    const s2 = sessionFor(req);
    const me = userFromSession(s2);
    if (!me) return json(res, 401, { error: "not signed in" });
    let b; try { b = JSON.parse(await body(req)); } catch (e) { b = {}; }

    const label = String(b.label || "");
    const max = Math.min(15, Number(b.max || 8));
    const seen = new Set(Array.isArray(b.seen) ? b.seen : []);   // fingerprints already imported
    const known = Array.isArray(b.knownSuppliers) ? b.knownSuppliers : [];

    try {
      const ids = await google.listMessages(DATA_DIR, me.id,
        { label, query: "has:attachment", max });

      const found = [];
      const problems = [];
      for (const { id } of ids.slice(0, max)) {
        let msg;
        try { msg = await google.getMessage(DATA_DIR, me.id, id); }
        catch (e) { problems.push({ id, error: String(e && e.message) }); continue; }

        const docs = [];
        for (const att of (msg.attachments || [])) {
          if (!att.attachmentId) continue;
          if (att.size > 12 * 1024 * 1024) {
            problems.push({ subject: msg.subject, error: `${att.filename} is too big to read` });
            continue;
          }
          try {
            const buf = await google.getAttachment(DATA_DIR, me.id, id, att.attachmentId);
            const doc = readDocument(att.filename, att.mimeType, buf);
            doc.alreadyImported = seen.has(doc.sha);
            delete doc.text;                      // keep the response small
            docs.push(doc);
          } catch (e) {
            problems.push({ subject: msg.subject, error: `${att.filename}: ${String(e && e.message)}` });
          }
        }

        const tasks = propose({
          from: msg.from, subject: msg.subject, body: msg.body, date: msg.date,
          attachmentText: "",
        }, {
          today: new Date().toISOString().slice(0, 10),
          knownSuppliers: known,
          supplierAddresses: b.supplierAddresses || {},
          ownDomains: Array.isArray(b.ownDomains) ? b.ownDomains : [],
        });

        found.push({
          id: msg.id, from: msg.from, subject: msg.subject, date: msg.date,
          snippet: msg.snippet, documents: docs,
          tasks: tasks.tasks, classified: tasks.classified, party: tasks.party,
        });
      }

      const t = google.readTokens(DATA_DIR, me.id);
      if (t) google.writeTokens(DATA_DIR, me.id, { ...t, lastSync: Date.now(), label });

      return json(res, 200, {
        scanned: found.length,
        withDocuments: found.filter((f) => f.documents.length).length,
        rowsFound: found.reduce((n, f) => n + f.documents.reduce((m, d) => m + (d.rows ? d.rows.length : 0), 0), 0),
        messages: found, problems,
      });
    } catch (e) {
      return json(res, 400, { error: String(e && e.message || e) });
    }
  }

  /* What the watcher has found, waiting for you. */
  if (p === "/api/automation/feed" && req.method === "GET") {
    const s2 = sessionFor(req);
    const me = userFromSession(s2);
    if (!me) return json(res, 401, { error: "not signed in" });
    const feed = watcher.readFeed(DATA_DIR, me.id);
    const open = (feed.items || []).filter((x) => !x.decided);
    return json(res, 200, {
      items: open.slice(0, 60),
      handled: (feed.items || []).length - open.length,
      stats: feed.stats || {},
      log: (feed.log || []).slice(0, 12),
      watching: !!google.readTokens(DATA_DIR, me.id),
    });
  }

  /* Run a pass right now rather than waiting for the next one. */
  if (p === "/api/automation/sweep" && req.method === "POST") {
    const s2 = sessionFor(req);
    const me = userFromSession(s2);
    if (!me) return json(res, 401, { error: "not signed in" });
    let b; try { b = JSON.parse(await body(req)); } catch (e) { b = {}; }
    try {
      const r = await watcher.sweep(DATA_DIR, me.id, {
        ...aiOptsFor(me),
        label: b.label || "", max: Math.min(30, b.max || 20),
        knownSuppliers: b.knownSuppliers || [],
        supplierAddresses: b.supplierAddresses || {},
        ownDomains: b.ownDomains || ["mobilesentrix.com"],
        ownNames: b.ownNames || ["mobilesentrix", "apt-ability"],
        people: b.people || {},
        mute: b.mute || DEFAULT_MUTE,
      });
      return json(res, 200, r);
    } catch (e) {
      return json(res, 400, { error: String(e && e.message || e) });
    }
  }

  /* Approve or ignore something in the feed. */
  if (p === "/api/automation/decide" && req.method === "POST") {
    const s2 = sessionFor(req);
    const me = userFromSession(s2);
    if (!me) return json(res, 401, { error: "not signed in" });
    let b; try { b = JSON.parse(await body(req)); } catch (e) { return json(res, 400, { error: "bad body" }); }
    const feed = watcher.readFeed(DATA_DIR, me.id);
    const ids = new Set(Array.isArray(b.ids) ? b.ids : [b.id]);
    let n = 0;
    (feed.items || []).forEach((x) => {
      if (ids.has(x.id) && !x.decided) { x.decided = b.decision || "handled"; x.decidedAt = Date.now(); n++; }
    });
    watcher.writeFeed(DATA_DIR, me.id, feed);
    return json(res, 200, { updated: n });
  }

  /* The assistant. The key stays here; the browser only ever sees answers. */
  if (p === "/api/ai/status" && req.method === "GET") {
    const me = userFromSession(sessionFor(req));
    if (!me) return json(res, 401, { error: "not signed in" });
    const u = ai.usage(DATA_DIR, me.id);
    return json(res, 200, { configured: ai.configured(), model: ai.MODEL(), usedToday: u.calls, limit: ai.LIMIT() });
  }
  if (p === "/api/ai/chat" && req.method === "POST") {
    const me = userFromSession(sessionFor(req));
    if (!me) return json(res, 401, { error: "not signed in" });
    let b; try { b = JSON.parse(await body(req)); } catch (e) { return json(res, 400, { error: "bad body" }); }
    try {
      const r = await ai.chat(DATA_DIR, me.id, {
        messages: b.messages, context: b.context, assistantName: b.assistantName,
        userName: me.displayName || me.username,
      });
      return json(res, 200, r);
    } catch (e) {
      return json(res, 400, { error: String(e && e.message || e) });
    }
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

/* Keep reading in the background, whether anyone is looking or not. */
watcher.start(DATA_DIR, {
  everyMinutes: Number(process.env.WATCH_MINUTES || 3),
  usersFile, readJson,
  settingsFor: (u) => {
    const stored = readJson(stateFile(u.id, "myday_automation"));
    let cfg = {};
    try { cfg = stored && stored.value ? JSON.parse(stored.value) : {}; } catch (e) {}
    const t = google.readTokens(DATA_DIR, u.id);
    return {
      label: (t && t.label) || cfg.label || "",
      max: 20,
      paused: !!cfg.paused,
      knownSuppliers: cfg.knownSuppliers || [],
      supplierAddresses: cfg.supplierAddresses || {},
      ownDomains: cfg.ownDomains || ["mobilesentrix.com"],
      ownNames: cfg.ownNames || ["mobilesentrix", "apt-ability"],
      people: cfg.people || {},
      mute: cfg.mute || DEFAULT_MUTE,
      ...aiOptsFor(u),
    };
  },
});

server.listen(PORT, "127.0.0.1", () => {
  const n = (readJson(usersFile()) || { users: [] }).users.length;
  console.log(`MYDAY on 127.0.0.1:${PORT}, data in ${DATA_DIR}, ${n} account(s)`);
  if (!n) console.log("No accounts yet:  node manage.js add yourname");
});
