/* Scan Boxes — photo of one or more phone boxes → one row per box.
 *
 * The AI reads each box's label (brand, model, colour, RAM, storage, IMEIs,
 * serial, product model). Every IMEI is checked with its built-in check digit
 * (Luhn), so a misread number is caught instead of saved. Where the phone's
 * browser can decode barcodes, the screen swaps in the exact barcode values
 * before anything is saved.
 *
 * One shared table on the server: each row records who scanned it and when,
 * with the photo. People see their own rows; the owner sees everyone's.
 * Rows are never deleted — "Remove" hides them, and every edit is logged.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = (dir) => path.join(dir, "scanbox");
const file = (dir) => path.join(root(dir), "rows.json");
const photo = (dir, id) => path.join(root(dir), "photos", id.replace(/[^a-z0-9]/gi, "") + ".jpg");
const read = (dir) => { try { return JSON.parse(fs.readFileSync(file(dir), "utf8")); } catch (e) { return { rows: [] }; } };
function write(dir, d) { fs.mkdirSync(root(dir), { recursive: true }); const t = file(dir) + ".tmp"; fs.writeFileSync(t, JSON.stringify(d), { mode: 0o600 }); fs.renameSync(t, file(dir)); }

/* IMEI check digit (Luhn). */
function luhn(s) {
  if (!/^\d{15}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) { let d = +s[i]; if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } sum += d; }
  return sum % 10 === 0;
}
const digits = (s) => String(s || "").replace(/\D/g, "");
const clean = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
/* Status of one identifier: barcode (exact), valid (check digit ok), bad (fails check), missing. */
function checkImei(v, how) {
  const d = digits(v);
  if (!d) return "missing";
  if (!luhn(d)) return "bad";
  return how === "barcode" ? "barcode" : "valid";
}

function savePhoto(dir, b64, username) {
  const id = crypto.randomBytes(9).toString("hex");
  fs.mkdirSync(path.dirname(photo(dir, id)), { recursive: true });
  fs.writeFileSync(photo(dir, id), Buffer.from(b64, "base64"), { mode: 0o600 });
  fs.writeFileSync(photo(dir, id) + ".by", String(username), { mode: 0o600 });       // who took it
  return id;
}

/* Who else already scanned these identifiers (visible rows only). */
function duplicates(dir, row, exceptId) {
  const d = read(dir), out = [];
  const ids = [digits(row.imei1), digits(row.imei2), clean(row.serial, 40).toUpperCase()].filter((x) => x && x.length >= 6);
  for (const r of d.rows) {
    if (r.hidden || r.id === exceptId) continue;
    const mine = [digits(r.imei1), digits(r.imei2), String(r.serial || "").toUpperCase()].filter(Boolean);
    const hit = ids.find((x) => mine.includes(x));
    if (hit) out.push({ id: r.id, value: hit, at: r.at, by: r.byName || r.by });
  }
  return out;
}

/* Brand spelled one way; model without the brand in front ("realme Note 70" → "Note 70"). */
const BRANDS = ["POCO", "Redmi", "Xiaomi", "realme", "Samsung", "Apple", "Google", "Motorola", "OnePlus", "OPPO", "vivo", "HONOR", "Nothing", "Infinix", "TECNO", "Huawei", "Nokia", "ZTE", "TCL", "Sony", "Asus"];
function canonBrand(b) { const t = clean(b, 30); const hit = BRANDS.find((x) => x.toLowerCase() === t.toLowerCase()); return hit || t; }
function modelOnly(brand, model) {
  let m = clean(model, 60);
  const names = [brand].filter(Boolean).map((x) => String(x).toLowerCase());    // only this row's own brand
  for (let again = true; again;) {
    again = false;
    for (const n of names) if (m.toLowerCase().startsWith(n + " ") && m.length > n.length + 1) { m = m.slice(n.length + 1).trim(); again = true; }
  }
  return m;
}
const view = (r) => ({ ...r, brand: canonBrand(r.brand), model: modelOnly(r.brand, r.model) });     // display only

const FIELDS = ["brand", "model", "colour", "ram", "storage", "imei1", "imei2", "serial", "productModel", "eid", "note"];
function normalise(r) {
  const o = {};
  for (const f of FIELDS) o[f] = clean(r[f], f === "note" ? 300 : 60);
  for (const f of ["imei1", "imei2"]) o[f] = digits(o[f]).slice(0, 17);
  o.ram = o.ram.replace(/\s+/g, "").toUpperCase().replace(/G$/, "GB"); o.storage = o.storage.replace(/\s+/g, "").toUpperCase().replace(/G$/, "GB");
  o.serial = o.serial.replace(/\s+/g, "").toUpperCase();
  o.brand = canonBrand(o.brand); o.model = modelOnly(o.brand, o.model);
  return o;
}

