// Connection settings for the household backend (Nest proxy, events, photo
// sync). The existing multi-device auth module can expose
// window.HomeAuth.getDeviceToken(); otherwise a token stored at pairing time
// under kv 'deviceToken' is used. Tokens are never put in URLs.
import { settings } from './settings.js';
import { kv } from './db.js';

function serverOrigin() {
  const s = settings.values.serverUrl?.trim();
  if (s) return s.replace(/\/+$/, '');
  if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin;
  return null; // opened from file:// with no server configured
}

export const CONFIG = {
  get apiBase() {
    if (window.HOME_DISPLAY_API_BASE) return window.HOME_DISPLAY_API_BASE;
    const o = serverOrigin();
    return o ? `${o}/api` : null;
  },
  get wsUrl() {
    if (window.HOME_DISPLAY_WS_URL) return window.HOME_DISPLAY_WS_URL;
    const o = serverOrigin();
    if (!o) return null;
    const u = new URL(o);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = `${u.pathname.replace(/\/+$/, '')}/ws`;
    return u.toString();
  },
  async getAuthToken() {
    if (typeof window.HomeAuth?.getDeviceToken === 'function') return window.HomeAuth.getDeviceToken();
    return kv.get('deviceToken');
  },
};

export async function apiFetch(path, { method = 'GET', json, body, raw = false } = {}) {
  const base = CONFIG.apiBase;
  if (!base) throw Object.assign(new Error('No server configured'), { status: 0, unconfigured: true });
  const token = await CONFIG.getAuthToken();
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + path, {
    method, headers, body: json !== undefined ? JSON.stringify(json) : body, cache: 'no-store',
  });
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} → ${res.status}`), { status: res.status });
  if (raw) return res;
  return res.status === 204 ? null : res.json();
}
