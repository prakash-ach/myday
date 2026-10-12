/* Repair Devices → a formatted Excel workbook of what's on screen (the
   current filters), built from the server's own data: nothing is taken from
   the browser except which rows and which filters. */
const xlsx = require("./xlsxw");
const LABEL = { red: "Red — Highest", amber: "Amber — Medium", green: "Green — Stock OK", gray: "Gray — No sales", blue: "Blue — Presold", purple: "Purple — Review" };
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

function build(m, { devices: devIdx, skus: skuKeys, filters, user }) {
  const D = (Array.isArray(devIdx) ? devIdx : m.devices.map((d) => d.i)).map((i) => m.devices[i]).filter(Boolean);
  const skuSet = new Set(Array.isArray(skuKeys) ? skuKeys : m.skus.map((s) => s.sku));
  const SK = m.skus.filter((s) => skuSet.has(s.sku));
  const rec = (d) => m.raw.repair[d.rec - 1] || {};
  const filterLines = Object.entries(filters || {}).filter(([, v]) => v && String(v).length).map(([k, v]) => `${k}: ${v}`);
  const head = (title) => [{ text: title, title: true },
    { text: `Batch ${m.batch.id} · imported ${m.batch.importedAt} by ${m.batch.importedBy} · exported ${new Date().toISOString()} by ${user}` },
    { text: `Active filters: ${filterLines.length ? filterLines.join(" · ") : "none (everything)"}` }];

  /* Overview */
  const count = (f) => D.filter(f).length;
  const econ = D.filter((d) => d.spread != null && d.money.selling > 0);
  const sum = (a, f) => a.reduce((n, x) => n + (f(x) || 0), 0);
  const ov = [
    ["Devices in this export", D.length, "filtered devices"], ["SKUs in this export", SK.length, "filtered SKUs"],
    ...m.workflowOrder.map((w) => [w, count((d) => d.wf === w), "devices"]),
    ["Unmapped devices available for assessment", count((d) => d.wf === "Not mapped" && !d.elig.length), "devices (no eligibility flags)"],
    ["Red SKUs (highest demand priority)", SK.filter((s) => s.priority === "red").length, "SKUs"],
    ["Selling stockouts with no repair candidates", SK.filter((s) => s.priority === "red" && s.candidates === 0).length, "SKUs — purchasing/substitution"],
    ["Devices with complete economics", econ.length, `of ${D.length}`],
    ["Devices missing Total Cost", count((d) => d.money.total == null), `of ${D.length}`],
    ["Reported Total Cost (complete-economics devices)", r2(sum(econ, (d) => d.money.total)), `${econ.length} devices`],
    ["Selling value (same devices)", r2(sum(econ, (d) => d.money.selling)), `${econ.length} devices`],
    ["Recorded spread (same devices)", r2(sum(econ, (d) => d.spread)), `${econ.length} devices`],
    ["Weighted margin %", econ.length ? r2(sum(econ, (d) => d.spread) / sum(econ, (d) => d.money.selling) * 100) : null, "total spread ÷ matched selling value"],
    ["Negative-spread devices", count((d) => d.spread != null && d.spread < 0), "devices"],
  ];
  const moneyRows = new Set(["Reported Total Cost (complete-economics devices)", "Selling value (same devices)", "Recorded spread (same devices)"]);

  /* Costs & margins: by workflow, owner, SKU */
  const group = (key) => {
    const g = new Map();
    for (const d of D) { const k = key(d) || "—"; const x = g.get(k) || { k, n: 0, econ: 0, missing: 0, cost: 0, sell: 0, spread: 0, neg: 0, purchaseKnown: 0 }; x.n++;
      if (d.money.total == null) x.missing++;
      if (d.spread != null && d.money.selling > 0) { x.econ++; x.cost += d.money.total; x.sell += d.money.selling; x.spread += d.spread; if (d.spread < 0) x.neg++; }
      g.set(k, x); }
    return [...g.values()].map((x) => ({ ...x, cost: r2(x.cost), sell: r2(x.sell), spread: r2(x.spread) })).sort((a, b) => b.cost - a.cost);
  };
  const costCols = (label) => [{ header: label, key: "k", width: 34 }, { header: "Devices", key: "n", type: "int", width: 10 }, { header: "With complete economics", key: "econ", type: "int", width: 14 },
    { header: "Missing Total Cost", key: "missing", type: "int", width: 12 }, { header: "Reported Total Cost", key: "cost", type: "money", width: 16 },
    { header: "Selling value (same devices)", key: "sell", type: "money", width: 16 }, { header: "Recorded spread", key: "spread", type: "money", width: 15 },
    { header: "Weighted margin %", get: (x) => (x.sell > 0 ? r2(x.spread / x.sell * 100) : null), type: "pct", width: 12 }, { header: "Negative-spread devices", key: "neg", type: "int", width: 12 }];

  const sheets = [
    { name: "Overview", preface: head("Repair Devices — overview"), columns: [{ header: "Measure", key: 0, width: 52 }, { header: "Value", get: (r) => r[1], type: "num", width: 16 }, { header: "Population / note", key: 2, width: 40 }],
      rows: ov.map((r) => ({ 0: r[0], 1: r[1], 2: moneyRows.has(r[0]) ? `${r[2]} · USD` : r[2] })) },
    { name: "SKU priorities", preface: head("SKU priorities — demand, stock and repair pipeline"), freezeCols: 1, columns: [
      { header: "SKU", key: "sku", width: 18 }, { header: "Product", key: "name", width: 52 },
      { header: "Demand priority", get: (s) => ({ v: LABEL[s.priority], fill: s.priority }), width: 18 },
      { header: "Monthly sale", key: "monthly", type: "num", width: 10 }, { header: "Weekly sale", key: "weekly", type: "num", width: 10 },
      { header: `Available (${m.settings.availabilityWarehouse}, ${m.settings.availabilityQuantity} number)`, key: "available", type: "num", width: 14 },
      { header: "Availability source", key: "availSource", width: 24 }, { header: "Stock Summary (original)", key: "stockRaw", width: 40 },
      { header: "Coverage days", get: (s) => r2(s.coverage), type: "num", width: 10 }, { header: "Target units", key: "target", type: "int", width: 9 },
      { header: "Shortage", key: "shortage", type: "int", width: 9 }, { header: "Repair devices", key: "repairDevices", type: "int", width: 9 },
      ...m.workflowOrder.map((w) => ({ header: w, get: (s) => s.byWf[w] || 0, type: "int", width: 11 })),
      { header: "Assessment candidates", key: "candidates", type: "int", width: 11 }, { header: "Provisional assessment limit", key: "limit", type: "int", width: 12 },
      { header: "Catalog price", key: "price", type: "money", width: 12 }, { header: "Catalog cost", key: "cost", type: "money", width: 12 },
      { header: "Catalog margin %", key: "marginSrc", type: "pct", width: 10 }, { header: "Currency", key: "currency", width: 8 }, { header: "Why", key: "why", width: 60 }],
      rows: SK.slice().sort(cmpSku) },
    { name: "Devices", preface: head("Devices — IMEI-level workflow status"), freezeCols: 1, columns: [
      { header: "IMEI / serial", key: "id", width: 18 }, { header: "ID type", key: "idKind", width: 12 }, { header: "SKU", key: "sku", width: 16 },
      { header: "Product", get: (d) => rec(d).Name, width: 46 },
      { header: "Priority", get: (d) => ({ v: LABEL[d.priority], fill: d.priority }), width: 17 },
      { header: "SKU demand priority", get: (d) => ({ v: LABEL[d.demand], fill: d.demand }), width: 17 },
      { header: "Workflow status", key: "wf", width: 20 }, { header: "Owner / route", key: "owner", width: 22 }, { header: "Next action", key: "action", width: 40 },
      { header: "Repair done month", key: "doneMonth", type: "int", width: 10 }, { header: "Bin Location (original)", get: (d) => rec(d)["Bin Location"], width: 22 },
      { header: "Assigned To (original)", get: (d) => rec(d)["Assigned To"], width: 20 }, { header: "Reason (original)", get: (d) => rec(d).Reason, width: 30 },
      { header: "Eligibility evidence", get: (d) => d.elig.join(", "), width: 18 },
      { header: "Purchase price", get: (d) => d.money.purchase, type: "money", width: 12 }, { header: "Additional cost", get: (d) => d.money.additional, type: "money", width: 12 },
      { header: "Repair / labor / other", get: (d) => d.money.repair, type: "money", width: 12 }, { header: "Total cost (reported)", get: (d) => d.money.total, type: "money", width: 13 },
      { header: "Selling price", get: (d) => d.money.selling, type: "money", width: 12 }, { header: "Source margin %", get: (d) => d.money.marginSrc, type: "pct", width: 10 },
      { header: "Recorded spread", key: "spread", type: "money", width: 12 }, { header: "Calculated margin %", key: "calcMargin", type: "pct", width: 11 },
      { header: "Missing", get: (d) => d.missing.join(", "), width: 16 }, { header: "Review notes", get: (d) => [...d.flags, ...d.conflicts].join("; "), width: 40 },
      { header: "Notes (original)", get: (d) => rec(d).Notes, width: 40 }, { header: "Source", get: (d) => `${m.raw.files.repair} line ${d.line}`, width: 30 }],
      rows: D },
    { name: "Costs by workflow", preface: head("Costs & margins by workflow (recorded spread, not forecast profit)"), columns: costCols("Workflow status"), rows: group((d) => d.wf) },
    { name: "Costs by owner", preface: head("Costs & margins by owner / technician"), columns: costCols("Owner / route"), rows: group((d) => d.owner) },
    { name: "Costs by SKU", preface: head("Costs & margins by SKU"), columns: costCols("SKU"), rows: group((d) => d.sku) },
    { name: "Rules & sources", width: 130, preface: [
      { text: "Rules, assumptions and sources", title: true },
      { text: `Batch ${m.batch.id}, imported ${m.batch.importedAt} by ${m.batch.importedBy}.` },
      ...m.batch.files.map((f) => ({ text: `${f.role}: ${f.name} — ${f.rows} rows${f.products != null ? `, ${f.products} products, ${f.footers} footer` : ""}; sha256 ${f.sha256}` })),
      { text: `Active filters: ${filterLines.length ? filterLines.join(" · ") : "none"}` },
      { text: `ASSUMPTIONS (configurable): sales window ${m.settings.salesWindowDays} days; low stock under ${m.settings.lowStockDays} days; target cover ${m.settings.targetCoverDays} days; availability = ${m.settings.availabilityQuantity} number of the "${m.settings.availabilityWarehouse}" pair in Stock Summary (provisional proxy); exports treated as ${m.settings.completeness}; low margin under ${m.settings.lowMarginPct}%.` },
      { text: "daily_demand = monthly_sales / sales_window_days · coverage_days = available / daily_demand (undefined when demand is 0) · target_units = ceil(daily_demand × target_cover_days) · shortage = max(0, target − available) · assessment limit = min(unassigned assessment candidates, shortage) — provisional, not a work order." },
      { text: "recorded_spread = selling price − reported total cost · calculated margin = spread / selling price × 100 (only with positive selling price) · weighted margin = total spread / matched selling value. Missing Total Cost leaves spread and margin unknown. A recorded spread is not a forecast of repair profit." },
      { text: "Priority colours: Red — sells with no stock or under the low-stock days · Amber — below target cover · Green — meets target · Gray — no recorded sales · Blue — presold, no action · Purple — needs review (unknown sales/stock, conflicts, duplicates, unconfirmed assignees, bad bins)." },
      { text: "Workflow: presold first; Bin-N001 = repair done in month N; Cleaning → Arika; technician bins and recognised Assigned To → Repair in Progress; no power Device → Board-level; OVERSEAS UNLOCKED DEVICES → Blacklisted - Leave; Testers For RMA/QC → RMA/QC - Leave; Bibek bins → Give to Bibek (With Bibek only with a recorded handoff); unknown assignees → Assignment review; other bins → Not mapped." },
      ...(m.footers || []).map((f) => ({ text: `Footer excluded: ${f.file} line ${f.line} (Monthly ${f.monthly ?? "—"}, Weekly ${f.weekly ?? "—"})` })),
      ...m.quality.filter((q) => q.level !== "info").map((q) => ({ text: `${q.area}: ${q.msg}` })),
    ] },
  ];
  return xlsx.build(sheets);
}
const ORDER = { red: 0, amber: 1, purple: 2, green: 3, gray: 4, blue: 5 };
function cmpSku(a, b) {
  return (ORDER[a.priority] - ORDER[b.priority]) || ((a.coverage == null ? 1e9 : a.coverage) - (b.coverage == null ? 1e9 : b.coverage)) || ((b.daily || 0) - (a.daily || 0)) || a.sku.localeCompare(b.sku);
}
module.exports = { build, cmpSku, LABEL };
