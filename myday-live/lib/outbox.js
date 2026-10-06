/* Getting automatic tasks into My Day, safely.
 *
 * The browser saves your whole MYDAY in one go, last save wins. So the
 * server can't simply write a task into it while a tab is open — the tab's
 * next save would wipe it. Instead:
 *
 *   - Each automatic task goes into this outbox with a fixed id worked out
 *     from the email or attachment, so it can only ever exist once.
 *   - An open MYDAY tab collects new ones every few seconds, adds them, and
 *     says so ("seen"). From then on they're ordinary tasks you can edit or
 *     delete, and they're never put back.
 *   - With no tab open, the server writes them in itself.
 *   - Any save that arrives without a not-yet-seen task gets it added back,
 *     so a stale tab can't lose one.
 */

const fs = require("node:fs");
const path = require("node:path");
const { stateFile, readJson, writeJson } = require("../store");

const KEY = "myday_proto_v1";
const file = (dir, userId) => path.join(dir, "outbox-" + userId + ".json");
const lastPoll = new Map();                 // userId → when a tab last checked in

function read(dir, userId) {
  try { const o = JSON.parse(fs.readFileSync(file(dir, userId), "utf8")); return Array.isArray(o.entries) ? o : { entries: [] }; }
  catch (e) { return { entries: [] }; }
}
function save(dir, userId, o) {
  // keep everything from the last 60 days; ids stay remembered even longer so nothing is recreated
  const cutoff = Date.now() - 60 * 864e5;
  o.entries = o.entries.filter((e) => e.at > cutoff || !e.seen).slice(-2000);
  o.ids = [...new Set([...(o.ids || []), ...o.entries.map((e) => e.id)])].slice(-10000);
  const tmp = file(dir, userId) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(o), { mode: 0o600 });
  fs.renameSync(tmp, file(dir, userId));
}

/* Add a task unless one with this id was ever created. Returns true if new. */
function add(dir, userId, task, meta) {
  const o = read(dir, userId);
  if ((o.ids || []).includes(task.id) || o.entries.some((e) => e.id === task.id)) return false;
  o.entries.push({ id: task.id, task, at: Date.now(), seen: false, ...meta });
  save(dir, userId, o);
  return true;
}
const pending = (dir, userId) => read(dir, userId).entries.filter((e) => !e.seen);

function markSeen(dir, userId, ids) {
  const o = read(dir, userId);
  const set = new Set(ids);
  let n = 0;
  o.entries.forEach((e) => { if (set.has(e.id) && !e.seen) { e.seen = Date.now(); n++; } });
  if (n) save(dir, userId, o);
  return n;
}

const touch = (userId) => lastPoll.set(userId, Date.now());
const tabOpen = (userId) => Date.now() - (lastPoll.get(userId) || 0) < Number(process.env.OUTBOX_TAB_MS || 90000);

/* Put any not-yet-seen tasks into a saved MYDAY value (a JSON string).
   Returns the new string, or the same one if nothing was missing. */
function inject(dir, userId, valueString) {
  const waiting = pending(dir, userId);
  if (!waiting.length) return valueString;
  let v;
  try { v = JSON.parse(valueString); } catch (e) { return valueString; }
  if (!v || !Array.isArray(v.tasks)) return valueString;
  const have = new Set(v.tasks.map((t) => t.id));
  const missing = waiting.filter((e) => !have.has(e.id)).map((e) => e.task);
  if (!missing.length) return valueString;
  v.tasks = [...v.tasks, ...missing];
  return JSON.stringify(v);
}

/* With no tab open, write waiting tasks straight into saved MYDAY. */
function deliver(dir, userId) {
  if (tabOpen(userId)) return 0;
  const waiting = pending(dir, userId);
  if (!waiting.length) return 0;
  const f = stateFile(userId, KEY);
  const stored = readJson(f);
  if (!stored || typeof stored.value !== "string") return 0;   // never opened MYDAY: the first tab will collect them
  const next = inject(dir, userId, stored.value);
  if (next === stored.value) return 0;
  writeJson(f, { key: KEY, value: next, at: Date.now(), rev: (stored.rev || 0) + 1 }, true);   // new version, so open tabs pull it in
  return waiting.length;
}

module.exports = { add, pending, markSeen, touch, tabOpen, inject, deliver, read, KEY };
