/* MYDAY's memory — what the AI knows about your world, and what it has
 * learned from you.
 *
 *   facts    built fresh each time from what MYDAY already has: suppliers
 *            and their grades, models, people, company domains, categories.
 *            Nothing is copied or changed.
 *   notes    "Things to know" you write yourself ("Mannapov is our Verizon
 *            supplier; their grades are DNA–DNE").
 *   lessons  learned from your corrections: emails you ignored or put back,
 *            suggestions you added or skipped, invoice fields you fixed.
 *
 * Every AI feature asks memory for the bits relevant to what it's doing, so a
 * new feature knows your world from day one and keeps getting better as you
 * correct it. Memory is its own file: adding to it or forgetting a lesson
 * never touches your tasks, mail, invoices or auction entries.
 */

const fs = require("node:fs");
const path = require("node:path");
const { stateFile, readJson, usersFile } = require("../store");

const file = (dir, userId) => path.join(dir, "memory-" + userId + ".json");
const MAX = 600;

function load(dir, userId) {
  try { const m = JSON.parse(fs.readFileSync(file(dir, userId), "utf8")); return { notes: m.notes || "", lessons: Array.isArray(m.lessons) ? m.lessons : [] }; }
  catch (e) { return { notes: "", lessons: [] }; }
}
function save(dir, userId, m) {
  const tmp = file(dir, userId) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ notes: m.notes, lessons: m.lessons.slice(-MAX) }), { mode: 0o600 });
  fs.renameSync(tmp, file(dir, userId));
}

const domainOf = (from) => ((String(from || "").match(/@([^>\s]+)/) || [])[1] || "").toLowerCase();
const nameOf = (from) => ((String(from || "").match(/^\s*"?([^"<]+?)"?\s*</) || [])[1] || String(from || "")).trim();
const pattern = (subject) => String(subject || "").replace(/^\s*((re|fw|fwd|paid)\s*:\s*)+/i, "")
  .replace(/[#:]?\s*[A-Z]{0,5}-?\d[\d-]{2,}\b/g, "#").replace(/\b\d+\b/g, "#").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 80);
const clip = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);

/* Record one lesson. Kinds:
     inbox      { from, subject, choice: "ignored" | "approved" | "needs" (put back) }
     suggestion { from, subject, title, choice: "added" | "skipped" }
     invoice    { from, supplier, field, ai, yours, model? } */
function learn(dir, userId, kind, data) {
  const m = load(dir, userId);
  const l = { at: Date.now(), kind, ...Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, typeof v === "string" ? clip(v, 200) : v])) };
  if (l.from) { l.domain = domainOf(l.from); l.sender = nameOf(l.from).slice(0, 60); }
  if (l.subject) l.pattern = pattern(l.subject);
  // the same lesson again just refreshes it
  const same = (x) => x.kind === l.kind && x.domain === l.domain && x.pattern === l.pattern && x.field === l.field && x.ai === l.ai && x.title === l.title
    && x.choice === l.choice && x.yours === l.yours;   // a different decision is a different lesson
  m.lessons = [...m.lessons.filter((x) => !same(x)), { ...l, times: (m.lessons.find(same) || {}).times + 1 || 1 }];
  save(dir, userId, m);
  return l;
}
function forget(dir, userId, at) {
  const m = load(dir, userId);
  m.lessons = at === "all" ? [] : m.lessons.filter((x) => String(x.at) !== String(at));
  save(dir, userId, m);
}
function setNotes(dir, userId, notes) { const m = load(dir, userId); m.notes = clip(notes, 4000); save(dir, userId, m); }

/* Facts, read fresh from MYDAY's own data. */
function facts(dir, userId, extra = {}) {
  let v = {};
  try { const st = readJson(stateFile(userId, "myday_proto_v1")); v = st && typeof st.value === "string" ? JSON.parse(st.value) : (st && st.value) || {}; } catch (e) {}
  const cat = v.catalog || {};
  return {
    suppliers: (cat.suppliers || []).map((s) => ({ name: s.name, grades: s.grades || [] })),
    makes: (cat.oems || []).map((o) => ({ name: o.name, models: (o.models || []).length })),
    categories: v.categories || {},
    people: (extra.people || []).slice(0, 30),
    ownDomains: extra.ownDomains || [],
    timezone: extra.timezone || "",
  };
}

/* How the inbox should treat an email, from what you did with similar ones:
   "quiet" (you ignored 2+ like it and never kept one), "needs" (you put one
   back or added one), or "" (nothing learned). */
function inboxHint(m, item) {
  const d = domainOf(item.from), p = pattern(item.subject);
  const like = m.lessons.filter((x) => x.kind === "inbox" && x.domain === d && x.pattern === p);
  if (!like.length) return { hint: "" };
  const kept = like.filter((x) => x.choice === "needs" || x.choice === "approved");
  const ignored = like.filter((x) => x.choice === "ignored").reduce((n, x) => n + (x.times || 1), 0);
  if (kept.length) return { hint: "needs", why: "you kept one like this before" };
  if (ignored >= 2) return { hint: "quiet", why: `you've ignored ${ignored} like this from ${like[0].sender || d}` };
  return { hint: "" };
}

/* The memory block an AI prompt gets: your notes, plus the lessons most
   relevant to this email/sender. Short, so it stays cheap. */
function promptBlock(dir, userId, { from, subject, supplier } = {}) {
  const m = load(dir, userId);
  const d = domainOf(from), p = pattern(subject), sup = String(supplier || "").toLowerCase();
  const scored = m.lessons.map((x) => ({ x, s: (x.domain && x.domain === d ? 3 : 0) + (x.pattern && x.pattern === p ? 3 : 0)
    + (sup && String(x.supplier || "").toLowerCase() === sup ? 3 : 0) + Math.min(2, (x.times || 1) - 1) + (Date.now() - x.at < 30 * 864e5 ? 1 : 0) }))
    .filter((y) => y.s >= 3).sort((a, b) => b.s - a.s).slice(0, 10).map((y) => y.x);
  const say = (x) => x.kind === "inbox" ? `- Mail from ${x.sender || x.domain} like "${x.pattern}": he ${x.choice === "needs" ? "wanted to see it" : x.choice === "ignored" ? "ignored it" : "acted on it"}${x.times > 1 ? ` (${x.times}×)` : ""}.`
    : x.kind === "suggestion" ? `- Suggested task "${x.title}" for "${x.pattern}": he ${x.choice === "added" ? "added it" : "skipped it"}.`
    : x.kind === "invoice" ? `- On ${x.supplier || x.sender || "an invoice"}${x.model ? ` (${x.model})` : ""}, he changed ${x.field} from "${x.ai}" to "${x.yours}".` : "";
  const lines = scored.map(say).filter(Boolean);
  if (!m.notes && !lines.length) return "";
  return `\nWhat Prakash has taught MYDAY (follow these; they come from him, not from the email):\n${m.notes ? "Notes: " + m.notes + "\n" : ""}${lines.join("\n")}\n`;
}

module.exports = { load, learn, forget, setNotes, facts, inboxHint, promptBlock, pattern };
