/* Gmail, read only.
 *
 * No npm packages: everything here uses Node's own https. The client
 * secret is read from /etc/myday/secrets.env, which only root can read,
 * and never leaves the server. The browser only ever sees whether a
 * mailbox is connected and which address it is.
 */

const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SECRETS = process.env.SECRETS_FILE || "/etc/myday/secrets.env";

function secrets() {
  const out = {};
  try {
    fs.readFileSync(SECRETS, "utf8").split("\n").forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    });
  } catch (e) { /* not set up yet */ }
  return out;
}

const isConfigured = () => {
  const s = secrets();
  return !!(s.GOOGLE_CLIENT_ID && s.GOOGLE_CLIENT_SECRET);
};

const redirectUri = () =>
  secrets().GOOGLE_REDIRECT_URI || "https://myday.acharyaandcollc.com/api/google/callback";

/* ---------------- plumbing ---------------- */

function request(options, bodyText) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (e) { /* not json */ }
        if (res.statusCode >= 400) {
          const msg = (parsed && (parsed.error_description || (parsed.error && parsed.error.message) || parsed.error))
            || `http ${res.statusCode}`;
          reject(new Error(String(msg)));
          return;
        }
        resolve(parsed === null ? data : parsed);
      });
    });
    req.on("error", reject);
    req.setTimeout(20000, () => { req.destroy(new Error("Google took too long to answer")); });
    if (bodyText) req.write(bodyText);
    req.end();
  });
}

const form = (obj) =>
  Object.entries(obj).map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");

/* ---------------- the sign-in dance ---------------- */

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

function authUrl(state) {
  const s = secrets();
  const q = form({
    client_id: s.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",      // so we get a refresh token
    prompt: "consent",           // so we get one even on a repeat connect
    include_granted_scopes: "true",
    state,
  });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + q;
}

async function exchangeCode(code) {
  const s = secrets();
  const body = form({
    code,
    client_id: s.GOOGLE_CLIENT_ID,
    client_secret: s.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });
  return request({
    method: "POST", host: "oauth2.googleapis.com", path: "/token",
    headers: { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(body) },
  }, body);
}

async function refresh(refreshToken) {
  const s = secrets();
  const body = form({
    refresh_token: refreshToken,
    client_id: s.GOOGLE_CLIENT_ID,
    client_secret: s.GOOGLE_CLIENT_SECRET,
    grant_type: "refresh_token",
  });
  return request({
    method: "POST", host: "oauth2.googleapis.com", path: "/token",
    headers: { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(body) },
  }, body);
}

/* ---------------- where the tokens live ---------------- */

const tokenFile = (dir, userId) => path.join(dir, "google-" + userId + ".json");

function readTokens(dir, userId) {
  try { return JSON.parse(fs.readFileSync(tokenFile(dir, userId), "utf8")); }
  catch (e) { return null; }
}

function writeTokens(dir, userId, obj) {
  fs.mkdirSync(dir, { recursive: true });
  const f = tokenFile(dir, userId);
  const tmp = f + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
  fs.renameSync(tmp, f);
}

function forget(dir, userId) {
  try { fs.unlinkSync(tokenFile(dir, userId)); } catch (e) {}
}

/* An access token that's good right now, refreshing it if it has run out. */
async function accessToken(dir, userId) {
  const t = readTokens(dir, userId);
  if (!t || !t.refresh_token) throw new Error("no mailbox connected");
  if (t.access_token && t.expires_at && t.expires_at - Date.now() > 60000) return t.access_token;
  const fresh = await refresh(t.refresh_token);
  const next = {
    ...t,
    access_token: fresh.access_token,
    expires_at: Date.now() + (fresh.expires_in || 3600) * 1000,
  };
  writeTokens(dir, userId, next);
  return next.access_token;
}

/* ---------------- reading mail ---------------- */

/* READ-ONLY, by design and by force. MYDAY only ever asks Google for the
   gmail.readonly permission, and this is the only way it talks to Gmail:
   GET requests to read the profile, labels, messages and attachments. It
   never sends, deletes, archives, labels or marks anything read. A path
   outside this list is refused here before anything leaves the server. */
