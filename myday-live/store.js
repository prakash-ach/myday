/* Shared bits: where files live, how passwords are hashed. */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DATA_DIR = process.env.DATA_DIR || "/var/lib/myday";

const usersFile = () => path.join(DATA_DIR, "users.json");
const stateFile = (userId, key) =>
  path.join(DATA_DIR, "state-" + userId + "-" + String(key).replace(/[^a-z0-9_-]/gi, "_") + ".json");

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return null;
  }
}

/* Keep a copy of what's there BEFORE overwriting it.
 *
 * The old version copied the file afterwards, so the backup held the new
 * content — useless if the new content was the problem. This keeps the
 * last known-good state instead, and only if it parses, so a damaged
 * file can never become the thing you restore from.
 */
function snapshot(file) {
  try {
    if (!fs.existsSync(file)) return;
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) return;
    JSON.parse(raw);                       // unreadable? then it isn't worth keeping
    const dir = path.join(path.dirname(file), "snapshots");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const base = path.basename(file, ".json");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(path.join(dir, base + "." + stamp + ".json"), raw, { mode: 0o600 });
    prune(dir, base);
  } catch (e) { /* a backup failing must never stop a save */ }
}

/* Everything from the last two hours, then one an hour for two days,
 * then one a day for two months. Enough to go back to "just before I
 * broke it" without filling the disk.
 */
function prune(dir, base) {
  try {
    const now = Date.now();
    const files = fs.readdirSync(dir)
      .filter((f) => f.startsWith(base + ".") && f.endsWith(".json"))
      .map((f) => {
        const iso = f.slice(base.length + 1, -5).replace(
          /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
          "$1-$2-$3T$4:$5:$6.$7Z");
        return { f, at: Date.parse(iso) || 0 };
      })
      .filter((x) => x.at)
      .sort((a, b) => b.at - a.at);

    const keep = new Set();
    const buckets = new Set();
    files.forEach((x) => {
      const age = now - x.at;
      if (age < 2 * 3600e3) { keep.add(x.f); return; }                 // last two hours: all
      if (age < 48 * 3600e3) {                                          // two days: hourly
        const b = "h" + Math.floor(x.at / 3600e3);
        if (!buckets.has(b)) { buckets.add(b); keep.add(x.f); }
        return;
      }
      if (age < 60 * 864e5) {                                           // two months: daily
        const b = "d" + Math.floor(x.at / 864e5);
        if (!buckets.has(b)) { buckets.add(b); keep.add(x.f); }
      }
    });

    files.forEach((x) => { if (!keep.has(x.f)) { try { fs.unlinkSync(path.join(dir, x.f)); } catch (e) {} } });
  } catch (e) {}
}

function writeJson(file, obj, backup) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (backup) snapshot(file);              // the old copy, before the new one lands
  const tmp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
  fs.renameSync(tmp, file);                // atomic: no half-written file, ever
}

/* scrypt, with the parameters stored alongside the hash so they can be raised later */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64");
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024,
  }).toString("base64");
  return { salt, hash, scrypt: SCRYPT, passwordSetAt: new Date().toISOString() };
}

function verifyPassword(password, user) {
  if (!user || !user.hash || !user.salt) return false;
  const params = user.scrypt || SCRYPT;
  let derived;
  try {
    derived = crypto.scryptSync(password, user.salt, params.keylen || 64, {
      N: params.N, r: params.r, p: params.p, maxmem: 64 * 1024 * 1024,
    });
  } catch (e) {
    return false;
  }
  const stored = Buffer.from(user.hash, "base64");
  if (stored.length !== derived.length) return false;
  return crypto.timingSafeEqual(stored, derived);
}

module.exports = {
  snapshot, DATA_DIR, usersFile, stateFile, readJson, writeJson, hashPassword, verifyPassword };
