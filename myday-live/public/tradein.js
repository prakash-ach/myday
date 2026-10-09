/* Apple Trade-In — what Apple gives "up to" for each device, what changed and
   when, and how that compares with what you've been paying (your Auction
   table, last 30 days, all grades and sizes). */
(function () {
  "use strict";
  const ctx = () => window.__myday || null;
  const S = { host: null, data: null, kind: "iPhone", busy: false, msg: "", paste: false, open: new Set(), q: "" };
  const money = (n) => (n == null ? "—" : Number(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
  const day = (t) => (t ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
  const norm = (s) => String(s || "").toLowerCase().replace(/^apple\s+/, "").replace(/[^a-z0-9]/g, "");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

  /* Your average price per model over the last 30 days, weighted by quantity. */
  function yours() {
    const c = ctx(); const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const by = {};
    for (const e of (c && c.state && c.state.entries) || []) {
      if (!e.date || e.date < since || !(+e.price > 0) || e.status === "lost") continue;
      const k = norm(e.model); (by[k] = by[k] || { q: 0, s: 0 }); by[k].q += +e.qty || 1; by[k].s += (+e.price) * (+e.qty || 1);
    }
    return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { avg: v.s / v.q, units: v.q }]));
  }

  const CSS = `
  .mdt2{font:13.5px/1.45 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);padding-bottom:40px}
  .mdt2.dark{--card:rgba(24,29,38,.58);--ink:#E9EDF3;--muted:#8C97A8;--faint:#5E6878;--line:rgba(255,255,255,.08);--chip:rgba(255,255,255,.05)}
  .mdt2.light{--card:rgba(255,255,255,.68);--ink:#141A21;--muted:#5F6B79;--faint:#8D98A6;--line:rgba(20,30,40,.08);--chip:rgba(255,255,255,.75)}
  .mdt2 *{box-sizing:border-box}.mdt2 button,.mdt2 textarea{font:inherit;color:inherit}
  .mdt2 h1{font:600 30px "Iowan Old Style",Palatino,Georgia,serif;letter-spacing:-.02em;margin:22px 0 2px}
  .mdt2-sub{color:var(--muted);margin:0 0 12px;font-size:13px}
  .mdt2-bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
  .mdt2-chip{border:1px solid var(--line);background:var(--chip);color:var(--muted);border-radius:999px;padding:5px 12px;cursor:pointer;font-size:12.5px}
  .mdt2-chip.on{border-color:var(--a);color:var(--a);font-weight:700;background:color-mix(in srgb,var(--a) 12%,transparent)}
  .mdt2-btn{border:1px solid var(--line);background:var(--chip);color:var(--muted);border-radius:10px;padding:6px 12px;cursor:pointer;font-size:12.5px}
  .mdt2-meta{font-size:12px;color:var(--faint)}
  .mdt2-search{border:1px solid var(--line);background:var(--chip);color:var(--ink);border-radius:999px;padding:6px 13px;min-width:230px;outline:none;font:inherit;font-size:12.5px}
  .mdt2-search:focus{border-color:var(--a)}
  .mdt2-warn{margin:8px 0;padding:9px 12px;border-radius:10px;background:rgba(245,197,66,.12);color:#C9A227;font-size:12.5px}
  .mdt2-card{border:1px solid var(--line);background:var(--card);border-radius:16px;overflow:hidden;-webkit-backdrop-filter:blur(20px) saturate(160%);backdrop-filter:blur(20px) saturate(160%)}
  .mdt2 table{width:100%;border-collapse:collapse}
  .mdt2 th{text-align:left;font-size:11px;font-weight:600;color:var(--faint);padding:10px 14px;border-bottom:1px solid var(--line)}
  .mdt2 td{padding:10px 14px;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums}
  .mdt2 tr:last-child td{border-bottom:0}
  .mdt2 tr.row{cursor:pointer}.mdt2 tr.row:hover td{background:color-mix(in srgb,var(--a) 4%,transparent)}
  .mdt2 .n{text-align:right}
  .up{color:#22C55E;font-weight:700}.down{color:#F2545B;font-weight:700}
  .mdt2-hist{font-size:12px;color:var(--muted)}
  .mdt2 textarea{width:100%;min-height:140px;border:1px solid var(--line);background:var(--card);border-radius:12px;padding:10px;outline:none;margin:6px 0}
  .mdt2-pri{border:0;border-radius:10px;padding:7px 14px;font-weight:700;color:#fff;background:var(--a);cursor:pointer}
  .mdt2-empty{padding:30px;text-align:center;color:var(--muted)}
  `;
  function draw() {
    if (!S.host) return;
    const c = ctx(), D = S.data;
    const mine = yours();
    const kinds = ["iPhone", "iPad", "Mac", "Apple Watch", "Android"];
    const rows = D ? (S.q.trim() ? matches(S.q, D.rows, 50) : D.rows.filter((r) => r.kind === S.kind)) : [];
    const html = `
      <h1>Apple Trade-In</h1>
      <p class="mdt2-sub">What Apple gives <b>up to</b> (best condition, US) for each device, what changed and when — next to what you've been paying.</p>
      <div class="mdt2-bar">
        ${kinds.map((k) => `<button class="mdt2-chip ${S.kind === k && !S.q.trim() ? "on" : ""}" data-k="${k}">${k}${D ? ` · ${D.rows.filter((r) => r.kind === k).length}` : ""}</button>`).join("")}
        <input class="mdt2-search" data-q placeholder="Type a model… e.g. iphone 13 pro" value="${esc(S.q)}">
        <span style="flex:1"></span>
        <button class="mdt2-btn" data-check ${S.busy ? "disabled" : ""}>${S.busy ? "Checking…" : "↻ Check Apple now"}</button>
        <button class="mdt2-btn" data-paste>📋 Paste from Apple</button>
        <a class="mdt2-btn" href="${D ? D.page : "https://www.apple.com/shop/trade-in"}" target="_blank" rel="noopener noreferrer" style="text-decoration:none">Open Apple's page ↗</a>
      </div>
      <div class="mdt2-meta">${D && D.updated ? `Values as of ${day(D.updated)} (from ${esc(D.source)}) · last checked ${day(D.lastCheck)}` : "No values yet — check Apple or paste them in."}${S.msg ? " · " + esc(S.msg) : ""}</div>
      ${D && D.lastError ? `<div class="mdt2-warn">${esc(D.lastError)}</div>` : ""}
      ${S.paste ? `<div class="mdt2-card" style="padding:12px 14px;margin:10px 0">
        <b>Paste trade-in values</b><div class="mdt2-meta">Open Apple's trade-in page (or a 9to5Mac / MacRumors list), select all, copy, and paste here. MYDAY picks out each model and its "up to" amount.</div>
        <textarea placeholder="iPhone 16 Pro Max  Up to $720&#10;iPhone 16 Pro  Up to $600&#10;…"></textarea>
        <button class="mdt2-pri" data-read>Read these values</button> <button class="mdt2-btn" data-paste>Cancel</button></div>` : ""}
      <div class="mdt2-card" style="margin-top:10px">${rows.length ? `<table>
        <tr><th>Model</th><th class="n">Apple gives up to</th><th class="n">Change</th><th class="n">You paid (30-day avg)</th><th class="n">Apple vs you</th></tr>
        ${rows.map((r) => { const y = mine[norm(r.model)]; const spread = y ? r.value - y.avg : null; const open = S.open.has(r.model);
          return `<tr class="row" data-m="${esc(r.model)}"><td><b>${esc(r.model)}</b> <button class="mdt2-btn" style="padding:1px 7px;margin-left:4px" data-w="${esc(r.model)}" title="Watch this model for changes">👁</button></td><td class="n"><b>${money(r.value)}</b></td>
            <td class="n">${r.change ? `<span class="${r.change > 0 ? "up" : "down"}">${r.change > 0 ? "▲" : "▼"} ${money(Math.abs(r.change))}</span> <span class="mdt2-meta">${day(r.since)}</span>` : `<span class="mdt2-meta">no change</span>`}</td>
            <td class="n">${y ? `${money(y.avg)} <span class="mdt2-meta">· ${y.units} units</span>` : `<span class="mdt2-meta">—</span>`}</td>
            <td class="n">${spread == null ? "—" : `<span class="${spread >= 0 ? "up" : "down"}">${spread >= 0 ? "+" : "−"}${money(Math.abs(spread))}</span>`}</td></tr>
            ${open ? `<tr><td colspan="5" class="mdt2-hist">History: ${r.history.map((h) => `${day(h.at)} <b>${money(h.v)}</b>`).join(" → ")}</td></tr>` : ""}`; }).join("")}
        </table>` : `<div class="mdt2-empty">${D && D.rows.length ? "No " + esc(S.kind) + " models in Apple's list." : "No trade-in values yet."}</div>`}</div>
      <p class="mdt2-meta" style="margin-top:10px">"Apple vs you" is Apple's best-condition offer minus your average buy price for that model (all grades and sizes) — a quick sense of the gap, not a quote. Tap a row for its history.</p>`;
    const root = document.createElement("div");
    root.className = "mdt2 " + (c && c.isDark === false ? "light" : "dark");
    root.style.setProperty("--a", (c && c.accent) || "#2FBF87");
    root.innerHTML = html;
    root.addEventListener("click", async (e) => {
      const w = e.target.closest("[data-w]"); if (w) { e.stopPropagation(); if (window.MYDAYCool) { window.MYDAYCool.watch(w.dataset.w); w.textContent = "👁 ✓"; } return; }
      const t = e.target.closest("[data-k],[data-check],[data-paste],[data-read],[data-m]"); if (!t) return;
      if (t.dataset.k) { S.kind = t.dataset.k; S.q = ""; return draw(); }
      if (t.dataset.m) { S.open.has(t.dataset.m) ? S.open.delete(t.dataset.m) : S.open.add(t.dataset.m); return draw(); }
      if (t.hasAttribute("data-paste")) { S.paste = !S.paste; return draw(); }
      if (t.hasAttribute("data-check")) { S.busy = true; draw(); await call("/api/tradein/check"); S.busy = false; return draw(); }
      if (t.hasAttribute("data-read")) { await call("/api/tradein/paste", { text: root.querySelector("textarea").value, label: "pasted" }); if (!S.msgErr) S.paste = false; return draw(); }
    });
    root.addEventListener("input", (e) => {
      if (!e.target.hasAttribute("data-q")) return;
      S.q = e.target.value; const pos = e.target.selectionStart;
      clearTimeout(S.qt); S.qt = setTimeout(() => { draw(); const i = S.host && S.host.querySelector("[data-q]"); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }, 150);
    });
    S.host.replaceChildren(root);
  }

  /* Models matching what was typed: every word must appear ("iphone 13 pro"
     → iPhone 13 Pro, iPhone 13 Pro Max). Closest first. */
  function matches(q, rows, max) {
    const words = String(q).toLowerCase().replace(/apple\s+/, "").split(/\s+/).filter(Boolean);
    if (!words.length || !words.some((w) => /[a-z]/.test(w) || w.length >= 2)) return [];
    const nq = norm(q);
    return (rows || []).filter((r) => { const m = r.model.toLowerCase(); return words.every((w) => m.includes(w)); })
      .sort((a, b) => (norm(a.model) === nq ? -1 : 0) - (norm(b.model) === nq ? -1 : 0) || a.model.length - b.model.length).slice(0, max);
  }

  /* ---------- the card under MYDAY's top search bar ---------- */
  let card = null, cache = null, cacheAt = 0;
  async function data() {
    if (S.data) return S.data;
    if (cache && Date.now() - cacheAt < 30 * 60e3) return cache;
    try { const r = await fetch("/api/tradein", { credentials: "same-origin" }); cache = r.ok ? await r.json() : { rows: [], denied: r.status === 403 }; cacheAt = Date.now(); } catch (e) { cache = { rows: [] }; }
    return cache;
  }
  function hideCard() { if (card) { card.remove(); card = null; } }
  async function showCard(input) {
    const q = input.value.trim();
    if (q.length < 3 || !/iphone|ipad|watch|mac|galaxy|pixel|samsung|google|\b1[0-9]\b|pro|max|mini|plus|ultra/i.test(q)) return hideCard();
    const D = await data();
    if (!D || D.denied) return hideCard();
    const list = matches(q, D.rows, 5);
    if (!list.length || input.value.trim() !== q) return hideCard();
    const mine = yours(), c = ctx(), dark = !(c && c.isDark === false), acc = (c && c.accent) || "#2FBF87";
    if (!card) { card = document.createElement("div"); document.body.appendChild(card); }
    const r = input.getBoundingClientRect();
    card.setAttribute("style", `position:fixed;z-index:2147482500;left:${r.left}px;top:${r.bottom + 6}px;width:${Math.max(r.width, 340)}px;border-radius:14px;overflow:hidden;
      font:13px/1.4 ui-sans-serif,-apple-system,'Segoe UI',Roboto,sans-serif;color:${dark ? "#E9EDF3" : "#141A21"};background:${dark ? "rgba(16,20,26,.97)" : "rgba(255,255,255,.98)"};
      border:1px solid ${dark ? "rgba(255,255,255,.1)" : "rgba(20,30,40,.1)"};box-shadow:0 18px 50px -18px rgba(0,0,0,.55);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px)`);
    card.innerHTML = `<div style="padding:8px 12px 4px;font-size:11px;font-weight:700;color:${acc};letter-spacing:.03em">APPLE TRADE-IN · up to, best condition${D.updated ? " · as of " + day(D.updated) : ""}</div>` +
      list.map((x) => { const y = mine[norm(x.model)];
        return `<div data-go="${esc(x.model)}" style="display:flex;gap:10px;align-items:baseline;padding:7px 12px;cursor:pointer;border-top:1px solid ${dark ? "rgba(255,255,255,.06)" : "rgba(20,30,40,.06)"}">
          <b style="flex:1">${esc(x.model)}</b><b>${money(x.value)}</b>
          ${x.change ? `<span style="color:${x.change > 0 ? "#22C55E" : "#F2545B"};font-size:12px">${x.change > 0 ? "▲" : "▼"}${money(Math.abs(x.change))}</span>` : ""}
          <span style="color:${dark ? "#8C97A8" : "#5F6B79"};font-size:12px;min-width:110px;text-align:right">${y ? "you paid " + money(y.avg) : ""}</span></div>`; }).join("");
    card.onmousedown = (e) => {
      const go = e.target.closest("[data-go]"); if (!go) return;
      e.preventDefault(); S.q = go.dataset.go; hideCard();
      try { ctx().setView("tradein"); } catch (err) {}
    };
  }
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (!t || t.tagName !== "INPUT" || !/^Search tasks/.test(t.placeholder || "")) return;
    clearTimeout(showCard.t); showCard.t = setTimeout(() => showCard(t), 180);
  }, true);
  document.addEventListener("focusout", (e) => { if (e.target && /^Search tasks/.test(e.target.placeholder || "")) setTimeout(hideCard, 150); }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideCard(); });
  async function call(url, body) {
    S.msg = ""; S.msgErr = false;
    try {
      const r = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
      const j = await r.json();
      if (!r.ok) { S.msg = j.error || "Couldn't do that"; S.msgErr = true; return; }
      S.data = j;
      const res = j.result || {};
      S.msg = j.note || (res.error ? res.error : res.count ? `${res.count} values read${res.changed ? " — changes saved" : " — no changes"}` : "");
    } catch (e) { S.msg = "Couldn't reach the server"; S.msgErr = true; }
  }
  async function load() {
    try { const r = await fetch("/api/tradein", { credentials: "same-origin" }); const j = await r.json(); if (r.ok) S.data = j; else S.msg = j.error; } catch (e) { S.msg = "Couldn't reach the server"; }
    draw();
  }
  function mount(host) {
    if (!document.getElementById("mdt2-css")) { const st = document.createElement("style"); st.id = "mdt2-css"; st.textContent = CSS; document.head.appendChild(st); }
    S.host = host; draw(); load();
  }
  function unmount() { S.host = null; }
  async function lookup(q, max) { const D = await data(); return { rows: D && !D.denied ? matches(q, D.rows, max || 5) : [], mine: yours(), updated: D && D.updated, denied: !!(D && D.denied) }; }
  window.MYDAYTradeIn = { mount, unmount, lookup, yours, norm, open: (q) => { S.q = q || ""; try { ctx().setView("tradein"); } catch (e) {} } };
})();
