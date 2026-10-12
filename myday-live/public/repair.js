/* Repair Devices — the screen.
 * Six tabs over one active batch. Filters are shared and kept when you
 * switch tabs; every chart bar and card applies its filter. All imported
 * text is escaped — notes never render as HTML. */
(function () {
  "use strict";
  const ctx = () => window.__myday || null;
  const TABS = [["overview", "Overview"], ["explorer", "Device Explorer"], ["skus", "SKU Priorities"], ["workflow", "Repair Workflow"], ["money", "Costs & Margins"], ["files", "Files & Data Quality"]];
  const PRI = { red: "Red — Highest", amber: "Amber — Medium", green: "Green — Stock OK", gray: "Gray — No sales", blue: "Blue — Presold", purple: "Purple — Review" };
  const PRI_ORDER = { red: 0, amber: 1, purple: 2, green: 3, gray: 4, blue: 5 };
  const FIN = { complete: "Complete economics", missingTotal: "Missing Total Cost", negative: "Negative spread", low: "Low margin" };
  const PAGE = 50;
  const S = { host: null, data: null, err: "", loading: false, tab: "overview", f: blankF(), page: { dev: 0, sku: 0 },
    sort: { dev: { k: "priority", dir: 1 }, sku: { k: "priority", dir: 1 } }, skuScope: "all", drawer: null, upload: null, busy: "" };
  function blankF() { return { q: "", pri: "", wf: "", owner: "", bin: "", issue: "", fin: "", sku: "" }; }
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const money = (n) => (n == null ? "—" : Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" }));
  const num = (n, d = 0) => (n == null ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: d }));
  const pct = (n) => (n == null ? "—" : Number(n).toFixed(2) + "%");
  const badge = (p) => `<span class="rp-pri ${p}">${esc(PRI[p] || p)}</span>`;
  const normBin = (s) => String(s || "").trim().replace(/\s+/g, " ");

  /* ---------- data ---------- */
  async function load() {
    S.loading = true; draw();
    try { const r = await fetch("/api/repair/data", { credentials: "same-origin" }); const j = await r.json(); if (!r.ok) S.err = j.error || "Couldn't load"; else { S.data = j.empty ? null : j; S.err = ""; } }
    catch (e) { S.err = "Couldn't reach the server"; }
    S.loading = false; draw();
  }
  const post = (u, b) => fetch(u, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(b || {}) })
    .then((r) => r.json().then((j) => ({ ok: r.ok, j }))).catch(() => ({ ok: false, j: { error: "Couldn't reach the server" } }));

  /* ---------- filtering (shared by every tab) ---------- */
  function devMatches(d, f, skip) {
    if (f.q && skip !== "q") { const q = f.q.toLowerCase(); if (![d.id, d.sku, d.name, d.reason, d.notes].some((x) => String(x || "").toLowerCase().includes(q))) return false; }
    if (f.pri && skip !== "pri" && d.priority !== f.pri) return false;
    if (f.wf && skip !== "wf" && d.wf !== f.wf) return false;
    if (f.owner && skip !== "owner" && d.owner !== f.owner) return false;
    if (f.bin && skip !== "bin" && (normBin(d.bin) || "(blank)").toLowerCase() !== f.bin.toLowerCase()) return false;
    if (f.issue && skip !== "issue" && !d.issues.includes(f.issue)) return false;
    if (f.sku && skip !== "sku" && d.sku !== f.sku) return false;
    if (f.fin && skip !== "fin") {
      if (f.fin === "complete" && !(d.spread != null && d.money.selling > 0)) return false;
      if (f.fin === "missingTotal" && d.money.total != null) return false;
      if (f.fin === "negative" && !(d.spread != null && d.spread < 0)) return false;
      if (f.fin === "low" && !d.lowMargin) return false;
    }
    return true;
  }
  const devices = () => (S.data ? S.data.devices.filter((d) => devMatches(d, S.f)) : []);
  const deviceFilterOn = () => ["wf", "owner", "bin", "issue", "fin"].some((k) => S.f[k]);
  function skus() {
    if (!S.data) return [];
    const f = S.f, q = f.q.toLowerCase();
    let list = S.data.skus.filter((s) => (!f.pri || s.priority === f.pri) && (!f.sku || s.sku === f.sku) && (!q || s.sku.toLowerCase().includes(q) || String(s.name || "").toLowerCase().includes(q)));
    if (S.skuScope === "devices") list = list.filter((s) => s.repairDevices > 0);
    if (S.skuScope === "nocand") list = list.filter((s) => s.priority === "red" && s.candidates === 0);
    if (S.skuScope === "nosales") list = list.filter((s) => s.priority === "gray" && s.repairDevices > 0);
    if (deviceFilterOn()) { const has = new Set(devices().map((d) => d.sku)); list = list.filter((s) => has.has(s.sku)); }
    return list;
  }
  function setF(k, v, tab) { S.f[k] = S.f[k] === v ? "" : v; S.page = { dev: 0, sku: 0 }; if (tab) S.tab = tab; draw(); }

  /* ---------- sorting ---------- */
  const devKey = { priority: (d) => [PRI_ORDER[d.priority], d.id], id: (d) => d.id, sku: (d) => d.sku, wf: (d) => d.wf, owner: (d) => d.owner, bin: (d) => normBin(d.bin),
    total: (d) => d.money.total ?? -Infinity, selling: (d) => d.money.selling ?? -Infinity, spread: (d) => d.spread ?? -Infinity, margin: (d) => d.calcMargin ?? -Infinity };
  const cmp = (a, b) => (Array.isArray(a) ? (a[0] - b[0]) || String(a[1]).localeCompare(String(b[1])) : typeof a === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true }));
  function sortDev(list) { const { k, dir } = S.sort.dev, f = devKey[k] || devKey.priority; return list.slice().sort((a, b) => cmp(f(a), f(b)) * dir || a.i - b.i); }
  const skuKey = { priority: null, sku: (s) => s.sku, monthly: (s) => s.monthly ?? -1, available: (s) => s.available ?? -1, coverage: (s) => s.coverage ?? 1e9, shortage: (s) => s.shortage ?? -1,
    repairDevices: (s) => s.repairDevices, candidates: (s) => s.candidates, limit: (s) => s.limit ?? -1 };
  function sortSku(list) {
    const { k, dir } = S.sort.sku;
    if (k === "priority") return list.slice().sort((a, b) => ((PRI_ORDER[a.priority] - PRI_ORDER[b.priority]) || ((a.coverage ?? 1e9) - (b.coverage ?? 1e9)) || ((b.daily || 0) - (a.daily || 0)) || a.sku.localeCompare(b.sku)) * dir);
    return list.slice().sort((a, b) => cmp(skuKey[k](a), skuKey[k](b)) * dir || a.sku.localeCompare(b.sku));
  }
  const th = (table, k, label, cls) => `<th class="${cls || ""}"><button data-sort="${table}:${k}" aria-label="Sort by ${esc(label)}">${esc(label)}${S.sort[table].k === k ? (S.sort[table].dir > 0 ? " ▲" : " ▼") : ""}</button></th>`;

  /* ---------- pieces ---------- */
  const card = (label, value, sub, act, tone) => `<button class="rp-card ${tone || ""}" ${act ? `data-act="${esc(act)}"` : "disabled"}><small>${esc(label)}</small><b>${value}</b><span>${sub || ""}</span></button>`;
  function bars(title, rows, act, opts = {}) {
    const max = Math.max(1, ...rows.map((r) => r.n));
    return `<div class="rp-panel"><h4>${esc(title)}</h4>${rows.length ? rows.map((r) => `<button class="rp-bar ${r.on ? "on" : ""}" data-act="${esc(act + ":" + r.k)}" aria-label="${esc(r.label)}: ${r.n}">
      <span class="lbl">${r.badge ? badge(r.k) : esc(r.label)}</span><span class="trk"><i class="${r.color || ""}" style="width:${(r.n / max) * 100}%"></i></span><span class="n">${num(r.n)}</span></button>`).join("") : `<p class="rp-dim">Nothing in this selection.</p>`}
      ${opts.note ? `<p class="rp-dim">${opts.note}</p>` : ""}</div>`;
  }
  const countBy = (list, key) => { const m = new Map(); for (const x of list) { const k = key(x); if (k == null || k === "") continue; m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  function chips() {
    const f = S.f, list = [];
    if (f.q) list.push(["q", `Search: "${f.q}"`]); if (f.pri) list.push(["pri", PRI[f.pri]]); if (f.wf) list.push(["wf", "Workflow: " + f.wf]);
    if (f.owner) list.push(["owner", "Owner: " + f.owner]); if (f.bin) list.push(["bin", "Bin: " + f.bin]); if (f.issue) list.push(["issue", "Issue: " + f.issue]);
    if (f.fin) list.push(["fin", FIN[f.fin]]); if (f.sku) list.push(["sku", "SKU: " + f.sku]);
    return list.length ? `<div class="rp-chips" aria-label="Active filters">${list.map(([k, l]) => `<span class="rp-chip">${esc(l)}<button data-unset="${k}" aria-label="Remove filter ${esc(l)}">✕</button></span>`).join("")}<button class="rp-link" data-clear>Clear filters</button></div>` : "";
  }
  function econ(list) {
    const e = list.filter((d) => d.spread != null && d.money.selling > 0);
    const s = (f) => e.reduce((n, d) => n + f(d), 0);
    const cost = s((d) => d.money.total), sell = s((d) => d.money.selling), spread = s((d) => d.spread);
    return { n: list.length, complete: e.length, missingTotal: list.filter((d) => d.money.total == null).length, cost, sell, spread, margin: sell > 0 ? (spread / sell) * 100 : null,
      negative: list.filter((d) => d.spread != null && d.spread < 0).length, low: list.filter((d) => d.lowMargin).length };
  }

  /* ---------- tabs ---------- */
  function overview() {
    const D = devices(), K = skus(), E = econ(D);
    const wf = (w) => D.filter((d) => d.wf === w).length;
    const redCand = D.filter((d) => d.priority === "red" && d.wf === "Not mapped" && !d.elig.length).length;
    const stockouts = S.data.skus.filter((s) => s.priority === "red" && s.candidates === 0 && (!S.f.pri || S.f.pri === "red")).length;
    const issues = countBy(D.flatMap((d) => d.issues.map((x) => ({ x }))), (o) => o.x).slice(0, 10);
    return `<div class="rp-cards">
      ${card("Devices", num(D.length), `${num(S.data.devices.length)} in batch`)}${card("SKUs", num(K.length), `${num(S.data.skus.length)} across all files`)}
      ${card("Presold — no action", num(wf("No action - Presold")), "good, retained for reporting", "wf:No action - Presold", "blue")}
      ${card("Repair in Progress", num(wf("Repair in Progress")), "already with technicians", "wf:Repair in Progress")}
      ${card("Process & move + cleaning", num(wf("Process and Move") + wf("Cleaning")), `${num(wf("Process and Move"))} processing · ${num(wf("Cleaning"))} cleaning`, "wf:Process and Move")}
      ${card("Unassigned highest-priority", num(redCand), "red demand, not mapped, no eligibility flags", "redcand", "red")}
      ${card("Reported cost exposure", money(E.cost), `${num(E.complete)} devices with complete economics`, "fin:complete")}
      ${card("Missing Total Cost", num(E.missingTotal), `of ${num(E.n)} devices — spread unknown`, "fin:missingTotal", "purple")}
      ${card("Selling stockouts, no repair candidate", num(stockouts), "purchasing / substitution gap", "nocand", "red")}
    </div>
    <div class="rp-grid">
      ${bars("Devices by priority", ["red", "amber", "purple", "green", "gray", "blue"].map((k) => ({ k, label: PRI[k], n: D.filter((d) => d.priority === k).length, color: k, badge: true, on: S.f.pri === k })), "pri")}
      ${bars("Workflow", S.data.workflowOrder.map((w) => ({ k: w, label: w, n: wf(w), on: S.f.wf === w })).filter((r) => r.n), "wf")}
      ${bars("Technician workload (Repair in Progress)", countBy(D.filter((d) => d.wf === "Repair in Progress"), (d) => d.owner).map(([k, n]) => ({ k, label: k, n, on: S.f.owner === k })), "owner")}
      ${bars("Most common repair issues", issues.map(([k, n]) => ({ k, label: k, n, on: S.f.issue === k })), "issue", { note: "A device can have several issues." })}
      ${bars("SKU demand priorities", ["red", "amber", "purple", "green", "gray"].map((k) => ({ k, label: PRI[k], n: K.filter((s) => s.priority === k).length, color: k, badge: true, on: S.f.pri === k })), "skupri",
        { note: "Counts SKUs (including SKUs with no repair devices)." })}
    </div>`;
  }

  function devTable(list, opts = {}) {
    const p = Math.min(S.page.dev, Math.max(0, Math.ceil(list.length / PAGE) - 1)), rows = sortDev(list).slice(p * PAGE, p * PAGE + PAGE);
    return `<div class="rp-tablewrap"><table class="rp-table"><thead><tr>
      ${th("dev", "id", "IMEI / serial")}${th("dev", "sku", "SKU · product")}${th("dev", "priority", "Priority")}${th("dev", "wf", "Workflow")}${th("dev", "owner", "Owner / route")}
      <th>Next action</th>${th("dev", "bin", "Bin")}<th>Reasons</th>${th("dev", "total", "Total cost", "n")}${th("dev", "selling", "Selling", "n")}${th("dev", "spread", "Spread", "n")}${th("dev", "margin", "Margin", "n")}
      </tr></thead><tbody>${rows.map((d) => `<tr tabindex="0" data-dev="${d.i}" aria-label="Open device ${esc(d.id || "(no id)")}">
        <td class="mono">${esc(d.id || "(none)")}${d.idKind !== "IMEI" ? `<small>${esc(d.idKind)}</small>` : ""}</td>
        <td><span class="mono">${esc(d.sku)}</span><small>${esc(d.name)}</small></td><td>${badge(d.priority)}${d.priority !== d.demand && d.priority !== "blue" ? `<small>SKU demand: ${esc(PRI[d.demand])}</small>` : ""}</td>
        <td>${esc(d.wf)}${d.doneMonth ? `<small>done month ${d.doneMonth}</small>` : ""}${d.conflicts.length ? `<small class="warn">⚠ conflict</small>` : ""}</td><td>${esc(d.owner)}</td><td><small>${esc(d.action)}</small></td>
        <td>${esc(normBin(d.bin) || "—")}</td><td><small>${esc(d.reason || "—")}</small>${d.elig.length ? `<small class="warn">${esc(d.elig.join(", "))}</small>` : ""}</td>
        <td class="n">${money(d.money.total)}</td><td class="n">${money(d.money.selling)}</td><td class="n ${d.spread < 0 ? "neg" : ""}">${money(d.spread)}</td><td class="n">${pct(d.calcMargin)}</td></tr>`).join("")
        || `<tr><td colspan="12" class="rp-empty">No devices match these filters.</td></tr>`}</tbody></table></div>${pager("dev", list.length, p)}`;
  }
  const pager = (t, n, p) => { const pages = Math.max(1, Math.ceil(n / PAGE)); return `<div class="rp-pager"><span>${num(n)} ${t === "dev" ? "devices" : "SKUs"} · page ${p + 1} of ${pages}</span>
    <button data-page="${t}:0" ${p === 0 ? "disabled" : ""}>« First</button><button data-page="${t}:${p - 1}" ${p === 0 ? "disabled" : ""}>‹ Prev</button>
    <button data-page="${t}:${p + 1}" ${p >= pages - 1 ? "disabled" : ""}>Next ›</button><button data-page="${t}:${pages - 1}" ${p >= pages - 1 ? "disabled" : ""}>Last »</button></div>`; };

  function explorer() {
    const D = devices(), all = S.data.devices;
    const opt = (k, list, label) => `<label>${label}<select data-f="${k}"><option value="">All</option>${list.map(([v, n]) => `<option value="${esc(v)}" ${S.f[k] === v ? "selected" : ""}>${esc(v)} (${num(n)})</option>`).join("")}</select></label>`;
    const base = (k) => all.filter((d) => devMatches(d, S.f, k));
    return `<div class="rp-filters">
      <label>Priority<select data-f="pri"><option value="">All</option>${Object.keys(PRI).map((k) => `<option value="${k}" ${S.f.pri === k ? "selected" : ""}>${PRI[k]}</option>`).join("")}</select></label>
      ${opt("wf", countBy(base("wf"), (d) => d.wf), "Workflow")}${opt("owner", countBy(base("owner"), (d) => d.owner), "Owner / technician")}
      ${opt("bin", countBy(base("bin"), (d) => normBin(d.bin) || "(blank)").slice(0, 400), "Bin")}${opt("issue", countBy(base("issue").flatMap((d) => d.issues.map((x) => ({ x }))), (o) => o.x).slice(0, 300), "Issue")}
      <label>Financial<select data-f="fin"><option value="">All</option>${Object.entries(FIN).map(([k, l]) => `<option value="${k}" ${S.f.fin === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    </div>${devTable(D)}`;
  }

  function skuTab() {
    const K = skus(), p = Math.min(S.page.sku, Math.max(0, Math.ceil(K.length / PAGE) - 1)), rows = sortSku(K).slice(p * PAGE, p * PAGE + PAGE);
    const scope = [["all", "All SKUs"], ["devices", "With repair devices"], ["nocand", "Selling stockouts with no repair candidates"], ["nosales", "No sales but in repair (assortment review)"]];
    return `<div class="rp-filters">${scope.map(([k, l]) => `<button class="rp-tog ${S.skuScope === k ? "on" : ""}" data-scope="${k}">${esc(l)}</button>`).join("")}</div>
      ${deviceFilterOn() ? `<p class="rp-note">Showing SKUs that have devices matching your device filters. Sales, stock and repair counts in this table are for the <b>whole SKU</b>, not just the filtered devices.</p>` : ""}
      <div class="rp-tablewrap"><table class="rp-table"><thead><tr>${th("sku", "sku", "SKU · product")}${th("sku", "priority", "Priority")}${th("sku", "monthly", "Monthly / weekly", "n")}
      ${th("sku", "available", "Available", "n")}<th>Stock pairs (original)</th>${th("sku", "coverage", "Coverage days", "n")}<th class="n">Target</th>${th("sku", "shortage", "Shortage", "n")}
      ${th("sku", "repairDevices", "Repair devices", "n")}<th>By workflow</th>${th("sku", "candidates", "Candidates", "n")}${th("sku", "limit", "Provisional limit", "n")}<th class="n">Catalog price · cost · margin</th><th>Why</th></tr></thead>
      <tbody>${rows.map((s) => `<tr tabindex="0" data-sku="${esc(s.sku)}" aria-label="Open SKU ${esc(s.sku)}"><td><span class="mono">${esc(s.sku)}</span><small>${esc(s.name || "—")}</small></td><td>${badge(s.priority)}</td>
        <td class="n">${num(s.monthly)} / ${num(s.weekly)}<small>${esc(s.monthlySource)}</small></td><td class="n">${num(s.available)}<small>${esc(s.availSource)}</small></td>
        <td><small>${esc(s.stockSegments.map((g) => `${g.warehouse} ${g.a}/${g.b}`).join(" · ") || "—")}</small></td><td class="n">${s.coverage == null ? "—" : num(s.coverage, 1)}</td><td class="n">${num(s.target)}</td><td class="n">${num(s.shortage)}</td>
        <td class="n">${num(s.repairDevices)}</td><td><small>${esc(Object.entries(s.byWf).map(([w, n]) => `${w} ${n}`).join(" · ") || "—")}</small></td><td class="n">${num(s.candidates)}</td><td class="n">${num(s.limit)}</td>
        <td class="n">${money(s.price)}<small>${money(s.cost)} · ${pct(s.marginSrc)}</small></td><td><small>${esc(s.why)}</small></td></tr>`).join("") || `<tr><td colspan="14" class="rp-empty">No SKUs match.</td></tr>`}</tbody></table></div>
      ${pager("sku", K.length, p)}<p class="rp-dim">Provisional limit = min(assessment candidates, shortage). It's a ceiling to look at, not a work order. Inbound and allocated repair completions aren't in these files, so they're not subtracted.</p>`;
  }

  function workflow() {
    const D = devices(), order = S.data.workflowOrder;
    const q = order.map((w) => { const l = D.filter((d) => d.wf === w); return { w, n: l.length, action: l[0] ? l[0].action : "" }; });
    const techs = countBy(D.filter((d) => d.wf === "Repair in Progress"), (d) => d.owner);
    return `<div class="rp-cards">${q.map((x) => card(x.w, num(x.n), esc(x.action || ""), "wf:" + x.w, { "No action - Presold": "blue", "Assignment review": "purple", "Bin review": "purple" }[x.w] || "")).join("")}</div>
      <div class="rp-grid">${bars("Technician workload", techs.map(([k, n]) => ({ k, label: k, n, on: S.f.owner === k })), "owner", { note: "Technician bins, plus recognised technicians in Assigned To on shelves without a rule." })}
      ${bars("Assignment review by assignee", countBy(D.filter((d) => d.wf === "Assignment review"), (d) => d.owner).map(([k, n]) => ({ k, label: k, n })), "owner", { note: "Not on the technician list — confirm their role." })}</div>
      <h3 class="rp-h">${S.f.wf ? esc(S.f.wf) : "All devices"} <small>— click a queue above to narrow</small></h3>${devTable(D)}`;
  }

  function moneyTab() {
    const D = devices(), E = econ(D), cov = E.n ? Math.round((E.complete / E.n) * 100) : 0;
    const group = (key) => { const g = new Map(); for (const d of D) { const k = key(d) || "—"; const x = g.get(k) || []; x.push(d); g.set(k, x); } return [...g.entries()].map(([k, l]) => ({ k, ...econ(l) })).sort((a, b) => b.cost - a.cost); };
    const gtable = (title, rows, act) => `<div class="rp-panel"><h4>${esc(title)}</h4><div class="rp-tablewrap"><table class="rp-table small"><thead><tr><th></th><th class="n">Devices</th><th class="n">Complete</th><th class="n">Missing total</th><th class="n">Reported cost</th><th class="n">Selling (same)</th><th class="n">Spread</th><th class="n">Weighted margin</th><th class="n">Negative</th></tr></thead>
      <tbody>${rows.slice(0, 25).map((r) => `<tr tabindex="0" data-act="${esc(act + ":" + r.k)}"><td>${esc(r.k)}</td><td class="n">${num(r.n)}</td><td class="n">${num(r.complete)}</td><td class="n">${num(r.missingTotal)}</td><td class="n">${money(r.cost)}</td><td class="n">${money(r.sell)}</td><td class="n ${r.spread < 0 ? "neg" : ""}">${money(r.spread)}</td><td class="n">${pct(r.margin)}</td><td class="n">${num(r.negative)}</td></tr>`).join("")}</tbody></table></div></div>`;
    return `<div class="rp-filters">${Object.entries(FIN).map(([k, l]) => `<button class="rp-tog ${S.f.fin === k ? "on" : ""}" data-act="fin:${k}">${esc(l)}</button>`).join("")}</div>
      <div class="rp-cards">
        ${card("Devices with complete economics", num(E.complete), `of ${num(E.n)} (${cov}%) — the population for the totals below`)}
        ${card("Reported total cost", money(E.cost), `${num(E.complete)} devices`)}${card("Selling value", money(E.sell), `same ${num(E.complete)} devices`)}
        ${card("Recorded spread", money(E.spread), `same ${num(E.complete)} devices — not forecast profit`)}${card("Weighted margin", pct(E.margin), "total spread ÷ matched selling value")}
        ${card("Missing Total Cost", num(E.missingTotal), `of ${num(E.n)} — spread unknown`, "fin:missingTotal", "purple")}
        ${card("Negative spread", num(E.negative), "devices", "fin:negative", "red")}${card(`Low margin (< ${S.data.settings.lowMarginPct}%)`, num(E.low), "devices", "fin:low", "amber")}
      </div>
      <p class="rp-note">Recorded spread = selling price − reported Total Cost, only where both exist. Missing Total Cost isn't replaced with purchase price. Future parts, labour, fees, returns and actual sale prices aren't in these files, so this isn't a profit forecast.</p>
      <div class="rp-grid">${gtable("By workflow", group((d) => d.wf), "wf")}${gtable("By owner / technician", group((d) => d.owner), "owner")}${gtable("By SKU (top 25 by cost)", group((d) => d.sku), "sku")}</div>
      <h3 class="rp-h">Devices</h3>${devTable(D)}`;
  }

  function files() {
    const d = S.data, st = S.state || {};
    const lv = { error: "rp-pri red", review: "rp-pri purple", warn: "rp-pri amber", info: "rp-pri gray" };
    return `<div class="rp-row"><button class="rp-pri-btn" data-upload>⬆ Upload new files</button><span class="rp-dim">Three CSV files: repair stock, sales catalog, inventory catalog. Roles are read from the columns and values — filenames can be anything.</span></div>
      ${d ? `<div class="rp-panel"><h4>Active batch ${esc(d.batch.id)}</h4><p class="rp-dim">Imported ${esc(d.batch.importedAt)} by ${esc(d.batch.importedBy)}</p>
        <div class="rp-tablewrap"><table class="rp-table small"><thead><tr><th>Role</th><th>File</th><th class="n">Rows</th><th class="n">Products</th><th class="n">Footers</th><th>Headers</th><th>SHA-256</th></tr></thead><tbody>
        ${d.batch.files.map((f) => `<tr><td>${esc(f.role)}</td><td>${esc(f.name)}</td><td class="n">${num(f.rows)}</td><td class="n">${num(f.products)}</td><td class="n">${num(f.footers)}</td>
          <td><details><summary>${f.headers.length} columns</summary><small>${f.headers.map(esc).join(" · ")}</small></details></td><td class="mono"><small>${esc(f.sha256.slice(0, 16))}…</small></td></tr>`).join("")}</tbody></table></div></div>` : ""}
      <div class="rp-panel"><h4>Data quality</h4>${d ? d.quality.map((x) => `<details class="rp-q"><summary><span class="${lv[x.level] || "rp-pri gray"}">${esc(x.level)}</span> <b>${esc(x.area)}</b> — ${esc(x.msg)}</summary>
        ${x.items ? `<ul>${x.items.map((i) => `<li>${esc(i)}</li>`).join("")}${x.count > x.items.length ? `<li>… and ${num(x.count - x.items.length)} more</li>` : ""}</ul>` : ""}</details>`).join("") : `<p class="rp-dim">No batch yet.</p>`}</div>
      <div class="rp-panel"><h4>Assumptions & settings <small>(labelled defaults — change once the business meaning is confirmed)</small></h4>${settingsForm()}</div>
      <div class="rp-panel"><h4>Batch history</h4>${(st.batches || []).length ? `<div class="rp-tablewrap"><table class="rp-table small"><thead><tr><th>Batch</th><th>Imported</th><th>By</th><th>Files</th><th></th></tr></thead><tbody>
        ${st.batches.map((b) => `<tr><td class="mono">${esc(b.id)}${b.repeatOf ? `<small>same files as ${esc(b.repeatOf)}</small>` : ""}</td><td>${esc(b.importedAt)}</td><td>${esc(b.importedBy)}</td><td><small>${b.files.map((f) => `${esc(f.role)}: ${esc(f.name)} (${num(f.rows)})`).join("<br>")}</small></td>
          <td>${b.id === st.active ? `<b>Active</b>` : `<button class="rp-link" data-activate="${esc(b.id)}">Make active</button>`}</td></tr>`).join("")}</tbody></table></div>
        <p class="rp-dim">Each batch is a separate snapshot. Re-importing the same files never adds to counts.</p>` : `<p class="rp-dim">No batches yet.</p>`}</div>
      <div class="rp-panel"><h4>Definitions</h4><ul class="rp-defs">
        <li><b>Demand priority</b> (per SKU): Red — sells with no stock or under ${esc(st.settings ? st.settings.lowStockDays : 7)} days of cover · Amber — below target · Green — meets target · Gray — no recorded sales · Purple — unknown or conflicting data. Blue marks presold devices.</li>
        <li><b>Workflow status</b> (per device) comes from Reason, Bin Location and Assigned To. <b>Eligibility</b> (blacklist, activation/MDM lock, rejected, teardown, parts only) is evidence kept separately. A red SKU never means "reassign a device that's already with a technician".</li>
        <li>daily demand = monthly ÷ window · coverage = available ÷ daily (undefined at zero demand) · target = ⌈daily × target days⌉ · shortage = max(0, target − available).</li>
        <li>Missing values stay missing: no file, an absent SKU (unless the export is confirmed complete), a failed parse or a conflict never becomes zero.</li></ul></div>`;
  }
  function settingsForm() {
    const s = (S.state && S.state.settings) || {};
    const n = (k, l, min, max) => `<label>${l}<input type="number" min="${min}" max="${max}" data-set="${k}" value="${esc(s[k])}"></label>`;
    return `<div class="rp-filters">${n("salesWindowDays", "Sales window (days)", 1, 366)}${n("lowStockDays", "Low stock under (days)", 0, 365)}${n("targetCoverDays", "Target cover (days)", 1, 365)}${n("lowMarginPct", "Low margin under (%)", -100, 100)}
      <label>Availability warehouse<input data-set="availabilityWarehouse" value="${esc(s.availabilityWarehouse)}"></label>
      <label>Use which number of the pair<select data-set="availabilityQuantity"><option value="first" ${s.availabilityQuantity === "first" ? "selected" : ""}>First (provisional)</option><option value="second" ${s.availabilityQuantity === "second" ? "selected" : ""}>Second</option></select></label>
      <label>Catalog exports are<select data-set="completeness"><option value="incomplete" ${s.completeness !== "complete" ? "selected" : ""}>Incomplete — absent stays unknown</option><option value="complete" ${s.completeness === "complete" ? "selected" : ""}>Complete positive-only — absent = none</option></select></label>
      <button class="rp-pri-btn" data-savesettings>Save & recalculate</button></div>
      <p class="rp-dim">Technicians: ${esc((s.technicians || []).join(", "))}. Bibek bins: ${esc((s.bibekBins || []).join(", "))}.</p>`;
  }

  /* ---------- drawers ---------- */
  async function openDevice(i) {
    S.drawer = { kind: "dev", loading: true }; drawDrawer();
    const r = await fetch("/api/repair/device?i=" + i, { credentials: "same-origin" }); const j = await r.json();
    S.drawer = { kind: "dev", ...j }; drawDrawer();
  }
  async function openSku(sku) {
    S.drawer = { kind: "sku", loading: true }; drawDrawer();
    const r = await fetch("/api/repair/sku?sku=" + encodeURIComponent(sku), { credentials: "same-origin" }); const j = await r.json();
    S.drawer = { kind: "sku", ...j, devices: S.data.devices.filter((d) => d.sku === sku) }; drawDrawer();
  }
  const kv = (o) => `<table class="rp-kv">${Object.entries(o).filter(([k]) => k !== "__extra").map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v === "" || v == null ? `<span class="rp-dim">(blank)</span>` : esc(v)}</td></tr>`).join("")}${o.__extra ? `<tr><th>Extra fields</th><td>${esc(o.__extra.join(" | "))}</td></tr>` : ""}</table>`;
  function drawDrawer() {
    let el = document.querySelector(".rp-drawer-back");
    if (!S.drawer) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement("div"); el.className = "rp-drawer-back"; el.addEventListener("click", onDrawerClick); document.body.appendChild(el); }
    const c = ctx(), D = S.drawer;
    let body = `<p class="rp-dim">Loading…</p>`, title = "";
    if (!D.loading && D.kind === "dev" && D.device) {
      const d = D.device; title = d.id || "(no identifier)";
      body = `<div class="rp-dhead">${badge(d.priority)} <b>${esc(d.wf)}</b> · ${esc(d.owner)}</div><p><b>Next action:</b> ${esc(d.action)}</p>
        ${d.doneMonth ? `<p>Repair completed in month <b>${d.doneMonth}</b> (year not stated).</p>` : ""}${d.evidence ? `<p>Evidence: ${esc(d.evidence)}</p>` : ""}
        ${d.conflicts.length ? `<p class="warn">⚠ ${d.conflicts.map(esc).join("<br>")}</p>` : ""}${d.flags.length ? `<p class="warn">Review: ${d.flags.map(esc).join("; ")}</p>` : ""}
        ${d.elig.length ? `<p class="warn">Eligibility evidence: ${d.elig.map(esc).join(", ")}</p>` : ""}
        ${d.wf === "Give to Bibek" ? `<p><button class="rp-pri-btn" data-handoff="${esc(d.id)}">Record handoff to Bibek</button> <span class="rp-dim">Only when he actually has it.</span></p>` : ""}
        ${d.wf === "With Bibek" ? `<p><button class="rp-link" data-unhandoff="${esc(d.id)}">Undo recorded handoff</button></p>` : ""}
        <h4>Derived</h4>${kv({ "ID type": d.idKind, SKU: d.sku, "Demand priority (SKU)": PRI[d.demand], "Issues": d.issues.join(", "), "Purchase price": money(d.money.purchase), "Additional cost": money(d.money.additional),
          "Repair / labor / other": money(d.money.repair), "Total cost (reported)": money(d.money.total), "Selling price": money(d.money.selling), "Source margin %": pct(d.money.marginSrc),
          "Recorded spread": money(d.spread), "Calculated margin": pct(d.calcMargin), Missing: d.missing.join(", ") || "none" })}
        ${D.sku ? `<h4>SKU ${esc(D.sku.sku)}</h4><p>${badge(D.sku.priority)} ${esc(D.sku.why)}</p>` : ""}
        <h4>Original repair record <small>${esc(D.original.file)} · line ${D.original.line} (record ${D.original.record})</small></h4>${kv(D.original.data)}
        ${D.catalog.map((x) => `<h4>Catalog — ${esc(x.role)}${x.duplicate ? " (duplicate row)" : ""} <small>${esc(x.file)} · line ${x.line}</small></h4>${kv(x.data)}`).join("") || `<p class="rp-dim">This SKU isn't in either catalog.</p>`}`;
    } else if (!D.loading && D.kind === "sku" && D.sku) {
      const s = D.sku; title = s.sku;
      body = `<p>${badge(s.priority)} ${esc(s.why)}</p><p>${esc(s.name || "")}</p>
        ${kv({ "Monthly sale": num(s.monthly) + " (" + s.monthlySource + ")", "Weekly sale": num(s.weekly), Available: num(s.available) + " (" + s.availSource + ")", "Stock Summary": s.stockRaw,
          "Coverage days": s.coverage == null ? "undefined" : num(s.coverage, 1), Target: num(s.target), Shortage: num(s.shortage), "Assessment candidates": num(s.candidates), "Provisional limit": num(s.limit),
          "Catalog price": money(s.price), "Catalog cost": money(s.cost), "Catalog margin": pct(s.marginSrc), Currency: s.currency })}
        <h4>Devices (${D.devices.length})</h4>${D.devices.length ? `<div class="rp-tablewrap"><table class="rp-table small"><tbody>${D.devices.map((d) => `<tr tabindex="0" data-dev="${d.i}"><td class="mono">${esc(d.id)}</td><td>${esc(d.wf)}</td><td>${esc(d.owner)}</td><td class="n">${money(d.money.total)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="rp-dim">No repair devices on this SKU.</p>`}
        ${D.catalog.map((x) => `<h4>Catalog — ${esc(x.role)}${x.duplicate ? " (duplicate row)" : ""} <small>${esc(x.file)} · line ${x.line}</small></h4>${kv(x.data)}`).join("") || `<p class="rp-dim">Not in either catalog.</p>`}`;
    }
    el.innerHTML = `<aside class="rp-drawer ${c && c.isDark === false ? "light" : "dark"}" role="dialog" aria-label="Details" style="--a:${(c && c.accent) || "#2FBF87"}">
      <div class="rp-dtop"><h3 class="mono">${esc(title)}</h3><button data-close aria-label="Close">✕</button></div><div class="rp-dbody">${body}</div></aside>`;
    const b = el.querySelector("[data-close]"); if (b) b.focus();
  }
  async function onDrawerClick(e) {
    const t = e.target;
    if (t.classList.contains("rp-drawer-back") || t.hasAttribute("data-close")) { S.drawer = null; return drawDrawer(); }
    const dev = t.closest("[data-dev]"); if (dev) return openDevice(Number(dev.dataset.dev));
    if (t.dataset.handoff || t.dataset.unhandoff) {
      const id = t.dataset.handoff || t.dataset.unhandoff;
      if (t.dataset.handoff && !confirm(`Record that Bibek now has ${id}?`)) return;
      await post("/api/repair/override", { id, kind: t.dataset.handoff ? "bibek-handoff" : "clear" });
      await load(); const d = S.data.devices.find((x) => x.id === id); if (d) openDevice(d.i);
    }
  }

  /* ---------- upload ---------- */
  function drawUpload() {
    let el = document.querySelector(".rp-up-back");
    if (!S.upload) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement("div"); el.className = "rp-up-back"; el.addEventListener("click", onUpClick); el.addEventListener("change", onUpChange); document.body.appendChild(el); }
    const U = S.upload, c = ctx();
    const roles = [["repair", "Repair stock"], ["sales", "Sales catalog"], ["inventory", "Inventory catalog"]];
    el.innerHTML = `<div class="rp-up ${c && c.isDark === false ? "light" : "dark"}" role="dialog" aria-label="Upload files" style="--a:${(c && c.accent) || "#2FBF87"}">
      <div class="rp-dtop"><h3>Upload a new batch</h3><button data-upclose aria-label="Close">✕</button></div><div class="rp-dbody">
      <label class="rp-drop"><input type="file" accept=".csv,text/csv" multiple hidden data-files><b>Choose the three CSV files</b><small>Repair stock + sales catalog + inventory catalog. Any filenames.</small></label>
      ${U.busy ? `<p class="rp-dim">${esc(U.busy)}</p>` : ""}${U.error ? `<p class="warn">${esc(U.error)}</p>` : ""}
      ${(U.files || []).map((f, k) => `<div class="rp-panel"><h4>${esc(f.name)} <small>${num(f.bytes)} bytes · ${num(f.rows)} rows${f.products != null ? ` · ${num(f.products)} products · ${f.footers} footer` : ""}</small></h4>
        <p class="rp-dim">Detected: <b>${esc(f.role)}</b> — ${f.evidence.map(esc).join(" · ")}</p>
        <label>Role <select data-role="${k}">${roles.map(([v, l]) => `<option value="${v}" ${U.roles[k] === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        ${f.role === "ambiguous" ? `<p class="warn">Both readings fit these rows — choose the role yourself.</p>` : ""}
        <details><summary>${f.headers.length} columns</summary><small>${f.headers.map(esc).join(" · ")}</small></details>
        ${f.parseErrorCount ? `<p class="warn">${num(f.parseErrorCount)} row(s) don't match the header (first: line ${f.parseErrors[0].line}, ${esc(f.parseErrors[0].msg)})</p>` : ""}</div>`).join("")}
      ${U.validation ? `<div class="rp-panel"><h4>Validation ${U.validation.ok ? "✓ ready to apply" : "✕ can't apply yet"}</h4>${U.validation.findings.length ? `<ul>${U.validation.findings.map((x) => `<li><span class="rp-pri ${x.level === "error" ? "red" : x.level === "review" ? "purple" : "amber"}">${esc(x.level)}</span> ${esc(x.file ? x.file + ": " : "")}${esc(x.msg)}</li>`).join("")}</ul>` : `<p class="rp-dim">No problems found.</p>`}</div>` : ""}
      ${U.files ? `<div class="rp-row"><button class="rp-pri-btn" data-apply ${U.validation && U.validation.ok && !U.busy ? "" : "disabled"}>Apply this batch</button><span class="rp-dim">The current batch stays active unless this one passes. Originals are kept unchanged.</span></div>` : ""}
      </div></div>`;
  }
  const b64 = (file) => new Promise((res) => { const r = new FileReader(); r.onload = () => { const a = new Uint8Array(r.result); let s = ""; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); res(btoa(s)); }; r.readAsArrayBuffer(file); });
  async function onUpChange(e) {
    const U = S.upload, t = e.target;
    if (t.hasAttribute("data-files")) {
      const list = [...t.files].slice(0, 3); if (!list.length) return;
      U.busy = "Reading and checking the files…"; U.error = ""; drawUpload();
      U.raw = await Promise.all(list.map(async (f) => ({ name: f.name, b64: await b64(f) })));
      const { ok, j } = await post("/api/repair/inspect", { files: U.raw });
      U.busy = ""; if (!ok) { U.error = j.error || "Couldn't check the files"; return drawUpload(); }
      U.files = j.files; U.roles = j.files.map((f) => (["repair", "sales", "inventory"].includes(f.role) ? f.role : "")); U.validation = j.validation; drawUpload();
    }
    if (t.dataset.role != null) {
      U.roles[Number(t.dataset.role)] = t.value; U.busy = "Re-checking…"; drawUpload();
      const { j } = await post("/api/repair/inspect", { files: U.raw.map((f, k) => ({ ...f, role: U.roles[k] })) });
      U.validation = j.validation; U.busy = ""; drawUpload();
    }
  }
  async function onUpClick(e) {
    const t = e.target, U = S.upload;
    if (t.classList.contains("rp-up-back") || t.hasAttribute("data-upclose")) { S.upload = null; return drawUpload(); }
    if (t.hasAttribute("data-apply")) {
      U.busy = "Applying…"; drawUpload();
      const { ok, j } = await post("/api/repair/apply", { files: U.raw.map((f, k) => ({ ...f, role: U.roles[k] })) });
      if (!ok) { U.busy = ""; U.error = j.error; U.validation = j.validation || U.validation; return drawUpload(); }
      S.upload = null; drawUpload(); await refreshState(); await load();
      const c = ctx(); c && c.setToast && c.setToast(j.repeatOf ? "Batch applied — same files as an earlier batch (counts aren't added)" : "New batch applied");
    }
  }
  async function refreshState() { try { const r = await fetch("/api/repair/state", { credentials: "same-origin" }); if (r.ok) S.state = await r.json(); } catch (e) {} }

  /* ---------- export ---------- */
  async function exportXlsx() {
    S.busy = "Building the Excel file…"; draw();
    const f = S.f, filters = { search: f.q, priority: f.pri && PRI[f.pri], workflow: f.wf, owner: f.owner, bin: f.bin, issue: f.issue, financial: f.fin && FIN[f.fin], sku: f.sku, "SKU list": S.skuScope !== "all" ? S.skuScope : "" };
    try {
      const r = await fetch("/api/repair/export", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ devices: devices().map((d) => d.i), skus: skus().map((s) => s.sku), filters }) });
      if (!r.ok) throw new Error((await r.json()).error);
      const blob = await r.blob(), name = (r.headers.get("content-disposition") || "").match(/filename="([^"]+)"/);
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name ? name[1] : "repair-devices.xlsx"; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      S.busy = "";
    } catch (e) { S.busy = "Export failed: " + (e.message || e); }
    draw();
  }

  /* ---------- frame ---------- */
  function draw() {
    if (!S.host) return;
    const c = ctx(), acc = (c && c.accent) || "#2FBF87";
    let inner;
    if (S.loading && !S.data) inner = `<p class="rp-dim">Loading Repair Devices…</p>`;
    else if (S.err) inner = `<p class="warn">${esc(S.err)}</p>`;
    else if (!S.data && S.tab !== "files") inner = `<div class="rp-panel"><h4>No repair batch yet</h4><p class="rp-dim">Upload the repair-stock file and the two catalog exports to begin.</p><button class="rp-pri-btn" data-upload>⬆ Upload files</button></div>`;
    else inner = { overview, explorer, skus: skuTab, workflow, money: moneyTab, files }[S.tab]();
    S.host.innerHTML = `<div class="rp ${c && c.isDark === false ? "light" : "dark"}" style="--a:${acc}">
      <div class="rp-top"><div><h1>Repair Devices</h1><p class="rp-dim">${S.data ? `Batch ${esc(S.data.batch.id)} · ${num(S.data.devices.length)} devices · ${num(S.data.skus.length)} SKUs · sales window ${S.data.settings.salesWindowDays} d, target ${S.data.settings.targetCoverDays} d (assumptions)` : "Repair stock, sales and inventory — one view"}</p></div>
        <div class="rp-actions"><input class="rp-search" type="search" placeholder="Search IMEI/serial, SKU, product, reason, notes" aria-label="Search" value="${esc(S.f.q)}" data-q>
        ${S.data ? `<button class="rp-pri-btn" data-export ${S.busy ? "disabled" : ""}>⬇ Excel (filtered)</button>` : ""}</div></div>
      <nav class="rp-tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" aria-selected="${S.tab === k}" class="${S.tab === k ? "on" : ""}" data-tab="${k}">${l}</button>`).join("")}</nav>
      ${S.busy ? `<p class="rp-note">${esc(S.busy)}</p>` : ""}${chips()}${inner}</div>`;
  }
  function onClick(e) {
    const t = e.target.closest("button,[data-dev],[data-sku],tr[data-act]"); if (!t || !S.host.contains(t)) return;
    if (t.dataset.tab) { S.tab = t.dataset.tab; return draw(); }
    if (t.dataset.unset) { S.f[t.dataset.unset] = ""; S.page = { dev: 0, sku: 0 }; return draw(); }
    if (t.hasAttribute("data-clear")) { S.f = blankF(); S.skuScope = "all"; S.page = { dev: 0, sku: 0 }; return draw(); }
    if (t.dataset.sort) { const [tb, k] = t.dataset.sort.split(":"); const s = S.sort[tb]; S.sort[tb] = { k, dir: s.k === k ? -s.dir : 1 }; return draw(); }
    if (t.dataset.page) { const [tb, p] = t.dataset.page.split(":"); S.page[tb] = Math.max(0, Number(p)); return draw(); }
    if (t.dataset.scope) { S.skuScope = t.dataset.scope; S.page.sku = 0; return draw(); }
    if (t.dataset.dev != null) return openDevice(Number(t.dataset.dev));
    if (t.dataset.sku) return openSku(t.dataset.sku);
    if (t.hasAttribute("data-export")) return exportXlsx();
    if (t.hasAttribute("data-upload")) { S.upload = { roles: [] }; return drawUpload(); }
    if (t.dataset.activate) return post("/api/repair/activate", { id: t.dataset.activate }).then(refreshState).then(load);
    if (t.hasAttribute("data-savesettings")) {
      const v = {}; S.host.querySelectorAll("[data-set]").forEach((x) => (v[x.dataset.set] = x.value));
      return post("/api/repair/settings", v).then(refreshState).then(load);
    }
    const act = t.dataset.act; if (!act) return;
    const [k, ...rest] = act.split(":"), v = rest.join(":");
    if (k === "redcand") { S.f = { ...blankF(), pri: "red", wf: "Not mapped" }; S.tab = "explorer"; S.page.dev = 0; return draw(); }
    if (k === "nocand") { S.skuScope = "nocand"; S.tab = "skus"; S.page.sku = 0; return draw(); }
    if (k === "skupri") return setF("pri", v, "skus");
    const go = S.tab === "overview" ? (k === "sku" ? "skus" : "explorer") : null;
    return setF(k, v, go);
  }
  function onInput(e) {
    if (e.target.hasAttribute("data-q")) {
      S.f.q = e.target.value; S.page = { dev: 0, sku: 0 };
      clearTimeout(S.qt); S.qt = setTimeout(() => { const pos = e.target.selectionStart; draw(); const i = S.host.querySelector("[data-q]"); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }, 200);
    }
  }
  function onChange(e) { const k = e.target.dataset.f; if (k) { S.f[k] = e.target.value; S.page = { dev: 0, sku: 0 }; draw(); } }
  function onKey(e) {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("tr[data-dev],tr[data-sku],tr[data-act]")) { e.preventDefault(); onClick({ target: e.target }); }
    if (e.key === "Escape") { if (S.drawer) { S.drawer = null; drawDrawer(); } else if (S.upload) { S.upload = null; drawUpload(); } }
  }

  const CSS = `
  .rp{font:13.5px/1.45 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);padding-bottom:40px}
  .rp.dark,.rp-drawer.dark,.rp-up.dark{--card:rgba(24,29,38,.62);--bg:rgba(16,20,26,.97);--ink:#E9EDF3;--muted:#8C97A8;--faint:#5E6878;--line:rgba(255,255,255,.08);--chip:rgba(255,255,255,.05)}
  .rp.light,.rp-drawer.light,.rp-up.light{--card:rgba(255,255,255,.72);--bg:rgba(250,251,252,.98);--ink:#141A21;--muted:#5F6B79;--faint:#8D98A6;--line:rgba(20,30,40,.09);--chip:rgba(255,255,255,.8)}
  .rp *,.rp-drawer *,.rp-up *{box-sizing:border-box}.rp button,.rp input,.rp select,.rp-drawer button,.rp-up button,.rp-up select{font:inherit;color:inherit}
  .rp h1{font:600 30px "Iowan Old Style",Palatino,Georgia,serif;letter-spacing:-.02em;margin:22px 0 2px}
  .rp-top{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px}.rp-actions{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
  .rp-search{min-width:280px;border:1px solid var(--line);background:var(--chip);border-radius:10px;padding:8px 12px;outline:none}.rp-search:focus{border-color:var(--a)}
  .rp-tabs{display:flex;gap:4px;overflow-x:auto;border-bottom:1px solid var(--line);margin-bottom:12px;scrollbar-width:thin}
  .rp-tabs button{border:0;background:none;padding:9px 13px;white-space:nowrap;color:var(--muted);border-bottom:2px solid transparent;cursor:pointer}
  .rp-tabs button.on{color:var(--a);border-bottom-color:var(--a);font-weight:700}
  .rp-dim{color:var(--muted);font-size:12.5px;margin:4px 0}.rp-note{font-size:12.5px;color:var(--muted);background:var(--chip);border:1px solid var(--line);border-radius:10px;padding:8px 11px;margin:8px 0}
  .warn{color:#C9A227}.neg{color:#F2545B}.mono{font-family:ui-monospace,Menlo,monospace;font-size:12.5px}
  .rp-chips{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0 0 10px}
  .rp-chip{display:inline-flex;gap:6px;align-items:center;border:1px solid var(--a);color:var(--a);border-radius:999px;padding:3px 4px 3px 10px;font-size:12px;font-weight:600}
  .rp-chip button{border:0;background:none;cursor:pointer;color:inherit}.rp-link{border:0;background:none;color:var(--a);cursor:pointer;text-decoration:underline;font-size:12.5px}
  .rp-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;margin-bottom:12px}
  .rp-card{text-align:left;border:1px solid var(--line);background:var(--card);border-radius:14px;padding:10px 12px;cursor:pointer;-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px)}
  .rp-card:disabled{cursor:default}.rp-card:not(:disabled):hover{border-color:var(--a)}.rp-card small{display:block;color:var(--faint);font-size:11px}.rp-card b{display:block;font-size:21px}.rp-card span{display:block;color:var(--muted);font-size:11.5px}
  .rp-card.red{border-left:3px solid #F2545B}.rp-card.blue{border-left:3px solid #4C8DF6}.rp-card.purple{border-left:3px solid #A06CF0}.rp-card.amber{border-left:3px solid #F5C542}
  .rp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:12px}
  .rp-panel{border:1px solid var(--line);background:var(--card);border-radius:14px;padding:12px 14px;margin-bottom:12px;-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px)}
  .rp-panel h4{margin:0 0 8px;font-size:13.5px}.rp-panel h4 small{color:var(--faint);font-weight:400}
  .rp-bar{display:grid;grid-template-columns:minmax(120px,1.2fr) 2fr 60px;gap:8px;align-items:center;width:100%;border:0;background:none;padding:4px 2px;cursor:pointer;text-align:left;border-radius:8px}
  .rp-bar:hover,.rp-bar.on{background:var(--chip)}.rp-bar .lbl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px}.rp-bar .n{text-align:right;font-variant-numeric:tabular-nums}
  .rp-bar .trk{height:10px;background:var(--chip);border-radius:6px;overflow:hidden}.rp-bar i{display:block;height:100%;background:var(--a);border-radius:6px}
  .rp-bar i.red{background:#F2545B}.rp-bar i.amber{background:#F5C542}.rp-bar i.green{background:#22C55E}.rp-bar i.gray{background:#8C97A8}.rp-bar i.blue{background:#4C8DF6}.rp-bar i.purple{background:#A06CF0}
  .rp-pri{display:inline-block;font-size:11px;font-weight:700;border-radius:999px;padding:1px 8px;white-space:nowrap}
  .rp-pri.red{background:rgba(242,84,91,.16);color:#F2545B}.rp-pri.amber{background:rgba(245,197,66,.18);color:#B98A12}.rp-pri.green{background:rgba(34,197,94,.16);color:#16A34A}
  .rp-pri.gray{background:rgba(140,151,168,.18);color:var(--muted)}.rp-pri.blue{background:rgba(76,141,246,.16);color:#4C8DF6}.rp-pri.purple{background:rgba(160,108,240,.16);color:#A06CF0}
  .rp-filters{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px}
  .rp-filters label{display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--faint)}
  .rp-filters select,.rp-filters input{border:1px solid var(--line);background:var(--chip);border-radius:9px;padding:6px 8px;min-width:150px;max-width:260px;color:var(--ink)}
  .rp-tog{border:1px solid var(--line);background:var(--chip);border-radius:999px;padding:5px 12px;cursor:pointer;color:var(--muted)}.rp-tog.on{border-color:var(--a);color:var(--a);font-weight:700}
  .rp-tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:12px;background:var(--card)}
  .rp-table{width:100%;border-collapse:collapse;min-width:1100px}.rp-table.small{min-width:640px}
  .rp-table th{position:sticky;top:0;background:var(--bg);text-align:left;font-size:11px;font-weight:600;color:var(--faint);padding:8px;border-bottom:1px solid var(--line);white-space:nowrap}
  .rp-table th button{border:0;background:none;color:inherit;font:inherit;cursor:pointer;padding:0}
  .rp-table td{padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}.rp-table td small{display:block;color:var(--faint);font-size:11px}
  .rp-table tbody tr[tabindex]{cursor:pointer}.rp-table tbody tr[tabindex]:hover,.rp-table tbody tr[tabindex]:focus{background:var(--chip);outline:none}
  .rp-table .n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.rp-empty{text-align:center;color:var(--muted);padding:24px}
  .rp-pager{display:flex;gap:6px;align-items:center;justify-content:flex-end;margin:8px 0;font-size:12.5px;color:var(--muted)}
  .rp-pager span{margin-right:auto}.rp-pager button{border:1px solid var(--line);background:var(--chip);border-radius:8px;padding:4px 10px;cursor:pointer}.rp-pager button:disabled{opacity:.4;cursor:default}
  .rp-pri-btn{border:0;border-radius:10px;padding:8px 14px;font-weight:700;color:#fff;background:var(--a);cursor:pointer}.rp-pri-btn:disabled{opacity:.5}
  .rp-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}.rp-h{font-size:15px;margin:14px 0 8px}.rp-h small{color:var(--faint);font-weight:400}
  .rp-q{border-bottom:1px solid var(--line);padding:6px 0}.rp-q summary{cursor:pointer;font-size:12.5px}.rp-q ul{font-size:12px;color:var(--muted);max-height:220px;overflow:auto}
  .rp-defs{font-size:12.5px;color:var(--muted);padding-left:18px}
  .rp-drawer-back,.rp-up-back{position:fixed;inset:0;z-index:2147483000;background:rgba(5,8,12,.45);display:flex;justify-content:flex-end}
  .rp-up-back{justify-content:center;align-items:center;padding:16px}
  .rp-drawer,.rp-up{width:min(620px,100%);height:100%;display:flex;flex-direction:column;background:var(--bg);color:var(--ink);border-left:1px solid var(--line);font:13px/1.45 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;
    -webkit-backdrop-filter:blur(26px);backdrop-filter:blur(26px);box-shadow:-30px 0 80px -30px rgba(0,0,0,.6)}
  .rp-up{width:min(820px,100%);height:auto;max-height:calc(100vh - 32px);border-radius:18px;border:1px solid var(--line)}
  .rp-dtop{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line)}.rp-dtop h3{margin:0;font-size:16px}
  .rp-dtop button{margin-left:auto;width:32px;height:32px;border-radius:10px;border:1px solid var(--line);background:var(--chip);cursor:pointer}
  .rp-dbody{overflow:auto;padding:12px 16px 24px}.rp-dbody h4{margin:14px 0 6px;font-size:13px}.rp-dbody h4 small{color:var(--faint);font-weight:400}
  .rp-kv{width:100%;border-collapse:collapse;font-size:12.5px}.rp-kv th{text-align:left;color:var(--faint);font-weight:600;padding:4px 8px 4px 0;width:38%;vertical-align:top}
  .rp-kv td{padding:4px 0;border-bottom:1px solid var(--line);white-space:pre-wrap;word-break:break-word}
  .rp-drop{display:grid;place-items:center;gap:4px;padding:22px;border:2px dashed var(--line);border-radius:14px;cursor:pointer;text-align:center;margin-bottom:10px}.rp-drop:hover{border-color:var(--a)}
  .rp-up select{border:1px solid var(--line);background:var(--chip);border-radius:9px;padding:6px 8px;margin-left:6px}
  @media (max-width:700px){.rp-search{min-width:0;width:100%}.rp-actions{width:100%}}
  `;
  function mount(host) {
    if (!document.getElementById("rp-css")) { const st = document.createElement("style"); st.id = "rp-css"; st.textContent = CSS; document.head.appendChild(st); }
    S.host = host;
    host.addEventListener("click", onClick); host.addEventListener("input", onInput); host.addEventListener("change", onChange); host.addEventListener("keydown", onKey);
    draw(); refreshState().then(() => { if (!S.data) load(); else draw(); });
  }
  function unmount() { S.host = null; S.drawer = null; drawDrawer(); }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && (S.drawer || S.upload) && !(S.host && S.host.contains(e.target))) { S.drawer = null; S.upload = null; drawDrawer(); drawUpload(); } });
  window.MYDAYRepair = { mount, unmount, reload: load };
})();
