/* Auctions — compact view.
 *
 * Shows your Auction table with identical entries as ONE row: same date,
 * supplier, make, model, size, grade, price, fees and status → quantities
 * added up, "× 27 lines". This is only a way of looking at them: nothing is
 * changed until you tap one of the actions and confirm.
 *
 * Pick a date, a range, or Today / Yesterday / Last 7 days, then Select all
 * to act on that day's lines: set status, download, combine into one line
 * for good, or delete.
 */
(function () {
  "use strict";
  const ctx = () => window.__myday || null;
  const S = { el: null, mode: "all", from: "", to: "", supplier: "", q: "", pick: new Set() };
  const money = (n) => (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const landed = (e) => (+e.price || 0) * (1 + (+e.premium || 0) / 100) * (1 + (+e.tax || 0) / 100) + (+e.shipEach || 0);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const shift = (s, n) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return iso(d); };
  const fmt = (s) => new Date(s + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

  function groups() {
    const c = ctx(); const all = (c && c.state && c.state.entries) || [];
    const q = S.q.trim().toLowerCase();
    const list = all.filter((e) => e.date
      && (S.mode === "all" || (e.date >= S.from && e.date <= S.to))
      && (!S.supplier || e.supplier === S.supplier)
      && (!q || [e.supplier, e.oem, e.model, e.size, e.grade, e.notes].join(" ").toLowerCase().includes(q)));
    const by = new Map();
    for (const e of list) {
      const k = [e.date, e.supplier, e.oem, e.model, e.size, e.grade, Number(e.price).toFixed(2), e.premium ?? "", e.tax ?? "", e.shipEach ?? "", e.status].join("|").toLowerCase();
      const g = by.get(k);
      if (g) { g.qty += +e.qty || 1; g.ids.push(e.id); }
      else by.set(k, { key: k, e, qty: +e.qty || 1, ids: [e.id] });
    }
    return { rows: [...by.values()].sort((a, b) => b.e.date.localeCompare(a.e.date) || a.e.supplier.localeCompare(b.e.supplier) || a.e.model.localeCompare(b.e.model)), lines: list.length };
  }

  function draw() {
    const c = ctx(); if (!c) return;
    const today = c.today;
    if (!S.from) { S.from = today; S.to = today; }
    const { rows, lines } = groups();
    const picked = rows.filter((r) => S.pick.has(r.key));
    const units = rows.reduce((n, r) => n + r.qty, 0), spend = rows.reduce((n, r) => n + r.qty * (+r.e.price || 0), 0);
    const pUnits = picked.reduce((n, r) => n + r.qty, 0), pLines = picked.reduce((n, r) => n + r.ids.length, 0);
    const sups = [...new Set(((c.state && c.state.entries) || []).map((e) => e.supplier).filter(Boolean))].sort();
    const chip = (label, on, act) => `<button class="mdk-chip ${on ? "on" : ""}" data-act="${act}">${label}</button>`;
    const isQuick = (f, t) => S.mode !== "all" && S.from === f && S.to === t;

    const html = `
    <div class="mdk-head"><div><h3>Auction table — compact</h3>
      <p>Identical lines shown once with the quantity added up. Looking doesn't change anything; the buttons below only act when you tap and confirm.</p></div>
      <button class="mdk-x" data-x>✕</button></div>
    <div class="mdk-bar">
      ${chip("All dates", S.mode === "all", "all")}${chip("Today", isQuick(today, today), "today")}${chip("Yesterday", isQuick(shift(today, -1), shift(today, -1)), "yest")}${chip("Last 7 days", isQuick(shift(today, -6), today), "week")}
      <span class="mdk-sep"></span>
      <label>From <input type="date" data-f="from" value="${S.mode === "all" ? "" : S.from}" max="${today}"></label>
      <label>to <input type="date" data-f="to" value="${S.mode === "all" ? "" : S.to}" max="${today}"></label>
      <select data-f="supplier"><option value="">All suppliers</option>${sups.map((s) => `<option ${s === S.supplier ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
      <input data-f="q" placeholder="Search model, grade…" value="${esc(S.q)}">
    </div>
    <div class="mdk-sum"><span><b>${rows.length}</b> rows</span><span>from <b>${lines}</b> lines</span><span><b>${units.toLocaleString()}</b> units</span><span><b>${money(spend)}</b></span>
      ${lines > rows.length ? `<span class="mdk-hint">${lines - rows.length} lines are repeats shown together</span>` : ""}</div>
    <div class="mdk-tbl"><table>
      <tr><th><input type="checkbox" data-all ${rows.length && picked.length === rows.length ? "checked" : ""} title="Select all shown"></th><th>Date</th><th>Supplier</th><th>Make</th><th>Model</th><th>Size</th><th>Grade</th><th class="n">Price</th><th class="n">Landed</th><th class="n">Qty</th><th>Lines</th><th>Status</th></tr>
      ${rows.slice(0, 1500).map((r) => `<tr class="${S.pick.has(r.key) ? "on" : ""}"><td><input type="checkbox" data-pick="${esc(r.key)}" ${S.pick.has(r.key) ? "checked" : ""}></td>
        <td>${fmt(r.e.date)}</td><td>${esc(r.e.supplier)}</td><td>${esc(r.e.oem)}</td><td><b>${esc(r.e.model)}</b></td><td>${esc(r.e.size)}</td><td>${esc(r.e.grade)}</td>
        <td class="n">${money(r.e.price)}</td><td class="n">${money(landed(r.e))}</td><td class="n"><b>${r.qty}</b></td>
        <td>${r.ids.length > 1 ? `<span class="mdk-x2">× ${r.ids.length} lines</span>` : ""}</td><td>${esc(r.e.status)}</td></tr>`).join("")
        || `<tr><td colspan="12" class="mdk-empty">No entries for this selection.</td></tr>`}
    </table></div>
    <div class="mdk-foot">
      ${picked.length ? `<b>${picked.length} selected</b> · ${pLines} lines · ${pUnits} units
        <select data-status><option value="">Set status…</option><option value="won">Won</option><option value="pending">Pending</option><option value="lost">Lost</option></select>
        <button data-do="csv">⬇ Download</button>
        ${picked.some((r) => r.ids.length > 1) ? `<button data-do="combine" class="pri" title="Turn each selected row's repeat lines into one line with the total quantity">Combine into one line each</button>` : ""}
        <button data-do="delete" class="warn">Delete…</button>`
      : `<span>Tick rows, or pick a date and <b>Select all</b>, to act on them.</span>`}
    </div>`;

    if (!S.el) {
      S.el = document.createElement("div"); S.el.className = "mdk-back";
      S.el.addEventListener("click", onClick); S.el.addEventListener("change", onChange);
      S.el.addEventListener("input", (e) => { if (e.target.getAttribute("data-f") === "q") { S.q = e.target.value; clearTimeout(S.t); S.t = setTimeout(() => { const pos = e.target.selectionStart; draw(); const i = S.el.querySelector('[data-f="q"]'); i.focus(); i.setSelectionRange(pos, pos); }, 250); } });
      document.body.appendChild(S.el);
    }
    const acc = c.accent || "#2FBF87";
    S.el.innerHTML = `<div class="mdk ${c.isDark === false ? "light" : "dark"}" style="--a:${acc}">${html}</div>`;
  }

  function onClick(e) {
    const t = e.target, c = ctx();
    if (t === S.el || t.hasAttribute("data-x")) return close();
    const act = t.getAttribute("data-act");
    if (act) {
      const d = c.today;
      if (act === "all") S.mode = "all";
      else { S.mode = "range"; [S.from, S.to] = act === "today" ? [d, d] : act === "yest" ? [shift(d, -1), shift(d, -1)] : [shift(d, -6), d]; }
      S.pick.clear(); return draw();
    }
    const what = t.getAttribute("data-do");
    if (!what) return;
    const { rows } = groups(); const picked = rows.filter((r) => S.pick.has(r.key));
    if (what === "csv") return csv(picked);
    if (what === "combine") {
      const many = picked.filter((r) => r.ids.length > 1), n = many.reduce((x, r) => x + r.ids.length, 0);
      if (!confirm(`Combine ${n} lines into ${many.length}? Each row keeps its date, supplier, model, grade and price, with the quantities added up. The extra lines are removed. This changes your Auction table.`)) return;
      for (const r of many) {
        const all = (c.state.entries || []).filter((e) => r.ids.includes(e.id));
        const notes = [...new Set(all.map((e) => e.notes).filter(Boolean))].join(" · ").slice(0, 500);
        c.patchEntry(r.ids[0], { qty: r.qty, notes: notes ? notes + ` · combined from ${r.ids.length} lines` : `combined from ${r.ids.length} lines` });
        r.ids.slice(1).forEach((id) => c.removeEntry(id));
      }
      c.setToast && c.setToast(`Combined into ${many.length} line${many.length === 1 ? "" : "s"}`);
      S.pick.clear(); return setTimeout(draw, 100);
    }
    if (what === "delete") {
      const n = picked.reduce((x, r) => x + r.ids.length, 0);
      if (!confirm(`Delete ${n} line${n === 1 ? "" : "s"} (${picked.reduce((x, r) => x + r.qty, 0)} units) from the Auction table? This can't be undone here.`)) return;
      picked.forEach((r) => r.ids.forEach((id) => c.removeEntry(id)));
      c.setToast && c.setToast(`Deleted ${n} line${n === 1 ? "" : "s"}`);
      S.pick.clear(); return setTimeout(draw, 100);
    }
  }
  function onChange(e) {
    const t = e.target, c = ctx();
    if (t.hasAttribute("data-all")) { const { rows } = groups(); rows.forEach((r) => (t.checked ? S.pick.add(r.key) : S.pick.delete(r.key))); return draw(); }
    if (t.hasAttribute("data-pick")) { const k = t.getAttribute("data-pick"); t.checked ? S.pick.add(k) : S.pick.delete(k); return draw(); }
    if (t.hasAttribute("data-status") && t.value) {
      const { rows } = groups(); const picked = rows.filter((r) => S.pick.has(r.key)); const n = picked.reduce((x, r) => x + r.ids.length, 0);
      if (confirm(`Set ${n} line${n === 1 ? "" : "s"} to "${t.value}"?`)) { picked.forEach((r) => r.ids.forEach((id) => c.patchEntry(id, { status: t.value }))); S.pick.clear(); }
      return setTimeout(draw, 100);
    }
    const f = t.getAttribute("data-f");
    if (f === "from" || f === "to") { if (t.value) { S.mode = "range"; S[f] = t.value; if (S.from > S.to) [S.from, S.to] = [S.to, S.from]; S.pick.clear(); draw(); } }
    if (f === "supplier") { S.supplier = t.value; S.pick.clear(); draw(); }
  }
  function csv(picked) {
    const cell = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = [["Date", "Supplier", "Make", "Model", "Size", "Grade", "Price", "Landed each", "Qty", "Lines", "Status"],
      ...picked.map((r) => [r.e.date, r.e.supplier, r.e.oem, r.e.model, r.e.size, r.e.grade, r.e.price, landed(r.e).toFixed(2), r.qty, r.ids.length, r.e.status])];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + rows.map((r) => r.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `myday-auctions-${S.mode === "all" ? "all" : S.from + (S.to !== S.from ? "_to_" + S.to : "")}.csv`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function open() { draw(); }
  function close() { if (S.el) S.el.remove(); S.el = null; S.pick.clear(); }

  const CSS = `
  .mdk-back{position:fixed;inset:0;z-index:2147483000;background:rgba(5,8,12,.5);display:flex;align-items:center;justify-content:center;padding:14px}
  .mdk{width:min(1300px,100%);height:calc(100vh - 28px);display:flex;flex-direction:column;border-radius:20px;overflow:hidden;
    font:13px/1.4 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg);border:1px solid var(--line);
    -webkit-backdrop-filter:blur(26px) saturate(170%);backdrop-filter:blur(26px) saturate(170%);box-shadow:0 40px 100px -30px rgba(0,0,0,.7)}
  .mdk.dark{--bg:rgba(16,20,26,.97);--ink:#E9EDF3;--muted:#8C97A8;--faint:#5E6878;--line:rgba(255,255,255,.08);--glass:rgba(255,255,255,.05)}
  .mdk.light{--bg:rgba(250,251,252,.98);--ink:#141A21;--muted:#5F6B79;--faint:#8D98A6;--line:rgba(20,30,40,.08);--glass:rgba(255,255,255,.85)}
  @media (max-width:700px){.mdk-back{padding:0}.mdk{height:100vh;border-radius:0}}
  .mdk *{box-sizing:border-box}.mdk button,.mdk select,.mdk input{font:inherit;color:inherit}
  .mdk-head{display:flex;gap:10px;padding:16px 18px 8px}.mdk-head h3{margin:0;font:600 20px "Iowan Old Style",Palatino,Georgia,serif}.mdk-head p{margin:2px 0 0;color:var(--muted);font-size:12.5px}
  .mdk-x{margin-left:auto;width:32px;height:32px;border-radius:10px;border:1px solid var(--line);background:var(--glass);cursor:pointer}
  .mdk-bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:4px 18px 10px;border-bottom:1px solid var(--line);color:var(--muted)}
  .mdk-bar input,.mdk-bar select{border:1px solid var(--line);background:var(--glass);border-radius:9px;padding:5px 8px;color-scheme:light dark}
  .mdk-chip{border:1px solid var(--line);background:var(--glass);border-radius:999px;padding:5px 12px;cursor:pointer;color:var(--muted)}
  .mdk-chip.on{border-color:var(--a);color:var(--a);font-weight:700}
  .mdk-sep{width:6px}
  .mdk-sum{display:flex;gap:14px;flex-wrap:wrap;padding:9px 18px;color:var(--muted);font-size:12.5px;border-bottom:1px solid var(--line)}.mdk-sum b{color:var(--ink)}
  .mdk-hint{color:var(--a)}
  .mdk-tbl{flex:1;overflow:auto}
  .mdk table{width:100%;border-collapse:collapse;min-width:980px}
  .mdk th{position:sticky;top:0;background:var(--bg);text-align:left;font-size:11px;font-weight:600;color:var(--faint);padding:9px 10px;border-bottom:1px solid var(--line);z-index:1}
  .mdk td{padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
  .mdk tr.on td{background:color-mix(in srgb,var(--a) 9%,transparent)}
  .mdk .n{text-align:right;font-variant-numeric:tabular-nums}
  .mdk input[type=checkbox]{width:15px;height:15px;accent-color:var(--a)}
  .mdk-x2{font-size:11px;font-weight:700;color:var(--a);background:color-mix(in srgb,var(--a) 14%,transparent);border-radius:999px;padding:2px 8px}
  .mdk-empty{text-align:center;color:var(--faint);padding:30px}
  .mdk-foot{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:11px 18px;border-top:1px solid var(--line);color:var(--muted);min-height:54px}
  .mdk-foot b{color:var(--ink)}
  .mdk-foot button,.mdk-foot select{border:1px solid var(--line);background:var(--glass);border-radius:10px;padding:7px 12px;cursor:pointer}
  .mdk-foot .pri{border:0;background:var(--a);color:#fff;font-weight:700}
  .mdk-foot .warn{color:#F2545B;border-color:rgba(242,84,91,.4)}
  `;
  function boot() {
    const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.el) close(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  window.MYDAYCompact = { open, close };
})();
