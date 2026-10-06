/* Putting two devices' changes together.
 *
 * MYDAY saves your whole account in one go. If the iPad and the desktop both
 * have it open, each save used to replace the other's. Now every save says
 * which version it started from (base), and when someone else saved in
 * between (theirs), the two are merged with the incoming save (mine):
 *
 *   - Lists of things with ids (tasks, entries, notes, projects, ...) are
 *     merged item by item: added on either side → kept; deleted on one side
 *     and untouched on the other → deleted; edited on both → field by field,
 *     and where both changed the same field, the incoming save wins.
 *   - Settings-like objects (prefs, catalog, categories) are merged key by key
 *     the same way.
 *   - Anything else: whichever side changed it; if both, the incoming save.
 *
 * Without a base (the server restarted and forgot it), nothing is ever
 * dropped: both sides' items are kept.
 */

const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
const isIdList = (x) => Array.isArray(x) && x.length > 0 && x.every((i) => isObj(i) && (typeof i.id === "string" || typeof i.id === "number"));

function mergeValue(base, theirs, mine) {
  if (same(theirs, mine)) return mine;
  if (base === undefined) {
    // No common ancestor: keep everything from both.
    if ((isIdList(theirs) || Array.isArray(theirs) && !theirs.length) && (isIdList(mine) || Array.isArray(mine) && !mine.length)) return mergeList([], theirs, mine, true);
    if (isObj(theirs) && isObj(mine)) return mergeObject({}, theirs, mine, true);
    return mine;
  }
  if (same(base, mine)) return theirs;      // only they changed it
  if (same(base, theirs)) return mine;      // only I changed it
  // Both changed it.
  const listish = (x) => isIdList(x) || (Array.isArray(x) && x.length === 0);
  if (listish(base) && listish(theirs) && listish(mine) && (isIdList(theirs) || isIdList(mine) || isIdList(base))) return mergeList(base || [], theirs, mine, false);
  if (isObj(base) && isObj(theirs) && isObj(mine)) return mergeObject(base, theirs, mine, false);
  return mine;
}

function mergeObject(base, theirs, mine, noBase) {
  const out = {};
  for (const k of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
    const inT = k in theirs, inM = k in mine, inB = !noBase && k in base;
    if (inT && inM) out[k] = mergeValue(noBase ? undefined : base[k], theirs[k], mine[k]);
    else if (inM) { if (!(inB && same(base[k], mine[k]))) out[k] = mine[k]; }          // they removed it and I didn't touch it → gone
    else if (inT) { if (!(inB && same(base[k], theirs[k]))) out[k] = theirs[k]; }
  }
  return out;
}

function mergeList(base, theirs, mine, noBase) {
  const B = new Map(base.map((x) => [String(x.id), x]));
  const T = new Map(theirs.map((x) => [String(x.id), x]));
  const M = new Map(mine.map((x) => [String(x.id), x]));
  const out = [];
  // Keep my order, then add anything only they have, in their order.
  const order = [...mine.map((x) => String(x.id)), ...theirs.map((x) => String(x.id)).filter((id) => !M.has(id))];
  for (const id of order) {
    const b = B.get(id), t = T.get(id), m = M.get(id);
    if (t && m) out.push(noBase || !b ? mergeValue(noBase ? undefined : b, t, m) : mergeValue(b, t, m));
    else if (m) { if (noBase || !b || !same(b, m)) out.push(m); }          // they deleted it: gone unless I changed it
    else if (t) { if (noBase || !b || !same(b, t)) out.push(t); }          // I deleted it: gone unless they changed it
  }
  return out;
}

/* Strings in, string out. */
function merge3(baseStr, theirsStr, mineStr) {
  let base, theirs, mine;
  try { theirs = JSON.parse(theirsStr); mine = JSON.parse(mineStr); } catch (e) { return mineStr; }
  try { base = baseStr ? JSON.parse(baseStr) : undefined; } catch (e) { base = undefined; }
  if (!isObj(theirs) || !isObj(mine)) return mineStr;
  const out = base === undefined ? mergeObject({}, theirs, mine, true) : mergeObject(isObj(base) ? base : {}, theirs, mine, false);
  out.updatedAt = Math.max(Number(theirs.updatedAt) || 0, Number(mine.updatedAt) || 0, Date.now());
  return JSON.stringify(out);
}

module.exports = { merge3, mergeValue };
