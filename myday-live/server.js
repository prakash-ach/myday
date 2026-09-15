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
    const data = await fsp.readFile(full);
    const type = MIME[path.extname(full).toLowerCase()] || "application/octet-stream";
    const cache = rel === "index.html" ? "no-store" : "public, max-age=604800";
    // The bundle is the only big file; gzip it and nothing else matters.
    if (/gzip/.test(req.headers["accept-encoding"] || "") && data.length > 4096) {
      return send(res, 200, zlib.gzipSync(data),
        { "content-type": type, "content-encoding": "gzip", "cache-control": cache });
    }
    send(res, 200, data, { "content-type": type, "cache-control": cache });
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