const READ_ONLY_PATHS = /^\/gmail\/v1\/users\/me\/(profile|labels|messages(\?[^/]*)?|messages\/[0-9a-fA-F]{6,40}\?format=full|messages\/[0-9a-fA-F]{6,40}\/attachments\/[A-Za-z0-9_%-]+)$/;
async function api(dir, userId, pathname) {
  if (!READ_ONLY_PATHS.test(pathname)) throw new Error("MYDAY only reads Gmail; refused " + pathname.split("?")[0]);
  const token = await accessToken(dir, userId);
  return request({
    method: "GET", host: "gmail.googleapis.com", path: pathname,
    headers: { authorization: "Bearer " + token },
  });
}

const profile = (dir, userId) => api(dir, userId, "/gmail/v1/users/me/profile");

/* The labels that actually exist in the mailbox. Searching for one that
   doesn't returns nothing, silently, forever — so it's worth checking. */
async function listLabels(dir, userId) {
  const r = await api(dir, userId, "/gmail/v1/users/me/labels");
  return (r.labels || []).map((l) => l.name);
}

async function listMessages(dir, userId, { label, query, max = 10 } = {}) {
  const parts = [];
  if (label) parts.push("label:" + label);
  if (query) parts.push(query);
  const q = parts.join(" ");
  const p = "/gmail/v1/users/me/messages?maxResults=" + Math.min(50, max)
    + (q ? "&q=" + encodeURIComponent(q) : "");
  const r = await api(dir, userId, p);
  return r.messages || [];
}

const b64 = (s) => Buffer.from(String(s || "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

/* Flatten a Gmail message into the shape the task proposer expects. */
function flatten(msg) {
  const headers = {};
  ((msg.payload && msg.payload.headers) || []).forEach((h) => {
    headers[h.name.toLowerCase()] = h.value;
  });

  let text = "";
  const attachments = [];
  const walk = (part) => {
    if (!part) return;
    const mime = part.mimeType || "";
    const name = part.filename || "";
    if (name) {
      attachments.push({ filename: name, mimeType: mime,
        attachmentId: part.body && part.body.attachmentId, size: (part.body && part.body.size) || 0 });
    } else if (mime === "text/plain" && part.body && part.body.data) {
      text += b64(part.body.data) + "\n";
    } else if (mime === "text/html" && part.body && part.body.data && !text) {
      text += b64(part.body.data).replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ") + "\n";
    }
    (part.parts || []).forEach(walk);
  };
  walk(msg.payload);

  const d = headers.date ? new Date(headers.date) : new Date(Number(msg.internalDate || Date.now()));
  return {
    id: msg.id, threadId: msg.threadId,
    from: headers.from || "", to: headers.to || "",
    subject: headers.subject || "",
    date: isNaN(d) ? "" : d.toISOString().slice(0, 10),
    body: text.trim().slice(0, 20000),
    snippet: msg.snippet || "",
    attachments,
    labelIds: (msg.labelIds || []).filter((l) => /^CATEGORY_|^SPAM$|^INBOX$/.test(l)),
    listUnsubscribe: !!headers["list-unsubscribe"],
  };
}

const getMessage = async (dir, userId, id) =>
  flatten(await api(dir, userId, "/gmail/v1/users/me/messages/" + encodeURIComponent(id) + "?format=full"));

async function getAttachment(dir, userId, messageId, attachmentId) {
  const r = await api(dir, userId,
    "/gmail/v1/users/me/messages/" + encodeURIComponent(messageId)
    + "/attachments/" + encodeURIComponent(attachmentId));
  return Buffer.from(String(r.data || "").replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

const newState = () => crypto.randomBytes(24).toString("base64url");

module.exports = {
  isConfigured, redirectUri, authUrl, exchangeCode, refresh,
  readTokens, writeTokens, forget, accessToken,
  profile, listLabels, listMessages, getMessage, getAttachment, flatten, newState, SCOPE,
};
