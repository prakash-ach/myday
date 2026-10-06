/* Price trends — what you've paid, over time, and where it's heading.
 *
 * Built from your Auction table entries. Prices are averaged by quantity
 * (10 phones at $300 count ten times as much as 1 at $350). Where an entry
 * has its invoice's fees spread into it, "landed" includes them.
 * Downloads are CSV files that open straight in Excel or Google Sheets.
 */
(function () {
  "use strict";
  const ctx = () => window.__myday || null;
  const S = { el: null, f: { oem: "", model: "", size: "", grade: "", supplier: "", status: "won", months: 6, by: "month", compare: false, metric: "price" } };
  const money = (n) => (n == null || isNaN(n) ? "—" : Number(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n >= 100 ? 0 : 2 }));
  const pct = (n) => (n == null || !isFinite(n) ? "—" : (n > 0 ? "+" : "") + n.toFixed(1) + "%");
  const landed = (e) => (+e.price || 0) * (1 + (+e.premium || 0) / 100) * (1 + (+e.tax || 0) / 100) + (+e.shipEach || 0);
  const unit = (e) => (S.f.metric === "landed" ? landed(e) : +e.price || 0);
  const weekOf = (d) => { const t = new Date(d + "T12:00:00"); t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
  const periodOf = (d) => (S.f.by === "week" ? weekOf(d) : d.slice(0, 7));
  const label = (p) => (p.length === 7 ? new Date(p + "-15T12:00:00").toLocaleDateString("en-US", { month: "short", year: "2-digit" }) : new Date(p + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }));
  const uniq = (a) => [...new Set(a.filter(Boolean))].sort((x, y) => String(x).localeCompare(String(y), undefined, { numeric: true }));

  function entries() {
    const c = ctx(); const all = (c && c.state && c.state.entries) || [];
    const F = S.f, from = new Date(); from.setMonth(from.getMonth() - (F.months || 1200));
    const since = F.months ? from.toISOString().slice(0, 10) : "0000";
    return all.filter((e) => e.date && e.date >= since && (+e.price > 0)
      && (F.status === "all" || e.status === F.status) && (!F.oem || e.oem === F.oem) && (!F.model || e.model === F.model)
      && (!F.size || e.size === F.size) && (!F.grade || e.grade === F.grade) && (!F.supplier || e.supplier === F.supplier));
  }
  function stats(list) {
    const q = list.reduce((n, e) => n + (+e.qty || 1), 0);
    const spend = list.reduce((n, e) => n + unit(e) * (+e.qty || 1), 0);
    const prices = list.map(unit);
    return { units: q, spend, avg: q ? spend / q : null, min: prices.length ? Math.min(...prices) : null, max: prices.length ? Math.max(...prices) : null, n: list.length };
  }
  function series(list, key) {
    const by = {};
    for (const e of list) { const k = key ? key(e) : "all"; const p = periodOf(e.date); ((by[k] = by[k] || {})[p] = by[k][p] || []).push(e); }
    return by;
  }

  /* Biggest moves: each model+size+grade's last period against the one before. */
  function movers() {
    const c = ctx(); const all = ((c && c.state && c.state.entries) || []).filter((e) => e.date && +e.price > 0 && (S.f.status === "all" || e.status === S.f.status));
    const groups = {};
    for (const e of all) { const k = [e.oem, e.model, e.size, e.grade].join(" · "); (groups[k] = groups[k] || []).push(e); }
    const out = [];
    for (const [k, list] of Object.entries(groups)) {
      const per = series(list).all, ps = Object.keys(per).sort();
      if (ps.length < 2) continue;
      const a = stats(per[ps[ps.length - 2]]), b = stats(per[ps[ps.length - 1]]);
      if (a.avg && b.avg) out.push({ k, from: a.avg, to: b.avg, ch: ((b.avg - a.avg) / a.avg) * 100, p: ps[ps.length - 1] });
    }
    return out.sort((x, y) => Math.abs(y.ch) - Math.abs(x.ch)).slice(0, 8);
  }

  /* ---------- downloads ---------- */
  const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  function download(name, rows) {
    const text = "\ufeff" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const fname = (what) => `myday-${what}-${[S.f.oem, S.f.model, S.f.size, S.f.grade, S.f.supplier].filter(Boolean).join("-").replace(/[^a-z0-9-]+/gi, "_") || "all"}-${new Date().toISOString().slice(0, 10)}.csv`;
  function dlTrend() {
    const per = series(entries()).all || {};
    download(fname("price-trend"), [["Period", "Units", `Avg ${S.f.metric} (by qty)`, "Lowest", "Highest", "Entries"],
      ...Object.keys(per).sort().map((p) => { const s = stats(per[p]); return [p, s.units, s.avg.toFixed(2), s.min.toFixed(2), s.max.toFixed(2), s.n]; })]);
  }
  function dlMatrix() {
    const list = entries(), months = uniq(list.map((e) => e.date.slice(0, 7)));
    const g = {};
    for (const e of list) { const k = [e.oem, e.model, e.size, e.grade].join("\u0001"); ((g[k] = g[k] || {})[e.date.slice(0, 7)] = g[k][e.date.slice(0, 7)] || []).push(e); }
    download(fname("price-grid"), [["Make", "Model", "Size", "Grade", ...months.map((m) => m + " avg"), "All-time avg", "Units"],
      ...Object.keys(g).sort().map((k) => { const all = Object.values(g[k]).flat(), s = stats(all);
        return [...k.split("\u0001"), ...months.map((m) => (g[k][m] ? stats(g[k][m]).avg.toFixed(2) : "")), s.avg.toFixed(2), s.units]; })]);
  }
  function dlEntries() {
    download(fname("entries"), [["Date", "Supplier", "Make", "Model", "Size", "Grade", "Qty", "Price", "Premium %", "Tax %", "Shipping each", "Landed each", "Status", "Notes"],
      ...entries().sort((a, b) => a.date.localeCompare(b.date)).map((e) => [e.date, e.supplier, e.oem, e.model, e.size, e.grade, e.qty, e.price,
        e.premium ?? "", e.tax ?? "", e.shipEach ?? "", landed(e).toFixed(2), e.status, e.notes || ""])]);
  }

  /* ---------- drawing ---------- */
  function chart(list, accent) {
    const W = 860, H = 240, P = { l: 56, r: 14, t: 14, b: 30 };
    const groups = S.f.compare ? series(list, (e) => e.supplier || "—") : series(list);
    const periods = uniq(list.map((e) => periodOf(e.date)));
    if (periods.length < 1) return `<div class="mdt-empty">No entries match. Widen the filters.</div>`;
    const pts = Object.entries(groups).map(([k, per]) => ({ k, ps: periods.filter((p) => per[p]).map((p) => ({ p, ...stats(per[p]) })) }));
    const vals = pts.flatMap((g) => g.ps.flatMap((x) => [x.min, x.max, x.avg]));
    let lo = Math.min(...vals), hi = Math.max(...vals); if (lo === hi) { lo *= 0.9; hi *= 1.1; } const pad = (hi - lo) * 0.08; lo = Math.max(0, lo - pad); hi += pad;
    const X = (p) => P.l + (periods.length === 1 ? (W - P.l - P.r) / 2 : (periods.indexOf(p) / (periods.length - 1)) * (W - P.l - P.r));
    const Y = (v) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
    const colours = [accent, "#4C8DF6", "#E8833A", "#A06CF0", "#F2545B", "#F5C542", "#2BB3C0", "#8C97A8"];
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;display:block">`;
    for (let i = 0; i <= 4; i++) { const v = lo + ((hi - lo) * i) / 4, y = Y(v); svg += `<line x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${P.l - 6}" y="${y + 4}" text-anchor="end" font-size="10.5" fill="var(--faint)">${money(v)}</text>`; }
    const step = Math.ceil(periods.length / 12);
    periods.forEach((p, i) => { if (i % step === 0) svg += `<text x="${X(p)}" y="${H - 9}" text-anchor="middle" font-size="10.5" fill="var(--faint)">${label(p)}</text>`; });
    pts.slice(0, 8).forEach((g, gi) => {
      const col = colours[gi % colours.length];
      if (!S.f.compare && g.ps.length > 1) svg += `<path d="M${g.ps.map((x) => `${X(x.p)},${Y(x.max)}`).join("L")}L${g.ps.slice().reverse().map((x) => `${X(x.p)},${Y(x.min)}`).join("L")}Z" fill="${col}" opacity=".12"/>`;
      if (g.ps.length > 1) svg += `<path d="M${g.ps.map((x) => `${X(x.p)},${Y(x.avg)}`).join("L")}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round"/>`;
      g.ps.forEach((x) => { svg += `<circle cx="${X(x.p)}" cy="${Y(x.avg)}" r="3.5" fill="${col}"><title>${S.f.compare ? g.k + " · " : ""}${label(x.p)}: ${money(x.avg)} avg · ${x.units} units · ${money(x.min)}–${money(x.max)}</title></circle>`; });
    });
    svg += "</svg>";
    if (S.f.compare) svg += `<div class="mdt-legend">${pts.slice(0, 8).map((g, i) => `<span><i style="background:${colours[i % colours.length]}"></i>${esc(g.k)}</span>`).join("")}</div>`;
    return svg;
  }
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
  const opts = (list, v, all) => `<option value="">${all}</option>` + list.map((x) => `<option ${x === v ? "selected" : ""}>${esc(x)}</option>`).join("");

  function draw() {
    const c = ctx(); if (!c) return;
    const all = (c.state.entries || []).filter((e) => e.date);
    const F = S.f;
    const pool = (k, ex) => uniq(all.filter((e) => Object.entries(ex).every(([f, v]) => !v || e[f] === v)).map((e) => e[k]));
    const list = entries(), st = stats(list);
    const now = new Date(), d30 = new Date(now - 30 * 864e5).toISOString().slice(0, 10), d60 = new Date(now - 60 * 864e5).toISOString().slice(0, 10);
    const recent = stats(list.filter((e) => e.date >= d30)), before = stats(list.filter((e) => e.date >= d60 && e.date < d30));
    const change = recent.avg && before.avg ? ((recent.avg - before.avg) / before.avg) * 100 : null;
    const bySup = Object.entries(series(list, (e) => e.supplier || "—")).map(([k]) => ({ k, s: stats(list.filter((e) => (e.supplier || "—") === k)) })).filter((x) => x.s.units).sort((a, b) => a.s.avg - b.s.avg);
    const per = series(list).all || {};
    const acc = c.accent || "#2FBF87";
    const mv = movers();

    const html = `
      <div class="mdt-head"><div><h3>Price trends</h3><p>From your Auction table · averages weighted by quantity${F.metric === "landed" ? " · landed cost includes invoice fees" : ""}</p></div><button class="mdt-x" data-x>✕</button></div>
      <div class="mdt-filters">
        <select data-f="oem">${opts(pool("oem", {}), F.oem, "All makes")}</select>
        <select data-f="model">${opts(pool("model", { oem: F.oem }), F.model, "All models")}</select>
        <select data-f="size">${opts(pool("size", { oem: F.oem, model: F.model }), F.size, "All sizes")}</select>
        <select data-f="grade">${opts(pool("grade", { oem: F.oem, model: F.model, supplier: F.supplier }), F.grade, "All grades")}</select>
        <select data-f="supplier">${opts(pool("supplier", {}), F.supplier, "All suppliers")}</select>
        <select data-f="status"><option value="won" ${F.status === "won" ? "selected" : ""}>Won / bought</option><option value="all" ${F.status === "all" ? "selected" : ""}>All statuses</option></select>
        <select data-f="months">${[[3, "Last 3 months"], [6, "Last 6 months"], [12, "Last 12 months"], [0, "All time"]].map(([v, l]) => `<option value="${v}" ${+F.months === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        <select data-f="by"><option value="month" ${F.by === "month" ? "selected" : ""}>By month</option><option value="week" ${F.by === "week" ? "selected" : ""}>By week</option></select>
        <select data-f="metric"><option value="price" ${F.metric === "price" ? "selected" : ""}>Price paid</option><option value="landed" ${F.metric === "landed" ? "selected" : ""}>Landed cost</option></select>
        <label class="mdt-chk"><input type="checkbox" data-f="compare" ${F.compare ? "checked" : ""}> Compare suppliers</label>
      </div>
      <div class="mdt-body">
        <div class="mdt-cards">
          <div><small>Units</small><b>${st.units.toLocaleString()}</b><span>${st.n} entries</span></div>
          <div><small>Spend</small><b>${money(st.spend)}</b><span>${F.metric === "landed" ? "landed" : "price × qty"}</span></div>
          <div><small>Average</small><b>${money(st.avg)}</b><span>${money(st.min)} – ${money(st.max)}</span></div>
          <div><small>Last 30 days vs 30 before</small><b class="${change > 0 ? "up" : change < 0 ? "down" : ""}">${pct(change)}</b><span>${money(recent.avg)} vs ${money(before.avg)}</span></div>
          <div><small>Cheapest supplier</small><b style="font-size:15px">${bySup[0] ? esc(bySup[0].k) : "—"}</b><span>${bySup[0] ? money(bySup[0].s.avg) + " avg" + (bySup[1] ? ` · ${money(bySup[1].s.avg - bySup[0].s.avg)} less than ${esc(bySup[1].k)}` : "") : ""}</span></div>
        </div>
        <div class="mdt-card">${chart(list, acc)}</div>
        <div class="mdt-two">
          <div class="mdt-card"><h4>By ${F.by}</h4><div class="mdt-scroll"><table><tr><th>${F.by === "week" ? "Week of" : "Month"}</th><th>Units</th><th>Average</th><th>Low</th><th>High</th></tr>
            ${Object.keys(per).sort().reverse().map((p) => { const s = stats(per[p]); return `<tr><td>${label(p)}</td><td>${s.units}</td><td><b>${money(s.avg)}</b></td><td>${money(s.min)}</td><td>${money(s.max)}</td></tr>`; }).join("") || `<tr><td colspan="5" class="mdt-empty">Nothing yet</td></tr>`}</table></div></div>
          <div class="mdt-card"><h4>Biggest price moves <small>(latest month vs the one before, all models)</small></h4>
            ${mv.length ? mv.map((m) => `<div class="mdt-mv"><span>${esc(m.k)}</span><b class="${m.ch > 0 ? "up" : "down"}">${pct(m.ch)}</b><small>${money(m.from)} → ${money(m.to)}</small></div>`).join("") : `<div class="mdt-empty">Needs at least two months of entries for a model.</div>`}</div>
        </div>
      </div>
      <div class="mdt-foot"><span>Download (opens in Excel):</span>
        <button data-dl="trend">⬇ Trend table</button><button data-dl="grid">⬇ Price grid by month</button><button data-dl="entries">⬇ Matching entries</button></div>`;

    if (!S.el) {
      S.el = document.createElement("div"); S.el.className = "mdt-back";
      S.el.addEventListener("click", (e) => { if (e.target === S.el || e.target.hasAttribute("data-x")) close(); });
      S.el.addEventListener("change", (e) => {
        const k = e.target.getAttribute("data-f"); if (!k) return;
        S.f[k] = e.target.type === "checkbox" ? e.target.checked : k === "months" ? +e.target.value : e.target.value;
        if (k === "oem") S.f.model = S.f.size = ""; if (k === "model") S.f.size = "";
        draw();
      });
      S.el.addEventListener("click", (e) => { const d = e.target.getAttribute && e.target.getAttribute("data-dl"); if (d === "trend") dlTrend(); if (d === "grid") dlMatrix(); if (d === "entries") dlEntries(); });
      document.body.appendChild(S.el);
    }
    S.el.innerHTML = `<div class="mdt ${c.isDark === false ? "light" : "dark"}" style="--a:${acc}">${html}</div>`;
  }
  function open(pre) { if (pre) Object.assign(S.f, pre); draw(); }
  function close() { if (S.el) S.el.remove(); S.el = null; }

  const CSS = `
  .mdt-back{position:fixed;inset:0;z-index:2147483000;background:rgba(5,8,12,.5);display:flex;align-items:center;justify-content:center;padding:14px}
  .mdt{width:min(1100px,100%);max-height:calc(100vh - 28px);display:flex;flex-direction:column;border-radius:20px;overflow:hidden;
    font:13px/1.45 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg);border:1px solid var(--line);
    -webkit-backdrop-filter:blur(26px) saturate(170%);backdrop-filter:blur(26px) saturate(170%);box-shadow:0 40px 100px -30px rgba(0,0,0,.7)}
  .mdt.dark{--bg:rgba(16,20,26,.96);--ink:#E9EDF3;--muted:#8C97A8;--faint:#5E6878;--line:rgba(255,255,255,.09);--glass:rgba(255,255,255,.05)}
  .mdt.light{--bg:rgba(250,251,252,.98);--ink:#141A21;--muted:#5F6B79;--faint:#8D98A6;--line:rgba(20,30,40,.09);--glass:rgba(255,255,255,.85)}
  @media (max-width:700px){.mdt-back{padding:0}.mdt{max-height:100vh;height:100%;border-radius:0}}
  .mdt *{box-sizing:border-box}
  .mdt-head{display:flex;gap:10px;padding:16px 18px 8px}.mdt-head h3{margin:0;font:600 20px "Iowan Old Style",Palatino,Georgia,serif}.mdt-head p{margin:2px 0 0;color:var(--muted);font-size:12.5px}
  .mdt-x{margin-left:auto;width:32px;height:32px;border-radius:10px;border:1px solid var(--line);background:var(--glass);color:var(--muted);cursor:pointer}
  .mdt-filters{display:flex;gap:6px;flex-wrap:wrap;padding:6px 18px 12px;border-bottom:1px solid var(--line)}
  .mdt-filters select{border:1px solid var(--line);background:var(--glass);color:var(--ink);border-radius:9px;padding:6px 8px;font:inherit;font-size:12.5px;max-width:190px}
  .mdt-chk{display:flex;align-items:center;gap:5px;color:var(--muted);font-size:12.5px}
  .mdt-body{overflow:auto;padding:14px 18px;display:grid;gap:12px}
  .mdt-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px}
  .mdt-cards>div{border:1px solid var(--line);background:var(--glass);border-radius:14px;padding:10px 12px}
  .mdt-cards small{display:block;color:var(--faint);font-size:11px}.mdt-cards b{display:block;font-size:20px;letter-spacing:-.01em;margin:2px 0}.mdt-cards span{color:var(--muted);font-size:11.5px}
  .up{color:#F2545B}.down{color:var(--a)}
  .mdt-card{border:1px solid var(--line);background:var(--glass);border-radius:14px;padding:12px 14px}
  .mdt-card h4{margin:0 0 8px;font-size:13px}.mdt-card h4 small{color:var(--faint);font-weight:400}
  .mdt-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}
  .mdt-scroll{max-height:280px;overflow:auto}
  .mdt table{width:100%;border-collapse:collapse;font-size:12.5px}.mdt th{text-align:left;color:var(--faint);font-weight:600;font-size:11px;padding:5px 6px;border-bottom:1px solid var(--line)}
  .mdt td{padding:6px;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums}
  .mdt-mv{display:grid;grid-template-columns:1fr auto;gap:0 10px;padding:6px 0;border-bottom:1px solid var(--line)}.mdt-mv small{color:var(--faint);grid-column:1/-1}
  .mdt-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:11.5px;color:var(--muted);margin-top:6px}.mdt-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
  .mdt-empty{color:var(--faint);text-align:center;padding:20px}
  .mdt-foot{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:12px 18px;border-top:1px solid var(--line);color:var(--muted);font-size:12.5px}
  .mdt-foot button{border:0;border-radius:10px;padding:8px 13px;font:inherit;font-weight:700;color:#fff;background:var(--a);cursor:pointer}
  `;
  function boot() {
    const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.el) close(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  window.MYDAYTrends = { open, close };
})();