/* Save reviewed rows. Rows whose IMEI/serial already exist are skipped unless allowDuplicate is set. */
function save(dir, { photoId, rows }, user) {
  const d = read(dir), saved = [], skipped = [];
  for (const raw of (rows || []).slice(0, 40)) {
    const r = normalise(raw);
    if (!r.model && !r.imei1 && !r.serial) { skipped.push({ row: r, reason: "empty — no model, IMEI or serial" }); continue; }
    const ids = [r.imei1, r.imei2, r.serial].filter((x) => x && x.length >= 6);
    const inBatch = saved.find((x) => [x.imei1, x.imei2, x.serial].some((v) => v && ids.includes(v)));
    const dup = inBatch ? [{ id: inBatch.id, value: ids.find((v) => [inBatch.imei1, inBatch.imei2, inBatch.serial].includes(v)), at: inBatch.at, by: user.name }] : duplicates(dir, r);
    if (dup.length && !raw.allowDuplicate) { skipped.push({ row: r, reason: `already scanned: ${dup[0].value} on ${dup[0].at.slice(0, 10)} by ${dup[0].by}` }); continue; }
    const how = raw.how || {};
    const rec = {
      id: crypto.randomBytes(8).toString("hex"), at: new Date().toISOString(), by: user.username, byName: user.name,
      ...r, checks: { imei1: checkImei(r.imei1, how.imei1), imei2: checkImei(r.imei2, how.imei2), serial: !r.serial ? "missing" : how.serial === "barcode" ? "barcode" : "read" },
      photoId: /^[a-f0-9]{18}$/.test(photoId || "") ? photoId : null, duplicateOf: dup.length ? dup.map((x) => x.id) : undefined, edits: [],
    };
    d.rows.push(rec); saved.push(rec);
  }
  write(dir, d);
  return { saved, skipped };
}

const canSee = (r, me, owner) => owner || r.by === me.username;
function list(dir, me, owner, withRemoved) {
  const d = read(dir);
  // Older rows are shown cleaned (brand once, model without it); what's stored isn't rewritten.
  // Removed rows only for the owner, and only when asked for.
  return d.rows.filter((r) => (!r.hidden || (owner && withRemoved)) && canSee(r, me, owner)).sort((a, b) => (a.at < b.at ? 1 : -1)).map(view);
}
const removedCount = (dir) => read(dir).rows.filter((r) => r.hidden).length;

/* Owner only: bring removed rows back. */
function restore(dir, me, ids) {
  const d = read(dir); let n = 0;
  for (const r of d.rows) if (ids.includes(r.id) && r.hidden) {
    r.edits = [...(r.edits || []), { at: new Date().toISOString(), by: me.username, field: "restored", from: `removed by ${r.hidden.by}`, to: "" }];
    delete r.hidden; n++;
  }
  write(dir, d); return n;
}
/* Owner only: delete removed rows for good. Only rows that were removed first
   (two steps), their photo too when no other row uses it, and a record of
   what was deleted (identifiers only), by whom and when. */
function purge(dir, me, ids) {
  const d = read(dir);
  const gone = d.rows.filter((r) => ids.includes(r.id) && r.hidden);
  if (!gone.length) return 0;
  d.rows = d.rows.filter((r) => !gone.includes(r));
  write(dir, d);
  for (const r of gone) if (r.photoId && !d.rows.some((x) => x.photoId === r.photoId)) dropPhoto(dir, r.photoId);
  const logF = path.join(root(dir), "deletions.json");
  let log = []; try { log = JSON.parse(fs.readFileSync(logF, "utf8")); } catch (e) {}
  const at = new Date().toISOString();
  log.push(...gone.map((r) => ({ at, by: me.username, id: r.id, scannedAt: r.at, scannedBy: r.by, brand: r.brand, model: r.model, imei1: r.imei1, imei2: r.imei2, serial: r.serial })));
  fs.writeFileSync(logF, JSON.stringify(log), { mode: 0o600 });
  return gone.length;
}
function edit(dir, me, owner, id, field, value) {
  if (!FIELDS.includes(field)) return { error: "can't edit that" };
  const d = read(dir), r = d.rows.find((x) => x.id === id);
  if (!r || r.hidden || !canSee(r, me, owner)) return { error: "not found" };
  const next = normalise({ ...r, [field]: value })[field];
  if (next === r[field]) return { row: r };
  r.edits = [...(r.edits || []), { at: new Date().toISOString(), by: me.username, field, from: r[field], to: next }];
  r[field] = next;
  if (field === "imei1" || field === "imei2") r.checks[field] = checkImei(next, "typed");
  if (field === "serial") r.checks.serial = next ? "typed" : "missing";
  write(dir, d);
  return { row: r };
}
function hide(dir, me, owner, ids) {
  const d = read(dir); let n = 0;
  for (const r of d.rows) if (ids.includes(r.id) && !r.hidden && canSee(r, me, owner)) { r.hidden = { at: new Date().toISOString(), by: me.username, name: me.displayName || me.username }; n++; }
  write(dir, d);
  return n;
}
function photoFor(dir, me, owner, id) {
  if (!/^[a-f0-9]{18}$/.test(id)) return null;
  let by = ""; try { by = fs.readFileSync(photo(dir, id) + ".by", "utf8"); } catch (e) {}
  // The person who took it, or the owner.
  if (!owner && by !== me.username) return null;
  try { return fs.readFileSync(photo(dir, id)); } catch (e) { return null; }
}

