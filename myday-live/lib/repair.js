/* Repair Devices — the engine.
 *
 * Three CSV inputs: repair stock (one row per device), a sales-filtered
 * catalog and an inventory-filtered catalog. Roles are worked out from
 * headers and values, never from filenames (those change with every
 * download). Originals are stored byte-for-byte; everything derived lives
 * in separate fields, computed deterministically from the active batch and
 * the settings. Missing is never zero.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

/* ======================= CSV ======================= */
/* RFC 4180: quoted commas, escaped quotes (""), multiline fields, BOM, CRLF.
   Each row keeps the line number it started on. */
function parseCsv(text) {
  let s = String(text);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const rows = [], errors = [];
  let row = [], field = "", q = false, line = 1, rowLine = 1, i = 0;
  const n = s.length;
  while (i < n) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i += 2; continue; } q = false; i++; continue; }
      if (ch === "\r" && s[i + 1] === "\n") { i++; continue; }        // CRLF inside a field reads as one line break
      if (ch === "\n") line++;
      field += ch; i++; continue;
    }
    if (ch === '"') { if (field === "") { q = true; i++; continue; } field += ch; i++; continue; }
    if (ch === ",") { row.push(field); field = ""; i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") { row.push(field); rows.push({ line: rowLine, cells: row }); row = []; field = ""; i++; line++; rowLine = line; continue; }
    field += ch; i++;
  }
  if (q) errors.push({ line: rowLine, msg: "a quoted field never closes (file may be cut off)" });
  if (field !== "" || row.length) { row.push(field); rows.push({ line: rowLine, cells: row }); }
  while (rows.length && rows[rows.length - 1].cells.length === 1 && rows[rows.length - 1].cells[0] === "") rows.pop();   // trailing blank line
  if (!rows.length) return { headers: [], records: [], errors: [...errors, { line: 1, msg: "the file is empty" }] };
  const headers = rows[0].cells.map((h) => h.trim());
  const records = rows.slice(1).map((r, k) => {
    const o = {};
    headers.forEach((h, j) => { o[h] = r.cells[j] !== undefined ? r.cells[j] : ""; });
    if (r.cells.length > headers.length) o.__extra = r.cells.slice(headers.length);
    return { line: r.line, rec: k + 1, cells: r.cells.length, data: o };
  });
  records.forEach((r) => { if (r.cells !== headers.length && !(r.cells === 1 && Object.values(r.data).every((v) => v === ""))) errors.push({ line: r.line, msg: `has ${r.cells} fields, header has ${headers.length}` }); });
  return { headers, records, errors };
}

/* ======================= values ======================= */
const blank = (v) => v == null || String(v).trim() === "";
/* "$1,234.56", "-$5.00", "($5.00)", "13.15", "13.15%" → number; blank/garbage → null (never 0). */
function num(v) {
  if (blank(v)) return null;
  let s = String(v).trim(), neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[$,%\s]/g, "").replace(/^USD/i, "");
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  if (!/^\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return null;
  const x = Number(s);
  return Number.isFinite(x) ? (neg ? -x : x) : null;
}
const normBin = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
const keySku = (s) => String(s == null ? "" : s).trim();
const keyId = (s) => String(s == null ? "" : s).trim();

