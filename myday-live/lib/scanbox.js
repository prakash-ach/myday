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
  const d = read(dir), out = [], proj = row.projectId || null;
  const ids = [digits(row.imei1), digits(row.imei2), clean(row.serial, 40).toUpperCase()].filter((x) => x && x.length >= 6);
  for (const r of d.rows) {
    if (r.hidden || r.id === exceptId || (r.projectId || null) !== proj) continue;     // duplicates count within the same project
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
/* Same retail barcode = same model, colour, RAM and storage. Learn it from any box that shows them. */
function eanMap(rows) {
  const m = new Map();
  for (const r of rows) if (!r.hidden && r.ean && (r.storage || r.ram) && !(r.filled && (r.filled.storage || r.filled.ram))) {
    const x = m.get(r.ean) || {}; if (r.storage && !x.storage) x.storage = r.storage; if (r.ram && !x.ram) x.ram = r.ram; m.set(r.ean, x);
  }
  return m;
}
/* Fill blank RAM/storage: from the barcode first, then the project's default. Marked, never silent. */
function fillBlanks(r, eans, proj) {
  const out = { ...r }, filled = { ...(r.filled || {}) };
  for (const f of ["storage", "ram"]) {
    if (out[f]) continue;
    const e = r.ean && eans.get(r.ean);
    if (e && e[f]) { out[f] = e[f]; filled[f] = "from barcode"; }
    else if (proj && proj.defaults && proj.defaults[f]) { out[f] = proj.defaults[f]; filled[f] = "project default"; }
  }
  if (Object.keys(filled).length) out.filled = filled;
  return out;
}
const view = (r) => ({ ...r, brand: canonBrand(r.brand), model: modelOnly(r.brand, r.model) });     // display only

const FIELDS = ["brand", "model", "colour", "ram", "storage", "imei1", "imei2", "serial", "productModel", "ean", "eid", "note", "sscc", "gtin", "cartonCount", "source"];
function normalise(r) {
  const o = {};
  for (const f of FIELDS) o[f] = clean(r[f], f === "note" ? 300 : 60);
  for (const f of ["imei1", "imei2"]) o[f] = digits(o[f]).slice(0, 17);
  o.ean = digits(o.ean).length >= 12 ? digits(o.ean).slice(0, 14) : "";
  o.sscc = digits(o.sscc); o.gtin = digits(o.gtin); o.cartonCount = digits(o.cartonCount);
  o.ram = o.ram.replace(/\s+/g, "").toUpperCase().replace(/G$/, "GB"); o.storage = o.storage.replace(/\s+/g, "").toUpperCase().replace(/G$/, "GB");
  o.serial = o.serial.replace(/\s+/g, "").toUpperCase();
  o.brand = canonBrand(o.brand); o.model = modelOnly(o.brand, o.model);
  return o;
}

/* Save reviewed rows. Rows whose IMEI/serial already exist are skipped unless allowDuplicate is set. */
function save(dir, { photoId, rows, projectId }, user) {
  const d = read(dir), saved = [], skipped = [];
  const proj = projectId && project(dir, projectId) ? projectId : null;
  for (const raw of (rows || []).slice(0, 40)) {
    const r = fillBlanks({ ...normalise(raw), projectId: proj }, eanMap(d.rows.concat(saved)), proj ? project(dir, proj) : null);
    if (!r.model && !r.imei1 && !r.serial) { skipped.push({ row: r, reason: "empty — no model, IMEI or serial" }); continue; }
    const ids = [r.imei1, r.imei2, r.serial].filter((x) => x && x.length >= 6);
    const inBatch = saved.find((x) => [x.imei1, x.imei2, x.serial].some((v) => v && ids.includes(v)));
    const dup = inBatch ? [{ id: inBatch.id, value: ids.find((v) => [inBatch.imei1, inBatch.imei2, inBatch.serial].includes(v)), at: inBatch.at, by: user.name }] : duplicates(dir, { ...r, projectId: proj });
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
function list(dir, me, owner, withRemoved, projectId) {
  const d = read(dir);
  if (projectId !== undefined) d.rows = d.rows.filter((r) => (r.projectId || "none") === projectId);
  // Older rows are shown cleaned (brand once, model without it); what's stored isn't rewritten.
  // Removed rows only for the owner, and only when asked for.
  const eans = eanMap(read(dir).rows), P = new Map(projects(dir).map((p) => [p.id, p]));
  return d.rows.filter((r) => (!r.hidden || (owner && withRemoved)) && canSee(r, me, owner)).sort((a, b) => (a.at < b.at ? 1 : -1))
    .map((r) => view(fillBlanks(r, eans, P.get(r.projectId))));
}
const removedCount = (dir, projectId) => read(dir).rows.filter((r) => r.hidden && (projectId === undefined || (r.projectId || "none") === projectId)).length;

/* ---------- projects: the owner names them; everyone scans into one ---------- */
const pfile = (dir) => path.join(root(dir), "projects.json");
const projects = (dir) => { try { return JSON.parse(fs.readFileSync(pfile(dir), "utf8")); } catch (e) { return []; } };
const project = (dir, id) => projects(dir).find((p) => p.id === id) || null;
function saveProjects(dir, list) { fs.mkdirSync(root(dir), { recursive: true }); const t = pfile(dir) + ".tmp"; fs.writeFileSync(t, JSON.stringify(list), { mode: 0o600 }); fs.renameSync(t, pfile(dir)); }
function createProject(dir, me, name) {
  const n = clean(name, 80); if (!n) return { error: "Give the project a name" };
  const list = projects(dir);
  if (list.some((p) => p.name.toLowerCase() === n.toLowerCase() && !p.archived)) return { error: "There's already a project with that name" };
  const p = { id: crypto.randomBytes(6).toString("hex"), name: n, createdAt: new Date().toISOString(), createdBy: me.username };
  saveProjects(dir, [...list, p]); return { project: p };
}
function updateProject(dir, me, id, change) {
  const list = projects(dir), p = list.find((x) => x.id === id); if (!p) return { error: "not found" };
  if (change.name != null) { const n = clean(change.name, 80); if (!n) return { error: "Give the project a name" }; p.name = n; }
  if (change.archived != null) p.archived = change.archived ? { at: new Date().toISOString(), by: me.username } : undefined;
  if (change.defaults) p.defaults = { ram: clean(change.defaults.ram, 10).replace(/\s+/g, "").toUpperCase(), storage: clean(change.defaults.storage, 10).replace(/\s+/g, "").toUpperCase() };
  if (change.scanType) p.scanType = change.scanType === "carton" ? "carton" : "box";
  if (change.locked != null) p.locked = change.locked ? { at: new Date().toISOString(), by: me.username } : undefined;   // scanning stopped
  saveProjects(dir, list); return { project: p };
}
/* Projects with row counts (people count their own rows; the owner counts all). */
function projectList(dir, me, owner) {
  const rows = read(dir).rows.filter((r) => !r.hidden && canSee(r, me, owner));
  const count = (id) => rows.filter((r) => (r.projectId || "none") === id).length;
  // Staff only see projects that are open for scanning.
  const out = projects(dir).filter((p) => owner || (!p.archived && !p.locked)).map((p) => ({ ...p, rows: count(p.id) }));
  const none = count("none");
  if (none) out.push({ id: "none", name: "Earlier scans (no project)", rows: none, legacy: true });
  return out;
}

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
  if (field === "imei2Status" || field === "imei1Status") {
    // A person can confirm a flagged IMEI is right ("confirmed"), set IMEI 2 aside ("ignored"), or undo (re-check).
    const f = field === "imei1Status" ? "imei1" : "imei2";
    const d = read(dir), r = d.rows.find((x) => x.id === id);
    if (!r || r.hidden || !canSee(r, me, owner)) return { error: "not found" };
    const from = r.checks[f], to = value === "confirmed" ? "confirmed" : value === "ignored" && f === "imei2" ? "ignored" : checkImei(r[f], "typed");
    if (from === to) return { row: r };
    r.checks[f] = to; if (to === "confirmed") r.checks[f + "By"] = me.displayName || me.username; else delete r.checks[f + "By"];
    r.edits = [...(r.edits || []), { at: new Date().toISOString(), by: me.username, field: (f === "imei1" ? "IMEI 1" : "IMEI 2") + " status", from, to }];
    write(dir, d); return { row: r };
  }
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
/* Set one field on many rows at once (e.g. storage for a whole group); every change logged. */
function bulk(dir, me, owner, ids, field, value) {
  if (!["brand", "model", "colour", "ram", "storage"].includes(field)) return { error: "can't bulk-edit that" };
  const d = read(dir); let n = 0;
  for (const r of d.rows) {
    if (!ids.includes(r.id) || r.hidden || !canSee(r, me, owner)) continue;
    const next = normalise({ ...r, [field]: value })[field];
    if (next === r[field]) continue;
    r.edits = [...(r.edits || []), { at: new Date().toISOString(), by: me.username, field, from: r[field], to: next, bulk: true }];
    r[field] = next; if (r.filled) delete r.filled[field]; n++;
  }
  write(dir, d); return { changed: n };
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
      const clash = duplicates(dir, { [f]: v, projectId: r.projectId }, r.id);
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
function saveFromCloseup(dir, user, photoId, box, got, projectId) {
  if (got.model && box.model && modelOnly(box.brand, got.model).toLowerCase() !== modelOnly(box.brand, box.model).toLowerCase()) return { retake: true, reason: "close-up showed a different box" };
  const row = { ...box, imei1: luhn(digits(got.imei1)) ? got.imei1 : "", imei2: luhn(digits(got.imei2)) ? got.imei2 : "", serial: got.serial || "" };
  for (const f of ["colour", "ram", "storage"]) if (!row[f] && got[f]) row[f] = got[f];
  if (!row.imei1 && !row.serial) return { retake: true, reason: "IMEI and serial still unreadable" };
  const out = save(dir, { photoId, rows: [row], projectId }, user);
  return out.saved.length ? { saved: out.saved[0].id } : { duplicate: true };
}

/* Owner: delete a locked project's photos to free disk space; every row is kept (photoId cleared, logged). */
function dropProjectPhotos(dir, me, projectId) {
  const d = read(dir); let photos = 0, bytes = 0; const seen = new Set();
  for (const r of d.rows) {
    if ((r.projectId || "none") !== projectId || !r.photoId) continue;
    if (!seen.has(r.photoId)) { seen.add(r.photoId); try { bytes += fs.statSync(photo(dir, r.photoId)).size; } catch (e) {} dropPhoto(dir, r.photoId); photos++; }
    r.edits = [...(r.edits || []), { at: new Date().toISOString(), by: me.username, field: "photo", from: "kept", to: "deleted to free space" }];
    r.photoId = null;
  }
  write(dir, d);
  return { photos, mb: Math.round(bytes / 1048576) };
}

/* Owner: combine projects into a NEW project — a copy of every row with "source" = the project it came
   from. The original projects and rows are left exactly as they are. */
function combineProjects(dir, me, ids, name) {
  const made = createProject(dir, me, name); if (made.error) return made;
  const P = new Map(projects(dir).map((p) => [p.id, p.name])); P.set("none", "No project");
  const d = read(dir), now = new Date().toISOString(); let n = 0;
  const src = d.rows.filter((r) => !r.hidden && ids.includes(r.projectId || "none"));
  for (const r of src) {
    d.rows.push({ ...r, id: crypto.randomBytes(8).toString("hex"), projectId: made.project.id, source: P.get(r.projectId || "none") || "",
      edits: [...(r.edits || []), { at: now, by: me.username, field: "copied", from: P.get(r.projectId || "none") || "", to: made.project.name }] });
    n++;
  }
  write(dir, d);
  const list = projects(dir), np = list.find((p) => p.id === made.project.id);
  np.combinedFrom = ids.map((i) => P.get(i) || i); saveProjects(dir, list);
  return { project: np, rows: n };
}
/* Owner: give "Earlier scans (no project)" a name — they become a project (each row logged). */
function nameLegacy(dir, me, name) {
  const made = createProject(dir, me, name); if (made.error) return made;
  const d = read(dir), now = new Date().toISOString(); let n = 0;
  for (const r of d.rows) if (!r.projectId) { r.projectId = made.project.id; r.edits = [...(r.edits || []), { at: now, by: me.username, field: "project", from: "no project", to: made.project.name }]; n++; }
  write(dir, d); return { project: made.project, rows: n };
}

module.exports = { combineProjects, nameLegacy, dropProjectPhotos, bulk, project, projects, createProject, updateProject, projectList, saveFromCloseup, removedCount, restore, purge, canonBrand, modelOnly, applyReread, dropPhoto, luhn, digits, savePhoto, save, list, edit, hide, photoFor, duplicates, normalise, FIELDS, checkImei };
