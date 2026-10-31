/* Google Nest cameras for Home Display (Smart Device Management API).
 *
 * Secrets, by name only, in /etc/myday/secrets.env:
 *   NEST_PROJECT_ID       the Device Access project ID (required)
 *   NEST_CLIENT_ID        OAuth client linked to that project
 *   NEST_CLIENT_SECRET      (both optional: GOOGLE_CLIENT_ID / _SECRET are used if absent)
 *   NEST_REFRESH_TOKEN    optional: a refresh token made elsewhere. Without it,
 *                         the owner connects once from Home Display and the token
 *                         is kept in DATA_DIR/nest-tokens.json (mode 600).
 *
 * Only the streaming commands are allowed. Nothing here can change a
 * camera's settings, and the token never reaches a browser.
 */

const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const google = require("./google");

const SCOPE = "https://www.googleapis.com/auth/sdm.service";
const API_HOST = "smartdevicemanagement.googleapis.com";
const ALLOWED_COMMANDS = new Set([
  "sdm.devices.commands.CameraLiveStream.GenerateWebRtcStream",
  "sdm.devices.commands.CameraLiveStream.ExtendWebRtcStream",
  "sdm.devices.commands.CameraLiveStream.StopWebRtcStream",
]);

function cfg() {
  const s = google.secrets();
  return {
    project: s.NEST_PROJECT_ID || "",
    clientId: s.NEST_CLIENT_ID || s.GOOGLE_CLIENT_ID || "",
    clientSecret: s.NEST_CLIENT_SECRET || s.GOOGLE_CLIENT_SECRET || "",
    refreshToken: s.NEST_REFRESH_TOKEN || "",
  };
}
const isConfigured = () => { const c = cfg(); return !!(c.project && c.clientId && c.clientSecret); };

function request(options, bodyText) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (e) { /* not json */ }
        if (res.statusCode >= 400) {
          const msg = (parsed && (parsed.error_description || (parsed.error && parsed.error.message) || parsed.error)) || `http ${res.statusCode}`;
          return reject(Object.assign(new Error(String(msg)), { status: res.statusCode }));
        }
        resolve(parsed === null ? data : parsed);
      });
    });
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("Google took too long to answer")));
    if (bodyText) req.write(bodyText);
    req.end();
  });
}
const form = (o) => Object.entries(o).map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");

/* ---------- connecting (owner, once) ---------- */
function authUrl(state) {
  const c = cfg();
  return `https://nestservices.google.com/partnerconnections/${encodeURIComponent(c.project)}/auth?` + form({
    redirect_uri: google.redirectUri(), access_type: "offline", prompt: "consent",
    client_id: c.clientId, response_type: "code", scope: SCOPE, state,
  });
}
function tokenRequest(fields) {
  const c = cfg();
  const b = form({ client_id: c.clientId, client_secret: c.clientSecret, ...fields });
  return request({ method: "POST", host: "oauth2.googleapis.com", path: "/token",
    headers: { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(b) } }, b);
}
const exchangeCode = (code) => tokenRequest({ code, redirect_uri: google.redirectUri(), grant_type: "authorization_code" });

const tokenFile = (dir) => path.join(dir, "nest-tokens.json");
function readTokens(dir) { try { return JSON.parse(fs.readFileSync(tokenFile(dir), "utf8")); } catch (e) { return null; } }
function writeTokens(dir, obj) {
  fs.mkdirSync(dir, { recursive: true });
  const f = tokenFile(dir), tmp = f + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
  fs.renameSync(tmp, f);
}
function forget(dir) { try { fs.unlinkSync(tokenFile(dir)); } catch (e) {} devCache = null; }
const isConnected = (dir) => !!((readTokens(dir) || {}).refresh_token || cfg().refreshToken);

async function accessToken(dir) {
  const t = readTokens(dir) || {};
  const refreshToken = t.refresh_token || cfg().refreshToken;
  if (!refreshToken) throw Object.assign(new Error("Nest isn't connected"), { status: 409 });
  if (t.access_token && t.expires_at - Date.now() > 60000) return t.access_token;
  const fresh = await tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });
  writeTokens(dir, { ...t, refresh_token: t.refresh_token || "", access_token: fresh.access_token,
    expires_at: Date.now() + (fresh.expires_in || 3600) * 1000 });
  return fresh.access_token;
}

/* ---------- cameras ---------- */
let devCache = null;
async function devices(dir) {
  if (devCache && Date.now() - devCache.at < 60000) return devCache.list;
  const token = await accessToken(dir);
  const r = await request({ method: "GET", host: API_HOST,
    path: `/v1/enterprises/${encodeURIComponent(cfg().project)}/devices`,
    headers: { authorization: "Bearer " + token } });
  devCache = { at: Date.now(), list: r.devices || [] };
  return devCache.list;
}

/* The shape Home Display's camera tiles expect. */
async function cameras(dir) {
  const out = [];
  for (const d of await devices(dir)) {
    const tr = d.traits || {};
    const live = tr["sdm.devices.traits.CameraLiveStream"];
    if (!live) continue;
    const id = String(d.name || "").split("/").pop();
    const room = ((d.parentRelations || [])[0] || {}).displayName || "";
    const custom = (tr["sdm.devices.traits.Info"] || {}).customName || "";
    const kind = String(d.type || "").split(".").pop();          // CAMERA, DOORBELL, DISPLAY
    const protos = live.supportedProtocols || [];
    out.push({
      id, name: custom || room || (kind === "DOORBELL" ? "Doorbell" : "Camera"), room, kind,
      protocol: protos.includes("WEB_RTC") ? "webrtc" : "unsupported",
      note: protos.includes("WEB_RTC") ? "" : "This older camera streams RTSP only, which a browser can't play.",
    });
  }
  return out;
}

async function command(dir, deviceId, name, params) {
  if (!ALLOWED_COMMANDS.has(name)) throw new Error("not allowed");
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(deviceId)) throw Object.assign(new Error("unknown camera"), { status: 404 });
  const token = await accessToken(dir);
  const b = JSON.stringify({ command: name, params });
  const r = await request({ method: "POST", host: API_HOST,
    path: `/v1/enterprises/${encodeURIComponent(cfg().project)}/devices/${deviceId}:executeCommand`,
    headers: { authorization: "Bearer " + token, "content-type": "application/json", "content-length": Buffer.byteLength(b) } }, b);
  return (r && r.results) || {};
}

const startStream = (dir, id, offerSdp) => command(dir, id, "sdm.devices.commands.CameraLiveStream.GenerateWebRtcStream", { offerSdp });
const extendStream = (dir, id, mediaSessionId) => command(dir, id, "sdm.devices.commands.CameraLiveStream.ExtendWebRtcStream", { mediaSessionId });
const stopStream = (dir, id, mediaSessionId) => command(dir, id, "sdm.devices.commands.CameraLiveStream.StopWebRtcStream", { mediaSessionId });

module.exports = { isConfigured, isConnected, authUrl, exchangeCode, readTokens, writeTokens, forget,
  cameras, startStream, extendStream, stopStream };