/* "Inventory : 0 / 1, Repair Stock : 4 / 4, ..." → [{ warehouse, a, b, raw }] */
function parseStock(s) {
  const out = [], bad = [];
  if (blank(s)) return { segments: out, bad };
  for (const part of String(s).split(",")) {
    const t = part.trim(); if (!t) continue;
    const m = t.match(/^(.+?)\s*:\s*(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
    if (m) out.push({ warehouse: m[1].trim(), a: Number(m[2]), b: Number(m[3]), raw: t });
    else bad.push(t);
  }
  return { segments: out, bad };
}

/* ======================= roles ======================= */
const REPAIR_HEADERS = ["IMEI", "SKU", "Bin Location", "Reason"];
const CATALOG_HEADERS = ["SKU", "Stock Summary", "Monthly sale", "Weekly sale"];

/* A catalog footer: no Name, ID or SKU, but totals in the sales columns. */
const isFooter = (d) => blank(d.Name) && blank(d.ID) && blank(d.SKU) && (!blank(d["Monthly sale"]) || /average of/i.test(d["Days Stock"] || ""));

function inspect(name, buf) {
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const p = parseCsv(buf.toString("utf8"));
  const has = (list) => list.every((h) => p.headers.includes(h));
  const out = { name, bytes: buf.length, sha256, headers: p.headers, rows: p.records.length, parseErrors: p.errors.slice(0, 50), parseErrorCount: p.errors.length };
  if (has(REPAIR_HEADERS)) {
    out.kind = "repair"; out.role = "repair";
    out.evidence = [`has device columns: ${REPAIR_HEADERS.join(", ")}`, `${p.records.length} device rows`];
    return { info: out, parsed: p };
  }
  if (has(CATALOG_HEADERS)) {
    out.kind = "catalog";
    const footers = p.records.filter((r) => isFooter(r.data)), products = p.records.filter((r) => !isFooter(r.data));
    const allSales = products.length > 0 && products.every((r) => (num(r.data["Monthly sale"]) || 0) > 0);
    const firstInv = (r) => { const seg = parseStock(r.data["Stock Summary"]).segments.find((x) => /^inventory$/i.test(x.warehouse)); return seg ? seg.a : null; };
    const allInv = products.length > 0 && products.every((r) => (firstInv(r) || 0) > 0);
    out.footers = footers.length; out.products = products.length;
    out.evidence = [
      `${products.filter((r) => (num(r.data["Monthly sale"]) || 0) > 0).length} of ${products.length} product rows have a positive Monthly sale`,
      `${products.filter((r) => (firstInv(r) || 0) > 0).length} of ${products.length} product rows have a positive first Inventory quantity`,
      `${footers.length} footer row${footers.length === 1 ? "" : "s"}`,
    ];
    out.role = allSales && !allInv ? "sales" : allInv && !allSales ? "inventory" : allSales && allInv ? "ambiguous" : "unknown";
    return { info: out, parsed: p };
  }
  out.kind = "unknown"; out.role = "unknown";
  out.evidence = ["doesn't have the repair-stock columns (IMEI, SKU, Bin Location, Reason) or the catalog columns (SKU, Stock Summary, Monthly sale, Weekly sale)"];
  return { info: out, parsed: p };
}

/* Validate a set of files with chosen roles. Returns findings; ok=false if anything blocks. */
function validate(files) {
  const findings = [], add = (level, file, msg, count) => findings.push({ level, file, msg, count });
  const byRole = {};
  for (const f of files) {
    if (!["repair", "sales", "inventory"].includes(f.role)) { add("error", f.info.name, "no role chosen (repair stock, sales catalog or inventory catalog)"); continue; }
    if (byRole[f.role]) add("error", f.info.name, `two files both set as ${f.role} — keep one`);
    byRole[f.role] = f;
    if (f.info.parseErrorCount) add("warn", f.info.name, `${f.info.parseErrorCount} row(s) with a different number of fields than the header (first: line ${f.info.parseErrors[0].line} — ${f.info.parseErrors[0].msg})`, f.info.parseErrorCount);
    if (f.role === "repair" && f.info.kind !== "repair") add("error", f.info.name, "set as repair stock but doesn't have the device columns");
    if ((f.role === "sales" || f.role === "inventory") && f.info.kind !== "catalog") add("error", f.info.name, `set as ${f.role} catalog but doesn't have the catalog columns`);
    if (f.role === "sales" && f.info.role === "inventory") add("warn", f.info.name, "set as sales, but its rows look like the inventory catalog — check");
    if (f.role === "inventory" && f.info.role === "sales") add("warn", f.info.name, "set as inventory, but its rows look like the sales catalog — check");
  }
  for (const r of ["repair", "sales", "inventory"]) if (!byRole[r]) add("error", null, `no ${r === "repair" ? "repair-stock" : r + " catalog"} file`);
  const rep = byRole.repair;
  if (rep && rep.info.kind === "repair") {
    const seen = new Map(), dups = [], blanks = [];
    for (const r of rep.parsed.records) {
      const id = keyId(r.data.IMEI);
      if (!id) { blanks.push(r.line); continue; }
      if (seen.has(id)) dups.push(`${id} (lines ${seen.get(id)} and ${r.line})`); else seen.set(id, r.line);
    }
    if (dups.length) add("review", rep.info.name, `${dups.length} duplicate device identifier(s) in this file: ${dups.slice(0, 5).join("; ")}${dups.length > 5 ? "…" : ""}`, dups.length);
    if (blanks.length) add("review", rep.info.name, `${blanks.length} device row(s) with no IMEI/serial (lines ${blanks.slice(0, 8).join(", ")}${blanks.length > 8 ? "…" : ""})`, blanks.length);
  }
  for (const role of ["sales", "inventory"]) {
    const f = byRole[role]; if (!f || f.info.kind !== "catalog") continue;
    const seen = new Map(), dups = [], blankKey = [];
    for (const r of f.parsed.records) {
      if (isFooter(r.data)) continue;
      const k = keySku(r.data.SKU);
      if (!k) { blankKey.push(r.line); continue; }
      if (seen.has(k)) dups.push(`${k} (lines ${seen.get(k)} and ${r.line})`); else seen.set(k, r.line);
    }
    if (dups.length) add("review", f.info.name, `${dups.length} duplicate SKU row(s) — not merged or summed, flagged for review: ${dups.slice(0, 5).join("; ")}`, dups.length);
    if (blankKey.length) add("review", f.info.name, `${blankKey.length} product row(s) with no SKU (kept, excluded from joins): lines ${blankKey.slice(0, 8).join(", ")}`, blankKey.length);
    if (f.info.footers !== 1) add("warn", f.info.name, `${f.info.footers} footer rows found (expected 1)`);
  }
  return { ok: !findings.some((x) => x.level === "error"), findings };
}

/* ======================= storage ======================= */
const root = (dir) => path.join(dir, "repair");
function readJ(f, d) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return d; } }
function writeJ(f, v) { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + ".tmp"; fs.writeFileSync(t, JSON.stringify(v, null, 1), { mode: 0o600 }); fs.renameSync(t, f); }

