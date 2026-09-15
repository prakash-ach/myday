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

function writeJson(file, obj, backup) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
  fs.renameSync(tmp, file);
  if (backup) {
    const stamp = new Date().toISOString().slice(0, 10);
    try { fs.copyFileSync(file, file.replace(/\.json$/, "") + "." + stamp + ".bak"); } catch (e) {}
  }
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

module.exports = { DATA_DIR, usersFile, stateFile, readJson, writeJson, hashPassword, verifyPassword };
