/* Home Display helpers: today's tasks (read-only), the saved dashboard of
 * each display, and the weather. Nothing here can change a task. */

const fs = require("node:fs");
const path = require("node:path");

const TZ = "America/New_York";
const easternDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const dow = (day) => new Date(day + "T12:00:00Z").getUTCDay();
const addDays = (day, n) => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 864e5);

/* Same rule MYDAY uses to decide whether a repeating task falls on a day. */
function occursOn(t, day) {
  if (!t.repeat || t.repeat === "none") return t.date === day;
  if (!t.date || day < t.date || (t.repeatUntil && day > t.repeatUntil)) return false;
  const a = dow(day);
  switch (t.repeat) {
    case "daily": return true;
    case "weekdays": return a >= 1 && a <= 5;
    case "weekly": {
      const days = t.repeatDays && t.repeatDays.length ? t.repeatDays : [dow(t.date)];
      if (days.indexOf(a) < 0) return false;
      const every = Math.max(1, t.repeatEvery || 1);
      if (every === 1) return true;
      const weekStart = addDays(t.date, -dow(t.date));
      return Math.floor(daysBetween(weekStart, day) / 7) % every === 0;
    }
    case "monthly": return Number(day.slice(8)) === Number(t.date.slice(8));
    default: return false;
  }
}

/* stateValue: the parsed MYDAY state of the owner. */
function today(stateValue) {
  const v = stateValue || {};
  const day = easternDay();
  const locked = !!(v.prefs && v.prefs.personalLock);
  const out = [];
  let hiddenPersonal = 0;
  for (const t of v.tasks || []) {
    if (!t || !t.title) continue;
    const repeating = t.repeat && t.repeat !== "none";
    const due = occursOn(t, day);
    const overdue = !repeating && t.date && t.date < day && !(t.done && t.done[t.date]);
    if (!due && !overdue) continue;
    const space = t.space === "personal" ? "personal" : "company";
    if (locked && space === "personal") { hiddenPersonal++; continue; }
    out.push({
      id: String(t.id || "").slice(0, 60), title: String(t.title).slice(0, 200), time: t.time || "",
      priority: t.priority || "normal", space, overdue: !!overdue, overdueSince: overdue ? t.date : "",
      done: !!(t.done && t.done[overdue ? t.date : day]),
      steps: Array.isArray(t.subtasks) ? t.subtasks.length : 0,
    });
  }
  out.sort((a, b) => (a.done - b.done) || (b.overdue - a.overdue) || (a.time || "99").localeCompare(b.time || "99") || a.title.localeCompare(b.title));
  return { day, tasks: out.slice(0, 60), hiddenPersonal };
}

/* ---------- layouts, one file per display ---------- */
const dirOf = (dataDir) => path.join(dataDir, "home-display");
const validId = (id) => /^[a-f0-9-]{36}$/i.test(String(id || ""));
function readLayout(dataDir, id) {
  if (!validId(id)) return null;
  try { return JSON.parse(fs.readFileSync(path.join(dirOf(dataDir), "layout-" + id.toLowerCase() + ".json"), "utf8")); } catch (e) { return null; }
}
function writeLayout(dataDir, id, layout, who) {
  if (!validId(id)) throw new Error("bad display id");
  if (!layout || !Array.isArray(layout.items) || layout.items.length > 40) throw new Error("bad layout");
  const items = layout.items.map((it) => ({
    id: String(it.id || "").replace(/[^a-z0-9-]/gi, "").slice(0, 40),
    type: String(it.type || "").replace(/[^a-z]/g, "").slice(0, 20),
    x: clampInt(it.x, 0, 11), y: clampInt(it.y, 0, 200), w: clampInt(it.w, 1, 12), h: clampInt(it.h, 1, 40),
    config: it.config && typeof it.config === "object" ? it.config : {},
  })).filter((it) => it.id && it.type).map((it) => ({ ...it, w: Math.min(it.w, 12 - it.x) }));
  const rec = { items, updatedAt: Date.now(), by: who };
  const text = JSON.stringify(rec);
  if (text.length > 200000) throw new Error("layout too large");
  fs.mkdirSync(dirOf(dataDir), { recursive: true });
  const f = path.join(dirOf(dataDir), "layout-" + id.toLowerCase() + ".json"), tmp = f + ".tmp";
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, f);
  return rec;
}
function clampInt(v, lo, hi) { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo; }

/* ---------- weather (Open-Meteo: free, no key) ---------- */
const weatherCache = new Map();
async function weather(lat, lon) {
  lat = Number(lat); lon = Number(lon);
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) throw new Error("bad location");
  const key = lat.toFixed(2) + "," + lon.toFixed(2);
  const hit = weatherCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60000) return hit.data;
  const q = new URLSearchParams({
    latitude: lat.toFixed(4), longitude: lon.toFixed(4), timezone: TZ,
    temperature_unit: "fahrenheit", wind_speed_unit: "mph", precipitation_unit: "inch", forecast_days: "2",
    current: "temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m",
    hourly: "temperature_2m,weather_code,precipitation_probability,is_day",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,weather_code",
  });
  const r = await fetch("https://api.open-meteo.com/v1/forecast?" + q, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error("weather service answered " + r.status);
  const j = await r.json();
  const nowIdx = Math.max(0, (j.hourly.time || []).findIndex((t) => t >= (j.current.time || "").slice(0, 13) + ":00"));
  const data = {
    at: Date.now(),
    now: { temp: j.current.temperature_2m, feels: j.current.apparent_temperature, code: j.current.weather_code,
      day: !!j.current.is_day, wind: j.current.wind_speed_10m, humidity: j.current.relative_humidity_2m },
    today: { hi: j.daily.temperature_2m_max[0], lo: j.daily.temperature_2m_min[0], rain: j.daily.precipitation_probability_max[0],
      sunrise: j.daily.sunrise[0], sunset: j.daily.sunset[0] },
    hours: (j.hourly.time || []).slice(nowIdx + 1, nowIdx + 13).map((t, i) => ({ t, temp: j.hourly.temperature_2m[nowIdx + 1 + i],
      code: j.hourly.weather_code[nowIdx + 1 + i], rain: j.hourly.precipitation_probability[nowIdx + 1 + i], day: !!j.hourly.is_day[nowIdx + 1 + i] })),
  };
  weatherCache.set(key, { at: Date.now(), data });
  if (weatherCache.size > 20) weatherCache.delete(weatherCache.keys().next().value);
  return data;
}
async function geocode(name) {
  const q = String(name || "").trim().slice(0, 80);
  if (q.length < 2) return [];
  const r = await fetch("https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name=" + encodeURIComponent(q), { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error("place search answered " + r.status);
  const j = await r.json();
  return (j.results || []).map((x) => ({ name: [x.name, x.admin1, x.country_code === "US" ? "" : x.country].filter(Boolean).join(", "), lat: x.latitude, lon: x.longitude }));
}

module.exports = { today, occursOn, easternDay, readLayout, writeLayout, weather, geocode };