const DEFAULT_SETTINGS = {
  salesWindowDays: 30, lowStockDays: 7, targetCoverDays: 14,
  availabilityWarehouse: "Inventory", availabilityQuantity: "first",       // provisional: first number of the Inventory pair
  completeness: "incomplete",                                                // "incomplete" | "complete" (positive-only exports)
  lowMarginPct: 10,
  technicians: ["Diego Alexander Arce", "Madhav Bhetwal", "mohammad sala uddin", "Nazar", "Rashed Naimi", "Sanjaya Adhikari", "Somnang Ram", "Sulaiman Ahmady", "Tamim Habibi"],
  queueBins: ["Repair To Repair"],       // waiting to be repaired — not started, not with a technician
  bibekBins: ["UNKNOWN CARRIER LOCKED DEVICE", "Unknown Carrier Lock Device", "UNLOCK SUBMITTED", "UNLOCKED SUBMITTED", "Vendor Return-Return to Supplier"],
};
const settings = (dir) => ({ ...DEFAULT_SETTINGS, ...readJ(path.join(root(dir), "settings.json"), {}),
  technicians: DEFAULT_SETTINGS.technicians, bibekBins: DEFAULT_SETTINGS.bibekBins, queueBins: DEFAULT_SETTINGS.queueBins });
function saveSettings(dir, s) {
  const cur = settings(dir), n = (v, lo, hi, d) => (Number.isFinite(+v) && +v >= lo && +v <= hi ? +v : d);
  const next = {
    ...cur,
    salesWindowDays: n(s.salesWindowDays, 1, 366, cur.salesWindowDays), lowStockDays: n(s.lowStockDays, 0, 365, cur.lowStockDays),
    targetCoverDays: n(s.targetCoverDays, 1, 365, cur.targetCoverDays), lowMarginPct: n(s.lowMarginPct, -100, 100, cur.lowMarginPct),
    availabilityWarehouse: String(s.availabilityWarehouse || cur.availabilityWarehouse).slice(0, 60),
    availabilityQuantity: s.availabilityQuantity === "second" ? "second" : "first",
    completeness: s.completeness === "complete" ? "complete" : "incomplete",
  };
  writeJ(path.join(root(dir), "settings.json"), next);
  return next;
}
const batches = (dir) => readJ(path.join(root(dir), "batches.json"), []);
const activeId = (dir) => (readJ(path.join(root(dir), "active.json"), {}) || {}).batchId || null;

/* Save a validated batch: originals unchanged, plus a record of what was imported. */
function saveBatch(dir, files, user, validation) {
  const id = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14) + "-" + crypto.randomBytes(3).toString("hex");
  const bdir = path.join(root(dir), "batches", id);
  fs.mkdirSync(bdir, { recursive: true });
  const meta = { id, importedAt: new Date().toISOString(), importedBy: user, files: [], findings: validation.findings };
  for (const f of files) {
    const stored = f.role + ".csv";
    fs.writeFileSync(path.join(bdir, stored), f.buf, { mode: 0o600 });           // exactly as uploaded
    meta.files.push({ role: f.role, name: f.info.name, stored, bytes: f.info.bytes, sha256: f.info.sha256, rows: f.info.rows,
      products: f.info.products, footers: f.info.footers, headers: f.info.headers, detected: f.info.role, evidence: f.info.evidence });
  }
  writeJ(path.join(bdir, "meta.json"), meta);
  const list = batches(dir).filter((b) => b.id !== id);
  // Same three files again? Note it — a repeat import never adds to counts; each batch stands alone.
  const sig = meta.files.map((f) => f.role + ":" + f.sha256).sort().join("|");
  const same = list.find((b) => b.sig === sig);
  list.unshift({ id, importedAt: meta.importedAt, importedBy: user, files: meta.files.map((f) => ({ role: f.role, name: f.name, rows: f.rows })), sig, repeatOf: same ? same.id : undefined });
  writeJ(path.join(root(dir), "batches.json"), list.slice(0, 100));
  writeJ(path.join(root(dir), "active.json"), { batchId: id, at: Date.now(), by: user });
  cache.clear();
  return { id, repeatOf: same ? same.id : null };
}
function activate(dir, id, user) {
  if (!batches(dir).some((b) => b.id === id)) return false;
  writeJ(path.join(root(dir), "active.json"), { batchId: id, at: Date.now(), by: user }); cache.clear(); return true;
}

