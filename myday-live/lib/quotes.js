/* The line at the bottom of the dashboard.
 *
 * One short original line per person per day, on a theme that rotates daily
 * (progress, discipline, business, learning, balance, ...). It's made once
 * and cached for the day, so opening the dashboard costs nothing; "New
 * quote" makes another, up to a few times a day. They're labelled
 * AI-generated and never attributed to anyone.
 *
 * Without the AI (not set up, switched off for this person, or out of
 * allowance) it shows a line from MYDAY's own small list instead, labelled
 * as such — never passed off as AI or as anyone's famous words.
 */

const fs = require("node:fs");
const path = require("node:path");
const ai = require("./ai");

const THEMES = ["progress", "discipline", "business", "learning", "balance", "focus", "resilience", "craft and care"];
const OWN = [
  "Small, finished things add up faster than big, unfinished ones.",
  "Decide what today is for, then let the rest wait its turn.",
  "A clear list in the morning saves a dozen decisions by afternoon.",
  "Good margins come from many careful choices, not one lucky deal.",
  "Learn one thing from today's mistakes and leave the rest behind.",
  "Rest is part of the work, not a reward for finishing it.",
  "Do the hard call first; everything after it gets lighter.",
  "Steady beats fast when the road is long.",
  "Fix the process once instead of fixing the problem every week.",
  "Tomorrow's calm is built from today's follow-ups.",
];
const MAX_REFRESH = () => Math.max(0, Number(process.env.QUOTE_REFRESHES_PER_DAY || 5));
const file = (dir, userId) => path.join(dir, "quote-" + userId + ".json");

function read(dir, userId) {
  try { return JSON.parse(fs.readFileSync(file(dir, userId), "utf8")); } catch (e) { return { history: [] }; }
}
function save(dir, userId, q) { fs.writeFileSync(file(dir, userId), JSON.stringify(q), { mode: 0o600 }); }
const dayNum = (day) => Math.floor(Date.parse(day + "T12:00:00Z") / 864e5);

async function get(dir, userId, { day, allowed, refresh = false }) {
  const q = read(dir, userId);
  const theme = THEMES[dayNum(day) % THEMES.length];
  const fresh = q.day !== day;
  if (fresh) { q.day = day; q.refreshes = 0; q.text = ""; }
  if (refresh && (q.refreshes || 0) >= MAX_REFRESH()) {
    return { ...shape(q, theme), note: `That's today's ${MAX_REFRESH()} new quotes — more tomorrow.` };
  }
  if (q.text && !refresh) return shape(q, theme);

  if (allowed && ai.configured()) {
    try {
      const t = refresh ? THEMES[(dayNum(day) + 1 + (q.refreshes || 0)) % THEMES.length] : theme;
      q.text = await ai.quote(dir, userId, t, (q.history || []).map((h) => h.text));
      q.by = "ai"; q.theme = t;
      if (refresh) q.refreshes = (q.refreshes || 0) + 1;
      q.history = [{ text: q.text, day }, ...(q.history || [])].slice(0, 40);
      save(dir, userId, q);
      return shape(q, t);
    } catch (e) { q.aiError = String(e && e.message || e); }
  }
  const pick = OWN[(dayNum(day) + (q.refreshes || 0) + (refresh ? 1 : 0)) % OWN.length];
  q.text = pick; q.by = "myday"; q.theme = theme;
  if (refresh) q.refreshes = (q.refreshes || 0) + 1;
  save(dir, userId, q);
  return shape(q, theme);
}
const shape = (q, theme) => ({ text: q.text, by: q.by, theme: q.theme || theme, day: q.day, refreshesLeft: Math.max(0, MAX_REFRESH() - (q.refreshes || 0)) });

module.exports = { get, THEMES };
