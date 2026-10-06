/* Captured Invoices — every invoice MYDAY has read from your email, waiting
 * for you to review and add to the Auction table.
 *
 * Each row: who it's from, dates, invoice number, total quantity, total
 * amount, which of your suppliers it matches (or that it's a new one), and
 * where it's at. "View invoice" opens it with everything filled in, ready to
 * add. The menu item blinks red and yellow while any are waiting.
 */
(function () {
  "use strict";
  const ctx = () => window.__myday || null;
  const S = { host: null, data: null, tab: "review", busy: false, msg: "" };
  const money = (n) => (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const nameOf = (from) => ((String(from || "").match(/^\s*"?([^"<]+?)"?\s*</) || [])[1] || String(from || "")).trim();
  const addrOf = (from) => ((String(from || "").match(/<([^>]+)>/) || [])[1] || "").trim();
  const fmtDay = (d) => { if (!d) return ""; const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d + "T12:00:00" : d); return isNaN(t) ? d : t.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); };

  const CSS = `
  @keyframes myday-alert{0%,100%{background:#F2545B;box-shadow:0 0 10px 2px rgba(242,84,91,.75)}50%{background:#F5C542;box-shadow:0 0 10px 2px rgba(245,197,66,.75)}}
  .myday-alert{display:inline-block;width:9px;height:9px;border-radius:999px;flex-shrink:0;animation:myday-alert 1s ease-in-out infinite}
  .myday-alert-n{font-size:11px;font-weight:800;border-radius:999px;padding:1px 7px;color:#fff;background:#F2545B}
  @media (prefers-reduced-motion:reduce){.myday-alert{animation:none;background:#F2545B}}
  .mdc{font:13.5px/1.5 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);padding-bottom:30px}
  .mdc.dark{--card:rgba(24,29,38,.58);--ink:#E9EDF3;--muted:#8C97A8;--faint:#5E6878;--line:rgba(255,255,255,.09);--chip:rgba(255,255,255,.05)}
  .mdc.light{--card:rgba(255,255,255,.66);--ink:#141A21;--muted:#5F6B79;--faint:#8D98A6;--line:rgba(20,30,40,.09);--chip:rgba(255,255,255,.7)}
  .mdc *{box-sizing:border-box}
  .mdc h1{font:600 30px "Iowan Old Style",Palatino,Georgia,serif;letter-spacing:-.02em;margin:22px 0 2px;display:flex;align-items:center;gap:12px}
  .mdc-sub{color:var(--muted);margin:0 0 14px;font-size:13px}
  .mdc-bar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
  .mdc-chip{border:1px solid var(--line);background:var(--chip);color:var(--muted);border-radius:999px;padding:5px 12px;font:inherit;font-size:12.5px;cursor:pointer}
  .mdc-chip.on{border-color:var(--a);color:var(--a);background:rgba(var(--a-rgb),.12);font-weight:700}
  .mdc-btn{border:1px solid var(--line);background:var(--chip);color:var(--muted);border-radius:10px;padding:6px 12px;font:inherit;font-size:12.5px;cursor:pointer}
  .mdc-btn:disabled{opacity:.5}
  .mdc-card{border:1px solid var(--line);background:var(--card);border-radius:16px;overflow:hidden;
    -webkit-backdrop-filter:blur(20px) saturate(160%);backdrop-filter:blur(20px) saturate(160%)}
  .mdc-scroll{overflow-x:auto}
  .mdc table{width:100%;border-collapse:collapse;min-width:860px}
  .mdc th{text-align:left;font-size:11px;font-weight:600;color:var(--faint);padding:11px 12px;border-bottom:1px solid var(--line);white-space:nowrap}
  .mdc td{padding:11px 12px;border-bottom:1px solid var(--line);vertical-align:middle}
  .mdc tr:last-child td{border-bottom:0}
  .mdc tr.review td:first-child{box-shadow:inset 3px 0 0 #F2545B}
  .mdc .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .mdc small{display:block;color:var(--faint);font-size:11.5px}
  .mdc-st{font-size:10.5px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;padding:3px 9px;border-radius:999px;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
  .mdc-st.review{background:rgba(242,84,91,.12);color:#F2545B}
  .mdc-st.added{background:rgba(var(--a-rgb),.15);color:var(--a)}
  .mdc-st.dismissed{background:rgba(140,151,168,.18);color:var(--muted)}
  .mdc-sup{font-weight:600}
  .mdc-new{font-size:11px;font-weight:700;color:#E8833A;background:rgba(232,131,58,.13);border-radius:999px;padding:2px 8px;display:inline-block;margin-top:2px}
  .mdc-view{border:0;border-radius:10px;padding:8px 14px;font:inherit;font-size:12.5px;font-weight:700;color:#fff;cursor:pointer;white-space:nowrap;
    background:linear-gradient(135deg,var(--a),rgba(var(--a-rgb),.72));box-shadow:0 6px 16px -8px rgba(var(--a-rgb),.9)}
  .mdc-view.quiet{background:var(--chip);color:var(--muted);border:1px solid var(--line);box-shadow:none;font-weight:600}
  .mdc-empty{padding:34px;text-align:center;color:var(--muted)}
  .mdc-reopen{border:0;background:none;color:var(--faint);font:inherit;font-size:11.5px;cursor:pointer;text-decoration:underline;padding:0;margin-top:3px}
  `;
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.appendChild(typeof kid === "string" || typeof kid === "number" ? document.createTextNode(String(kid)) : kid);
    }
    return el;
  }

  function supplierFor(inv) {
    const M = window.MYDAYInvoice;
    const m = M && M.matchSupplier ? M.matchSupplier({ supplier: inv.supplier, filename: inv.filename }, { from: inv.from, subject: inv.subject }) : null;
    return m ? { name: m.name, known: true } : { name: inv.supplier || nameOf(inv.from), known: false };
  }

  function draw() {
    if (!S.host) return;
    const c = ctx(), acc = (c && c.accent) || "#2FBF87", n = parseInt(acc.slice(1), 16);
    const root = h("div", { class: "mdc " + (c && c.isDark === false ? "light" : "dark") });
    root.style.setProperty("--a", acc);
    root.style.setProperty("--a-rgb", `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`);
    const all = (S.data && S.data.invoices) || [];
    const count = (st) => all.filter((x) => st === "all" || x.status === st).length;
    const rows = all.filter((x) => S.tab === "all" || x.status === S.tab);
    const waiting = count("review");

    root.append(
      h("h1", null, "Captured Invoices", waiting ? h("span", { class: "myday-alert", title: `${waiting} waiting for review` }) : null),
      h("p", { class: "mdc-sub" }, "Invoices from outside sellers that MYDAY read from your email. Review each one and add it to the Auction table — nothing goes in until you do. Each invoice number appears once; invoices from MobileSentrix itself are never captured."),
      S.data && S.data.since ? h("div", { class: "mdc-bar", style: "font-size:12.5px;color:var(--muted)" },
        "Showing invoices received since",
        h("input", { type: "date", value: S.data.since, max: new Date().toISOString().slice(0, 10), class: "mdc-btn", style: "padding:4px 8px",
          onchange: (e) => e.target.value && setSince(e.target.value) }),
        h("span", { style: "color:var(--faint)" }, "— new emails are added as they arrive")) : null,
      h("div", { class: "mdc-bar" },
        [["review", "To review"], ["added", "Added"], ["dismissed", "Not added"], ["all", "All"]].map(([k, l]) =>
          h("button", { class: "mdc-chip" + (S.tab === k ? " on" : ""), onclick: () => { S.tab = k; draw(); } }, `${l} (${count(k)})`)),
        h("span", { style: "flex:1" }),

        h("button", { class: "mdc-btn", onclick: load }, "↻ Refresh"),
        window.MYDAYModels && window.MYDAYModels.count() ? h("button", { class: "mdc-btn", style: "color:#C9A227;border-color:rgba(245,197,66,.5)",
          title: "Some Auction entries have a colour in the model name", onclick: () => { window.MYDAYModels.tidyWindow(); setTimeout(draw, 800); } },
          `🧹 Tidy model names (${window.MYDAYModels.count()})`) : null,
        S.msg ? h("span", { style: "font-size:12px;color:var(--faint)" }, S.msg) : null));

    const card = h("div", { class: "mdc-card" });
    if (!S.data) card.append(h("div", { class: "mdc-empty" }, "Loading…"));
    else if (!rows.length) card.append(h("div", { class: "mdc-empty" }, S.tab === "review"
      ? (all.length ? "All caught up — nothing waiting for review." : "No invoices captured yet. They'll appear here as MYDAY reads them from your email.")
      : "Nothing here."));
    else {
      card.append(h("div", { class: "mdc-scroll" }, h("table", null,
        h("thead", null, h("tr", null, ["From", "Email date", "Invoice no.", "Supplier", "Total qty", "Total amount", "Status", ""].map((x, i) =>
          h("th", { class: i === 4 || i === 5 ? "num" : "" }, x)))),
        h("tbody", null, rows.map((inv) => {
          const sup = supplierFor(inv);
          const st = inv.status === "review" ? ["review", "To review"] : inv.status === "added" ? ["added", "Added"] : ["dismissed", "Not added"];
          return h("tr", { class: inv.status },
            h("td", null, h("b", null, nameOf(inv.from)), h("small", null, addrOf(inv.from))),
            h("td", null, fmtDay(inv.emailDate), inv.invoiceDate && inv.invoiceDate !== inv.emailDate ? h("small", null, "invoice " + fmtDay(inv.invoiceDate)) : null),
            h("td", null, inv.reference || "—", h("small", null, inv.filename),
              inv.copies > 1 ? h("small", { title: (inv.copyFrom || []).join(", ") }, `received ${inv.copies}× — shown once`) : null),
            h("td", null, h("span", { class: "mdc-sup" }, sup.name || "—"), !sup.known ? h("div", null, h("span", { class: "mdc-new", title: "Not in your Suppliers setup yet — View invoice to add it" }, "New supplier")) : null),
            h("td", { class: "num" }, inv.qty, h("small", null, `${inv.lines} line${inv.lines === 1 ? "" : "s"}`)),
            h("td", { class: "num" }, h("b", null, money(inv.total))),
            h("td", null, h("span", { class: "mdc-st " + st[0] }, inv.status === "review" ? h("span", { class: "myday-alert" }) : null, st[1]),
              inv.status === "added" && inv.logged ? h("small", null, `${inv.logged.count} lines · ${new Date(inv.logged.at).toLocaleDateString()}`) : null,
              inv.status === "added" ? h("button", { class: "mdc-reopen", title: "Remove this invoice's lines from the Auction table",
                onclick: async () => { if (!confirm(`Take invoice ${inv.reference || ""} back out of the Auction table? Its lines will be removed and it goes back to "To review".`)) return;
                  const n = await window.MYDAYInvoice.undoAdd(inv.mailId, inv.sha, inv.reference); S.msg = `Removed ${n} line${n === 1 ? "" : "s"} from the Auction table`; load(); } }, "Undo add") : null,
              inv.status === "dismissed" ? h("button", { class: "mdc-reopen", onclick: () => reopen(inv) }, "Put back to review") : null,
              inv.flagged && inv.status === "review" ? h("small", null, `${inv.flagged} line${inv.flagged === 1 ? "" : "s"} to check`) : null),
            h("td", { class: "num" }, h("button", { class: "mdc-view" + (inv.status === "review" ? "" : " quiet"),
              onclick: () => window.MYDAYInvoice && window.MYDAYInvoice.open(inv.mailId, inv.sha) }, "🧾 View invoice")));
        })))));
    }
    root.append(card);
    S.host.replaceChildren(root);
  }

  async function load() {
    try {
      const r = await fetch("/api/automation/invoices", { credentials: "same-origin" });
      if (r.ok) { S.data = await r.json(); announce(S.data); }
    } catch (e) { S.msg = "Couldn't reach the server"; }
    draw();
  }
  async function setSince(date) {
    if (!date) return;
    S.msg = "";
    try {
      const r = await fetch("/api/automation/captured-since", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ date }) });
      const j = await r.json();
      if (!r.ok) S.msg = j.error || "Couldn't change the date";
    } catch (e) { S.msg = "Couldn't reach the server"; }
    await load();
    watchFetch();
  }
  /* While a fetch runs, check back every few seconds. */
  let fetchTimer = null;
  function watchFetch() {
    clearTimeout(fetchTimer);
    if (S.data && S.data.fetching) fetchTimer = setTimeout(async () => { await load(); watchFetch(); }, 4000);
  }
  async function reopen(inv) {
    await fetch("/api/automation/invoice-status", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: inv.mailId, sha: inv.sha, status: "review" }) }).catch(() => {});
    load();
  }

  /* The light on the menu item: blinking red and yellow while any wait. */
  let last = null;
  function announce(d) { last = d; try { window.__mydayInvoiceCount && window.__mydayInvoiceCount(d.toReview || 0); } catch (e) {} }
  window.addEventListener("myday-tidied", () => draw());
  window.addEventListener("myday-invoices", (e) => { announce(e.detail); if (S.host) { S.data = e.detail; draw(); } });
  async function poll() {
    if (!ctx()) return;
    try { const r = await fetch("/api/automation/invoices", { credentials: "same-origin" }); if (r.ok) { const d = await r.json(); announce(d); if (S.host) { S.data = d; draw(); } } } catch (e) {}
  }

  function mount(host) { S.host = host; draw(); load().then(watchFetch); }
  function unmount() { S.host = null; }
  function boot() {
    const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    setTimeout(poll, 3000);
    setInterval(poll, 60000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  window.MYDAYCaptured = { mount, unmount, poll, count: () => (last ? last.toReview || 0 : 0) };
})();
