/* Apple Trade-In values (US).
 *
 * Reads Apple's public trade-in page once a day — politely: it checks
 * Apple's robots.txt first and doesn't read the page if Apple asks automated
 * tools not to; it identifies itself; it never logs in or submits anything.
 * When it can't (or Apple's page changes), you can paste the values instead:
 * from Apple's page, or a list from 9to5Mac / MacRumors — MYDAY reads it.
 *
 * Every time values change, a snapshot is kept, so you see what moved and
 * when. Values are Apple's "up to" amounts (best condition).
 */

const fs = require("node:fs");
const path = require("node:path");

const PAGE = process.env.TRADEIN_PAGE || "https://www.apple.com/shop/trade-in";
const ROBOTS = process.env.TRADEIN_ROBOTS || "https://www.apple.com/robots.txt";
const UA = "MYDAY-TradeInReader/1.0 (personal dashboard; reads Apple's public trade-in page once a day)";
const file = (dir) => path.join(dir, "tradein.json");

function read(dir) {
  try { return JSON.parse(fs.readFileSync(file(dir), "utf8")); } catch (e) { return { snapshots: [], lastCheck: 0, lastError: "", robots: "" }; }
}
function write(dir, d) { const t = file(dir) + ".tmp"; fs.writeFileSync(t, JSON.stringify(d)); fs.renameSync(t, file(dir)); }

const KIND = (m) => /^iphone/i.test(m) ? "iPhone" : /^ipad/i.test(m) ? "iPad" : /^apple watch/i.test(m) ? "Apple Watch"
  : /^(mac|imac|macbook)/i.test(m) ? "Mac" : /galaxy|pixel|samsung|google|motorola|oneplus/i.test(m) ? "Android" : "Other";

/* Pull "Model … Up to $N" (Apple's page) or "Model: $N" (news lists) out of text. */
function parse(text) {
  const t = String(text || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\u00a0/g, " ").replace(/\s+/g, " ");
  const re = /((?:iPhone|iPad|Apple Watch|MacBook (?:Air|Pro)|MacBook|iMac|Mac mini|Mac Studio|Mac Pro|Samsung Galaxy|Galaxy|Google Pixel|Pixel)\b[A-Za-z0-9 ().,+\-‑]{0,48}?)\s*(?:[:\-–—|]\s*)?(?:up to\s*)?\$\s?([\d,]{2,6})\b/gi;
  const out = {};
  let m;
  while ((m = re.exec(t))) {
    let name = m[1].replace(/[\s:\-–—|]+$/, "").replace(/\s+/g, " ").trim()
      // a section heading glued to the first model: "iPhone iPhone 16 Pro Max", "Apple Watch Apple Watch Ultra 2"
      .replace(/^(?:iPhone|iPad|Apple Watch|Mac|Android)\s+(?=(?:iPhone|iPad|Apple Watch|Samsung|Google|Galaxy|Pixel|Mac|iMac)\b)/i, "");
    if (/^(?:iPhone|iPad|Galaxy|Pixel)$/i.test(name)) continue;           // "iPhone up to $650" headlines
    if (/\b(was|from|vs|previous)\b/i.test(name)) continue;
    const v = Number(m[2].replace(/,/g, ""));
    if (!v || v > 5000) continue;
    if (!(name in out)) out[name] = v;                                    // first mention is the current value
  }
  return out;
}

/* Does Apple's robots.txt allow reading the trade-in page? */
async function robotsAllow() {
  try {
    const r = await fetch(ROBOTS, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { ok: true, note: "" };
    const lines = (await r.text()).split(/\r?\n/);
    let applies = false; const dis = [];
    for (const raw of lines) {
      const l = raw.replace(/#.*/, "").trim(); if (!l) continue;
      const [k, ...rest] = l.split(":"); const v = rest.join(":").trim();
      if (/^user-agent$/i.test(k)) applies = v === "*" || /myday/i.test(v);
      else if (applies && /^disallow$/i.test(k) && v) dis.push(v);
    }
    const blocked = dis.find((d) => "/shop/trade-in".startsWith(d.replace(/\*.*$/, "")));
    return blocked ? { ok: false, note: `Apple's robots.txt asks automated tools not to read ${blocked} — use "Paste from Apple" instead` } : { ok: true, note: "" };
  } catch (e) { return { ok: true, note: "" }; }
}

function addSnapshot(d, values, source) {
  const last = d.snapshots[d.snapshots.length - 1];
  const changed = !last || Object.keys(values).some((k) => last.values[k] !== values[k]) || Object.keys(last.values).length !== Object.keys(values).length;
  if (changed) d.snapshots = [...d.snapshots, { at: Date.now(), source, values }].slice(-60);
  return changed;
}

async function check(dir, { manual = false } = {}) {
  const d = read(dir);
  if (!manual && Date.now() - (d.lastCheck || 0) < 20 * 3600e3) return { skipped: true };
  d.lastCheck = Date.now(); d.lastError = "";
  const rb = await robotsAllow();
  d.robots = rb.note;
  if (!rb.ok) { d.lastError = rb.note; write(dir, d); return { error: rb.note }; }
  try {
    const r = await fetch(PAGE, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error("Apple's page answered " + r.status);
    const values = parse(await r.text());
    if (Object.keys(values).filter((k) => /^iphone/i.test(k)).length < 5) throw new Error("couldn't find the values on Apple's page (it may have changed) — use \u201cPaste from Apple\u201d");
    const changed = addSnapshot(d, values, "apple.com");
    write(dir, d);
    return { ok: true, changed, count: Object.keys(values).length };
  } catch (e) {
    d.lastError = String(e && e.message || e); write(dir, d);
    return { error: d.lastError };
  }
}

/* Pasted text: Apple's page copied, or a news list. */
function paste(dir, text, label) {
  const values = parse(text);
  if (Object.keys(values).length < 3) return { error: "Couldn't find models with $ values in that text. Copy the list of models and \u201cUp to $…\u201d amounts." };
  const d = read(dir);
  const merged = { ...((d.snapshots[d.snapshots.length - 1] || {}).values || {}), ...values };
  const changed = addSnapshot(d, merged, label || "pasted");
  write(dir, d);
  return { ok: true, changed, count: Object.keys(values).length };
}

/* The view: current values, what changed and when, grouped by kind. */
function view(dir) {
  const d = read(dir);
  const snaps = d.snapshots, cur = snaps[snaps.length - 1];
  const rows = cur ? Object.entries(cur.values).map(([model, value]) => {
    // the most recent snapshot where this model's value was different
    let prev = null, since = cur.at;
    for (let i = snaps.length - 2; i >= 0; i--) {
      const v = snaps[i].values[model];
      if (v !== undefined && v !== value) { prev = v; since = snaps[i + 1].at; break; }
      if (v === undefined) break;
    }
    const history = snaps.filter((s) => s.values[model] !== undefined).map((s) => ({ at: s.at, v: s.values[model] }))
      .filter((h, i, a) => i === 0 || a[i - 1].v !== h.v).slice(-6);
    return { model, kind: KIND(model), value, prev, change: prev == null ? null : value - prev, since, history };
  }) : [];
  return { rows, updated: cur ? cur.at : 0, source: cur ? cur.source : "", lastCheck: d.lastCheck, lastError: d.lastError, robots: d.robots, page: PAGE, snapshots: snaps.length };
}

function start(dir) {
  const tick = () => check(dir).catch(() => {});
  setTimeout(tick, 90000);
  const t = setInterval(tick, 3 * 3600e3); t.unref();     // looks every 3 h, reads at most once a day
}

module.exports = { check, paste, view, start, parse };