/* Operational overrides (e.g. a confirmed handoff to Bibek), kept apart from imported fields. */
const overrides = (dir) => readJ(path.join(root(dir), "overrides.json"), { byId: {}, log: [] });
function setOverride(dir, deviceId, kind, note, user) {
  const o = overrides(dir), id = keyId(deviceId);
  const entry = { kind, note: String(note || "").slice(0, 300), by: user, at: new Date().toISOString() };
  if (kind === "clear") delete o.byId[id]; else o.byId[id] = entry;
  o.log = [{ id, ...entry }, ...o.log].slice(0, 2000);
  writeJ(path.join(root(dir), "overrides.json"), o); cache.clear();
  return entry;
}

/* ======================= workflow ======================= */
const STATUS = {
  presold: { status: "No action - Presold", action: "Good. No repair action required.", owner: "—", color: "blue" },
  process: { status: "Process and Move", action: "Repair done; process and move", owner: "Processing", color: null },
  cleaning: { status: "Cleaning", action: "Check cleaning and give to Arika to move", owner: "Arika", color: null },
  progress: { status: "Repair in Progress", action: "Already assigned; do not reassign.", color: null },
  queue: { status: "Waiting for repair", action: "Queued for repair — not started; assign to a technician", owner: "Repair queue", color: null },
  board: { status: "Board-level Repair", action: "Give to board-level repair if not already given", owner: "Board-level repair", color: null },
  blacklist: { status: "Blacklisted - Leave", action: "Leave as is; blacklisted", owner: "Leave", color: null },
  testers: { status: "RMA/QC - Leave", action: "Leave with testers as is", owner: "Testers", color: null },
  bibek: { status: "Give to Bibek", action: "Give to Bibek; ignore if already given.", owner: "Bibek", color: null },
  withBibek: { status: "With Bibek", action: "With Bibek — no handoff needed.", owner: "Bibek", color: null },
  assignReview: { status: "Assignment review", action: "Confirm this assignee's role, then route", color: "purple" },
  binReview: { status: "Bin review", action: "Bin looks like a completed-repair bin but doesn't give a valid month — check", color: "purple" },
  unmapped: { status: "Not mapped", action: "Review repair requirement and assignment", owner: "—", color: null },
};
const WORKFLOW_ORDER = ["Repair in Progress", "Waiting for repair", "Process and Move", "Cleaning", "Board-level Repair", "Give to Bibek", "With Bibek", "Blacklisted - Leave", "RMA/QC - Leave", "No action - Presold", "Assignment review", "Bin review", "Not mapped"];
const CANDIDATE_WF = new Set(["Not mapped", "Waiting for repair"]);   // nobody has started these
const ELIGIBILITY = [
  [/black\s*list/i, "Blacklisted"], [/icloud|activation\s*lock|\bfmi\b|find my/i, "Activation lock"], [/\bmdm\b/i, "MDM lock"],
  [/\breject/i, "Rejected"], [/tear\s*down/i, "Teardown"], [/parts?\s*only|for\s*parts/i, "Parts only"],
];

function classify(d, S, ov) {
  const bin = normBin(d["Bin Location"]), assigned = String(d["Assigned To"] || "").trim(), an = normBin(assigned);
  const tech = new Map(S.technicians.map((t) => [normBin(t), t]));
  const bibek = new Set(S.bibekBins.map(normBin));
  const out = (k, extra = {}) => ({ ...STATUS[k], key: k, ...extra });
  const conflicts = [];
  if (String(d.Reason || "").trim() === "Rpre-Sold") return out("presold");
  let r = null;
  const m = bin.match(/^bin-?\s*(\d+)$/);
  if (/^bin\b/.test(bin)) {
    const n = m ? Number(m[1]) : NaN, month = Math.floor(n / 1000);
    r = m && n >= 1000 && month >= 1 && month <= 12 ? out("process", { doneMonth: month }) : out("binReview");
  } else if (bin === "cleaning") r = out("cleaning");
  else if ((S.queueBins || []).some((q) => normBin(q) === bin)) r = out("queue");
  else if (tech.has(bin)) r = out("progress", { owner: tech.get(bin) });
  else if (bin === "no power device") r = out("board");
  else if (bin === "overseas unlocked devices") r = out("blacklist");
  else if (bin === "testers for rma/qc") r = out("testers");
  else if (bibek.has(bin)) {
    const confirmed = (ov && ov.kind === "bibek-handoff") || /\bbibek\b/i.test(assigned);
    r = out(confirmed ? "withBibek" : "bibek", confirmed ? { evidence: ov && ov.kind === "bibek-handoff" ? `handoff recorded by ${ov.by} on ${ov.at.slice(0, 10)}` : `Assigned To: ${assigned}` } : {});
  }
  if (r) {
    // Show conflicting assignment evidence without erasing it.
    if (assigned && r.key === "progress" && an !== bin) conflicts.push(`Assigned To "${assigned}" differs from the technician bin "${d["Bin Location"].trim()}"`);
    else if (assigned && !["progress", "withBibek"].includes(r.key) && !/\bbibek\b/i.test(assigned)) conflicts.push(`Assigned To "${assigned}" while the bin says ${r.status}`);
    return conflicts.length ? { ...r, conflicts } : r;
  }
  if (assigned) {
    if (tech.has(an)) return out("progress", { owner: tech.get(an), via: "Assigned To" });
    return out("assignReview", { owner: assigned });
  }
  return out("unmapped");
}