/* A close-up re-read of one saved row: fill in what was missing or failed
   its check — only with numbers that pass. Logged as an edit by the AI. */
function applyReread(dir, me, owner, id, got) {
  const d = read(dir), r = d.rows.find((x) => x.id === id);
  if (!r || r.hidden || !canSee(r, me, owner)) return { error: "not found" };
  if (got.model && r.model && modelOnly(r.brand, got.model).toLowerCase() !== String(r.model).toLowerCase()) return { row: r, changed: 0, mismatch: true };   // a different box
  const changed = [];
  for (const f of ["imei1", "imei2"]) {
    const v = digits(got[f]);
    if (luhn(v) && r.checks[f] !== "barcode" && r.checks[f] !== "valid" && v !== r[f]) {
      const clash = duplicates(dir, { [f]: v }, r.id);
      if (clash.length) {
        // The close-up shows this box was already scanned. A row with no other identifier is just a
        // duplicate made by this scan, so it's taken out of the table (hidden, with the reason).
        // Only for a row this scan created moments ago (never shown, never edited): it isn't recorded.
        if (!luhn(digits(r.imei1)) && !luhn(digits(r.imei2)) && !r.serial && !(r.edits || []).length && Date.now() - Date.parse(r.at) < 10 * 60e3) {
          d.rows = d.rows.filter((x) => x !== r);
          write(dir, d);
          if (r.photoId && !d.rows.some((x) => x.photoId === r.photoId)) dropPhoto(dir, r.photoId);   // no rows left from that photo
          return { removed: true, changed: 0, duplicate: true };
        }
        r.note = [r.note, `${f.toUpperCase()} ${v} already scanned by ${clash[0].by} — not applied`].filter(Boolean).join(" · "); continue;
      }
      changed.push({ field: f, from: r[f], to: v }); r[f] = v; r.checks[f] = "valid";
    }
  }
  if (!r.serial && got.serial) { changed.push({ field: "serial", from: "", to: got.serial }); r.serial = got.serial; r.checks.serial = "read"; }
  for (const f of ["model", "colour", "ram", "storage"]) if (!r[f] && got[f]) { changed.push({ field: f, from: "", to: got[f] }); r[f] = got[f]; }
  if (changed.length) r.edits = [...(r.edits || []), ...changed.map((c) => ({ at: new Date().toISOString(), by: "AI close-up re-read", ...c }))];
  write(dir, d);
  return { row: r, changed: changed.length };
}
function dropPhoto(dir, id) { try { fs.unlinkSync(photo(dir, id)); fs.unlinkSync(photo(dir, id) + ".by"); } catch (e) {} }

/* A box the stack photo couldn't identify (no IMEI, no serial): never saved as
   an empty row. The close-up read decides: numbers found → saved (duplicate-
   checked); otherwise "retake this box". */
function saveFromCloseup(dir, user, photoId, box, got) {
  if (got.model && box.model && modelOnly(box.brand, got.model).toLowerCase() !== modelOnly(box.brand, box.model).toLowerCase()) return { retake: true, reason: "close-up showed a different box" };
  const row = { ...box, imei1: luhn(digits(got.imei1)) ? got.imei1 : "", imei2: luhn(digits(got.imei2)) ? got.imei2 : "", serial: got.serial || "" };
  for (const f of ["colour", "ram", "storage"]) if (!row[f] && got[f]) row[f] = got[f];
  if (!row.imei1 && !row.serial) return { retake: true, reason: "IMEI and serial still unreadable" };
  const out = save(dir, { photoId, rows: [row] }, user);
  return out.saved.length ? { saved: out.saved[0].id } : { duplicate: true };
}

module.exports = { saveFromCloseup, removedCount, restore, purge, canonBrand, modelOnly, applyReread, dropPhoto, luhn, digits, savePhoto, save, list, edit, hide, photoFor, duplicates, normalise, FIELDS, checkImei };
