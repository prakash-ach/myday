/* Every table in MYDAY gets: rows per page (default 20; 30 50 100 200 500
   1000 2000 3000) with Prev/Next, and a Columns picker (remembered per table).
   Works on any table on any page, including ones drawn later. */
(function () {
  "use strict";
  const SIZES = [20, 30, 50, 100, 200, 500, 1000, 2000, 3000];
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const rowsPer = () => { const n = +get("myday_rows", 20); return SIZES.includes(n) ? n : 20; };
  const pages = new Map();                                   // table signature → current page
  const headers = (t) => [...t.querySelectorAll("thead th")].map((th) => th.textContent.replace(/[▲▼]/g, "").trim());
  const sig = (t) => "myday_cols:" + location.pathname + ":" + headers(t).join("|").slice(0, 300);
  const eligible = (t) => t.tHead && t.querySelectorAll("thead th").length >= 3 && !t.closest(".rp-kv,[data-no-tools]") && !t.classList.contains("rp-kv");
  const ownPager = (t) => { const w = t.closest(".rp-tablewrap"); return !!(w && w.nextElementSibling && w.nextElementSibling.classList.contains("rp-pager")); };

  function apply(t) {
    const key = sig(t), hide = new Set(get(key, []));
    const H = headers(t);
    // columns
    t.querySelectorAll("tr").forEach((tr) => {
      let i = 0;
      for (const cell of tr.children) { const span = cell.colSpan || 1; if (span === 1) cell.style.display = hide.has(H[i]) ? "none" : ""; i += span; }
    });
    // rows (tables that already page themselves are left to their own pager)
    const body = [...t.tBodies].flatMap((b) => [...b.rows]).filter((r) => !r.querySelector("td[colspan]") || r.children.length > 1);
    const per = rowsPer(), total = body.length, own = ownPager(t);
    let page = pages.get(key) || 0; const last = Math.max(0, Math.ceil(total / per) - 1); if (page > last) page = last; pages.set(key, page);
    if (!own) body.forEach((r, i) => { r.style.display = i >= page * per && i < (page + 1) * per ? "" : "none"; });
    return { key, H, hide, total, per, page, last, own };
  }
  function bar(t, st) {
    let b = t.__mydayBar;
    const host = t.closest(".rp-tablewrap,.sb-wrap,.mdc-scroll,.mdk-tbl,.mdt-scroll") || t;
    if (!b || !b.isConnected) {
      b = document.createElement("div"); b.className = "myday-tbar"; host.parentNode.insertBefore(b, host); t.__mydayBar = b;
      b.addEventListener("change", (e) => {
        if (e.target.dataset.rows) { put("myday_rows", +e.target.value); pages.clear(); window.dispatchEvent(new CustomEvent("myday-rows", { detail: +e.target.value })); refreshAll(); }
        if (e.target.dataset.col != null) { const s = new Set(get(st.key, [])); e.target.checked ? s.delete(e.target.dataset.col) : s.add(e.target.dataset.col); put(st.key, [...s]); refreshAll(); }
      });
      b.addEventListener("click", (e) => {
        const k = sig(t);
        if (e.target.dataset.pg) { pages.set(k, Math.max(0, (pages.get(k) || 0) + +e.target.dataset.pg)); refreshAll(); }
        if (e.target.hasAttribute("data-cols")) { const m = b.querySelector(".myday-cols"); m.hidden = !m.hidden; }
        if (e.target.hasAttribute("data-reset")) { put(k, []); refreshAll(); }
      });
    }
    const open = b.querySelector(".myday-cols") && !b.querySelector(".myday-cols").hidden;
    b.innerHTML = `<label>Rows <select data-rows="1">${SIZES.map((n) => `<option ${n === st.per ? "selected" : ""}>${n}</option>`).join("")}</select></label>
      ${st.own ? "" : `<span class="myday-pg"><button data-pg="-1" ${st.page ? "" : "disabled"}>‹ Prev</button> page ${st.page + 1} of ${st.last + 1} · ${st.total} rows <button data-pg="1" ${st.page < st.last ? "" : "disabled"}>Next ›</button></span>`}
      <button data-cols="1">Columns ▾${st.hide.size ? ` (${st.H.length - st.hide.size} of ${st.H.length})` : ""}</button>
      <div class="myday-cols" ${open ? "" : "hidden"}>${st.H.map((h, i) => h ? `<label><input type="checkbox" data-col="${h.replace(/"/g, "&quot;")}" ${st.hide.has(h) ? "" : "checked"}> ${h.replace(/</g, "&lt;")}</label>` : "").join("")}<button data-reset="1">Show all columns</button></div>`;
  }
  let busy = false;
  function refreshAll() {
    if (busy) return; busy = true;
    try { document.querySelectorAll("table").forEach((t) => { if (eligible(t)) bar(t, apply(t)); }); }
    finally { setTimeout(() => (busy = false), 0); }
  }
  let tmr = null;
  new MutationObserver((muts) => {
    if (busy || muts.every((m) => m.target.closest && m.target.closest(".myday-tbar"))) return;
    clearTimeout(tmr); tmr = setTimeout(refreshAll, 120);
  }).observe(document.documentElement, { childList: true, subtree: true });
  const st = document.createElement("style");
  st.textContent = `.myday-tbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:6px 0;font:12.5px ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;color:#8C97A8;position:relative}
  .myday-tbar select,.myday-tbar button{font:inherit;border:1px solid rgba(140,151,168,.35);background:rgba(140,151,168,.08);color:inherit;border-radius:8px;padding:4px 9px;cursor:pointer}
  .myday-tbar button:disabled{opacity:.4;cursor:default}.myday-pg{display:flex;gap:6px;align-items:center}
  .myday-cols{position:absolute;top:32px;left:0;z-index:50;background:var(--bg,#fff);color:var(--ink,#141A21);border:1px solid rgba(140,151,168,.35);border-radius:12px;padding:10px 12px;
    display:grid;grid-template-columns:repeat(2,minmax(150px,1fr));gap:4px 14px;max-height:340px;overflow:auto;box-shadow:0 18px 50px -18px rgba(0,0,0,.45)}
  .myday-cols[hidden]{display:none}.myday-cols label{display:flex;gap:6px;align-items:center;white-space:nowrap}.myday-cols button{grid-column:1/-1;margin-top:4px}
  @media (prefers-color-scheme:dark){.myday-cols{background:#141a22;color:#E9EDF3}}`;
  document.head.appendChild(st);
  window.MYDAYTables = { refresh: refreshAll, rowsPer };
})();