/* ======================= the model ======================= */
const cache = new Map();
function model(dir) {
  const id = activeId(dir);
  if (!id) return null;
  const S = settings(dir), ov = overrides(dir);
  const key = id + "|" + JSON.stringify(S) + "|" + (ov.log[0] ? ov.log[0].at : "");
  if (cache.has(key)) return cache.get(key);
  const bdir = path.join(root(dir), "batches", id);
  const meta = readJ(path.join(bdir, "meta.json"), null);
  if (!meta) return null;
  const load = (role) => { const f = meta.files.find((x) => x.role === role); return f ? { f, p: parseCsv(fs.readFileSync(path.join(bdir, f.stored)).toString("utf8")) } : null; };
  const R = load("repair"), SA = load("sales"), IN = load("inventory");
  const quality = [];
  const q = (level, area, msg, count, items) => quality.push({ level, area, msg, count: count == null ? undefined : count, items: items ? items.slice(0, 200) : undefined });

  /* ---- catalogs ---- */
  const products = new Map();         // sku → { sales: rec, inventory: rec, dupSales:[], dupInv:[] }
  const footers = [], blankKeys = [];
  for (const [role, src] of [["sales", SA], ["inventory", IN]]) {
    if (!src) continue;
    for (const r of src.p.records) {
      if (isFooter(r.data)) { footers.push({ role, file: src.f.name, line: r.line, monthly: num(r.data["Monthly sale"]), weekly: num(r.data["Weekly sale"]), days: r.data["Days Stock"] }); continue; }
      const k = keySku(r.data.SKU);
      if (!k) { blankKeys.push({ role, file: src.f.name, line: r.line, name: r.data.Name }); continue; }
      const p = products.get(k) || { sku: k };
      if (p[role]) (p["dup_" + role] = p["dup_" + role] || []).push({ file: src.f.name, line: r.line, rec: r.rec, data: r.data });
      else p[role] = { file: src.f.name, line: r.line, rec: r.rec, data: r.data };
      products.set(k, p);
    }
  }

  /* ---- devices ---- */
  const devices = [], idSeen = new Map();
  for (const r of R ? R.p.records : []) {
    const d = r.data, idv = keyId(d.IMEI), sku = keySku(d.SKU);
    const wf = classify(d, S, idv ? ov.byId[idv] : null);
    const text = [d.Reason, d.Notes, d.Description].join(" ");
    const elig = ELIGIBILITY.filter(([re]) => re.test(text)).map(([, label]) => label);
    if (wf.key === "blacklist" && !elig.includes("Blacklisted")) elig.unshift("Blacklisted");
    const money = {
      purchase: num(d["Purchase Price"]), additional: num(d["Additional Cost"]), repair: num(d["Repair / Labor /<br/>Others"]),
      total: num(d["Total Cost"]), selling: num(d["Selling Price"]), marginSrc: num(d["Margin %"]),
    };
    const spread = money.total != null && money.selling != null ? round2(money.selling - money.total) : null;
    const calcMargin = spread != null && money.selling > 0 ? round2((spread / money.selling) * 100) : null;
    const issues = String(d.Reason || "").split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean);
    const dev = {
      i: devices.length, line: r.line, rec: r.rec, id: idv, sku, idKind: /^\d{15}$/.test(idv) ? "IMEI" : idv ? "Serial/other" : "Missing",
      wf: wf.status, wfKey: wf.key, action: wf.action, owner: wf.owner || "—", doneMonth: wf.doneMonth || null, via: wf.via, evidence: wf.evidence,
      conflicts: wf.conflicts || [], elig, issues, money, spread, calcMargin,
      missing: ["total", "selling", "purchase"].filter((k) => money[k] == null),
      flags: [],
    };
    if (!idv) dev.flags.push("No IMEI/serial");
    if (idv && idSeen.has(idv)) { dev.flags.push("Duplicate identifier in this batch"); devices[idSeen.get(idv)].flags.push("Duplicate identifier in this batch"); }
    else if (idv) idSeen.set(idv, dev.i);
    if (!products.has(sku)) dev.flags.push("SKU not in either catalog");
    devices.push(dev);
  }

  /* ---- SKUs: every SKU from any file ---- */
  const skus = new Map();
  const skuOf = (k) => { if (!skus.has(k)) skus.set(k, { sku: k, devices: [], byWf: {} }); return skus.get(k); };
  for (const k of products.keys()) skuOf(k);
  for (const d of devices) if (d.sku) { const s = skuOf(d.sku); s.devices.push(d.i); s.byWf[d.wf] = (s.byWf[d.wf] || 0) + 1; }

  const W = S.availabilityWarehouse.toLowerCase(), pick = S.availabilityQuantity === "second" ? "b" : "a";
  const winDays = S.salesWindowDays;
  for (const s of skus.values()) {
    const p = products.get(s.sku) || {};
    const src = p.sales || p.inventory || null;
    s.name = src ? src.data.Name : (devices[s.devices[0]] ? (R.p.records[devices[s.devices[0]].rec - 1].data.Name || "") : "");
    s.inSales = !!p.sales; s.inInventory = !!p.inventory;
    s.review = [];
    if (p.dup_sales || p.dup_inventory) s.review.push("Duplicate SKU rows in a catalog");
    // Sales: one value per SKU, never added across the two catalogs.
    const ms = p.sales ? num(p.sales.data["Monthly sale"]) : null, mi = p.inventory ? num(p.inventory.data["Monthly sale"]) : null;
    if (ms != null && mi != null && ms !== mi) s.review.push(`Monthly sale differs between catalogs (${ms} vs ${mi})`);
    s.monthly = ms != null ? ms : mi != null ? mi : (S.completeness === "complete" ? 0 : null);
    s.monthlySource = ms != null ? "sales catalog" : mi != null ? "inventory catalog" : S.completeness === "complete" ? "absent from complete export → 0" : "unknown";
    const ws = p.sales ? num(p.sales.data["Weekly sale"]) : null, wi = p.inventory ? num(p.inventory.data["Weekly sale"]) : null;
    s.weekly = ws != null ? ws : wi;
    // Availability: the chosen warehouse pair, never Repair Stock/RMA/other warehouses.
    const segs = (rec) => rec ? parseStock(rec.data["Stock Summary"]) : null;
    const ss = segs(p.sales), si = segs(p.inventory);
    s.stockSegments = (si || ss || { segments: [] }).segments;
    s.stockRaw = (p.inventory || p.sales || { data: {} }).data["Stock Summary"] || "";
    const val = (x) => { if (!x) return undefined; const g = x.segments.find((y) => y.warehouse.toLowerCase() === W); return g ? g[pick] : null; };
    const vs = val(ss), vi = val(si);
    if (vs != null && vi != null && vs !== vi) { s.review.push(`${S.availabilityWarehouse} differs between catalogs (${vs} vs ${vi})`); s.available = null; s.availSource = "conflict"; }
    else if (vi != null || vs != null) { s.available = vi != null ? vi : vs; s.availSource = vi != null ? "inventory catalog" : "sales catalog"; }
    else if (p.sales || p.inventory) { s.available = S.completeness === "complete" ? 0 : null; s.availSource = S.completeness === "complete" ? `no ${S.availabilityWarehouse} segment → 0 (complete export)` : `no ${S.availabilityWarehouse} segment — unknown`; }
    else { s.available = S.completeness === "complete" ? 0 : null; s.availSource = S.completeness === "complete" ? "absent from complete export → 0" : "unknown — not in either catalog"; }
    if (s.available != null && s.available < 0) { s.review.push(`Negative ${S.availabilityWarehouse} quantity (${s.available})`); }
    if ((ss && ss.bad.length) || (si && si.bad.length)) s.review.push("Stock Summary has parts that couldn't be read");
    // Catalog economics (kept apart from device economics).
    const ec = p.sales || p.inventory;
    s.price = ec ? num(ec.data.Price) : null; s.cost = ec ? num(ec.data.Cost) : null; s.marginSrc = ec ? num(ec.data["Margin(%)"]) : null; s.currency = ec ? ec.data["Currency Code"] : "";
    // Demand.
    s.daily = s.monthly != null ? s.monthly / winDays : null;
    s.coverage = s.daily > 0 && s.available != null ? s.available / s.daily : null;
    s.target = s.daily != null ? Math.ceil(s.daily * S.targetCoverDays - 1e-9) : null;
    s.shortage = s.target != null && s.available != null ? Math.max(0, s.target - Math.max(0, s.available)) : null;
    let pr, why;
    if (s.review.length) { pr = "purple"; why = s.review.join("; "); }
    else if (s.monthly == null) { pr = "purple"; why = "Sales unknown — SKU not in the supplied catalogs (export not confirmed complete)"; }
    else if (s.monthly <= 0) { pr = "gray"; why = "No recorded sales in the supplied period"; }
    else if (s.available == null) { pr = "purple"; why = "Sells, but available stock is unknown"; }
    else if (s.available <= 0 || s.coverage < S.lowStockDays) { pr = "red"; why = s.available <= 0 ? `Sells ${fmt(s.monthly)}/period with no available stock` : `${fmt1(s.coverage)} days of stock, below ${S.lowStockDays}`; }
    else if (s.coverage < S.targetCoverDays) { pr = "amber"; why = `${fmt1(s.coverage)} days of stock, below the ${S.targetCoverDays}-day target`; }
    else { pr = "green"; why = `${fmt1(s.coverage)} days of stock meets the ${S.targetCoverDays}-day target`; }
    s.priority = pr; s.why = why;
    // Repair pipeline for this SKU.
    s.candidates = s.devices.filter((i) => CANDIDATE_WF.has(devices[i].wf) && !devices[i].elig.length && !devices[i].flags.includes("Duplicate identifier in this batch")).length;
    s.limit = s.shortage != null ? Math.min(s.candidates, s.shortage) : null;
    s.repairDevices = s.devices.length;
  }
  // Device display priority: Blue for presold, Purple for review, else its SKU's demand priority.
  for (const d of devices) {
    const s = skus.get(d.sku);
    d.demand = s ? s.priority : "purple";
    d.priority = d.wfKey === "presold" ? "blue" : (["assignReview", "binReview"].includes(d.wfKey) || d.flags.length || d.conflicts.length) ? "purple" : d.demand;
    d.lowMargin = d.calcMargin != null && d.calcMargin < S.lowMarginPct;
  }

  /* ---- data quality ---- */
  for (const f of meta.files) q("info", "Files", `${f.name} → ${f.role} (${f.rows} rows${f.products != null ? `, ${f.products} products, ${f.footers} footer` : ""}), sha256 ${f.sha256.slice(0, 12)}…`);
  for (const x of meta.findings || []) q(x.level === "error" ? "error" : x.level, "Import", `${x.file ? x.file + ": " : ""}${x.msg}`, x.count);
  for (const f of footers) q("info", "Footers", `${f.file} line ${f.line}: footer excluded from product totals (reports Monthly ${f.monthly ?? "—"}, Weekly ${f.weekly ?? "—"}, ${String(f.days || "").replace(/<[^>]+>/g, " ").trim()})`);
  const rowMonthly = [...products.values()].filter((p) => p.sales).reduce((n, p) => n + (num(p.sales.data["Monthly sale"]) || 0), 0);
  const salesFooter = footers.find((f) => f.role === "sales");
  if (salesFooter && salesFooter.monthly != null && salesFooter.monthly !== rowMonthly) q("review", "Sales", `Sales footer reports ${salesFooter.monthly} monthly units, but the product rows add up to ${rowMonthly}. The product rows are used.`);
  if (blankKeys.length) q("review", "Catalog", `${blankKeys.length} product row(s) without a SKU (kept, not joined)`, blankKeys.length, blankKeys.map((b) => `${b.file} line ${b.line}: ${b.name || "(no name)"}`));
  const dupSku = [...products.values()].filter((p) => p.dup_sales || p.dup_inventory);
  if (dupSku.length) q("review", "Catalog", `${dupSku.length} SKU(s) with duplicate catalog rows`, dupSku.length, dupSku.map((p) => p.sku));
  const neg = [...skus.values()].filter((s) => s.available != null && s.available < 0);
  if (neg.length) q("review", "Stock", `${neg.length} SKU(s) with a negative ${S.availabilityWarehouse} quantity`, neg.length, neg.map((s) => `${s.sku}: ${s.available}`));
  const conflictSku = [...skus.values()].filter((s) => s.review.some((x) => /differs/.test(x)));
  if (conflictSku.length) q("review", "Conflicts", `${conflictSku.length} SKU(s) whose catalogs disagree`, conflictSku.length, conflictSku.map((s) => `${s.sku}: ${s.review.join("; ")}`));
  const noTotal = devices.filter((d) => d.money.total == null);
  q(noTotal.length ? "review" : "info", "Costs", `${noTotal.length} device(s) missing Total Cost — spread and margin stay unknown for them`, noTotal.length);
  const noReason = devices.filter((d) => !String(R.p.records[d.rec - 1].data.Reason || "").trim());
  q(noReason.length ? "review" : "info", "Reasons", `${noReason.length} device(s) missing Reason`, noReason.length);
  const conf = devices.filter((d) => d.conflicts.length);
  if (conf.length) q("review", "Assignment", `${conf.length} device(s) where bin and Assigned To disagree (both kept)`, conf.length, conf.map((d) => `${d.id}: ${d.conflicts[0]}`));
  const ar = {}; devices.filter((d) => d.wfKey === "assignReview").forEach((d) => (ar[d.owner] = (ar[d.owner] || 0) + 1));
  for (const [name, n] of Object.entries(ar)) q("review", "Assignment", `${n} device(s) assigned to "${name}", who isn't on the technician list — Assignment review`, n);
  const unmappedBins = {}; devices.filter((d) => d.wfKey === "unmapped").forEach((d) => { const b = String(R.p.records[d.rec - 1].data["Bin Location"] || "").trim() || "(blank)"; unmappedBins[b] = (unmappedBins[b] || 0) + 1; });
  q("info", "Workflow", `${Object.keys(unmappedBins).length} bin values with no workflow rule (ordinary shelves or blank) — ${devices.filter((d) => d.wfKey === "unmapped").length} devices "Not mapped"`, Object.keys(unmappedBins).length,
    Object.entries(unmappedBins).sort((a, b) => b[1] - a[1]).map(([b, n]) => `${b}: ${n}`));
  const serial = devices.filter((d) => d.idKind === "Serial/other");
  if (serial.length) q("info", "Identifiers", `${serial.length} identifier(s) aren't 15-digit IMEIs (serials kept as given)`, serial.length, serial.map((d) => d.id));
  const notInCat = devices.filter((d) => d.flags.includes("SKU not in either catalog"));
  if (notInCat.length) q("info", "Joins", `${notInCat.length} device(s) whose SKU isn't in either catalog (exact SKU match)`, notInCat.length);

  const m = {
    batch: { id, importedAt: meta.importedAt, importedBy: meta.importedBy, files: meta.files.map(({ headers, ...f }) => ({ ...f, headers })) },
    settings: S, workflowOrder: WORKFLOW_ORDER,
    devices, skus: [...skus.values()], quality,
    headers: { repair: R ? R.p.headers : [], catalog: (SA || IN) ? (SA || IN).p.headers : [] },
    footers, salesRowMonthly: rowMonthly,
    inventoryFirstUnits: IN ? IN.p.records.filter((r) => !isFooter(r.data) && keySku(r.data.SKU)).reduce((n, r) => { const g = parseStock(r.data["Stock Summary"]).segments.find((x) => x.warehouse.toLowerCase() === "inventory"); return n + (g ? g.a : 0); }, 0) : null,
    // Original records, kept for the drawer and exports.
    raw: { repair: R ? R.p.records.map((r) => r.data) : [], sales: products, files: { repair: R && R.f.name, sales: SA && SA.f.name, inventory: IN && IN.f.name } },
  };
  cache.clear(); cache.set(key, m);
  return m;
}
const round2 = (x) => Math.round(x * 100) / 100;
const fmt = (x) => (x == null ? "—" : String(Math.round(x * 100) / 100));
const fmt1 = (x) => (x == null ? "—" : (Math.round(x * 10) / 10).toFixed(1));

/* What the browser gets: everything except the bulky original records (fetched per device). */
function clientView(m) {
  if (!m) return null;
  const { raw, ...rest } = m;
  return { ...rest, devices: m.devices.map((d) => ({ ...d, name: raw.repair[d.rec - 1].Name || "", bin: raw.repair[d.rec - 1]["Bin Location"] || "",
    assignedTo: raw.repair[d.rec - 1]["Assigned To"] || "", reason: raw.repair[d.rec - 1].Reason || "", notes: raw.repair[d.rec - 1].Notes || "" })) };
}
/* One device, with its complete original record and matching catalog rows. */
function deviceDetail(m, i) {
  const d = m.devices[i]; if (!d) return null;
  const p = m.raw.sales.get(d.sku) || {};
  const cat = [];
  for (const role of ["sales", "inventory"]) {
    if (p[role]) cat.push({ role, file: p[role].file, line: p[role].line, record: p[role].rec, data: p[role].data });
    for (const x of p["dup_" + role] || []) cat.push({ role, file: x.file, line: x.line, record: x.rec, data: x.data, duplicate: true });
  }
  return { device: d, original: { file: m.raw.files.repair, line: d.line, record: d.rec, data: m.raw.repair[d.rec - 1] }, catalog: cat, sku: m.skus.find((s) => s.sku === d.sku) || null };
}

module.exports = { parseCsv, inspect, validate, saveBatch, activate, batches, activeId, settings, saveSettings, overrides, setOverride, model, clientView, deviceDetail, num, parseStock, classify, DEFAULT_SETTINGS, WORKFLOW_ORDER };
