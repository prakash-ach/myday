/* MYDAY invoices — "I found an invoice. Want to log it?"
 *
 * Watches the Automation feed. When an email has an invoice whose lines
 * were read (by the ONM or Rexi readers, or by the AI for anyone else's,
 * including scans and photos), a small card pops up asking whether to
 * review it. Review opens the lines as an editable table: fix anything,
 * untick anything, pick the status, then log them to Auctions in one go.
 * Nothing goes into Auctions until you press Log, and once logged the
 * server remembers, so the same invoice isn't logged twice by accident.
 */
(function () {
  "use strict";

  const S = { feed: null, open: null, asked: new Set(), toast: null, el: {} };
  const ctx = () => window.__myday || null;
  const KEY = "myday_inv_dismissed";
  const dismissed = () => { try { return new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch (e) { return new Set(); } };
  const dismiss = (k) => { try { const d = dismissed(); d.add(k); localStorage.setItem(KEY, JSON.stringify([...d].slice(-500))); } catch (e) {} };
  const money = (n) => (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const CSS = `
  .mdi{--a:#2FBF87;--a-rgb:47,191,135;font:13px/1.4 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink)}
  .mdi.dark{--bg:rgba(16,20,26,.94);--ink:#E9EDF3;--muted:#8C97A8;--faint:#5E6878;--glass:rgba(255,255,255,.06);--line:rgba(255,255,255,.1);--warn:#F5C542;--warnbg:rgba(245,197,66,.1)}
  .mdi.light{--bg:rgba(250,251,252,.96);--ink:#141A21;--muted:#5F6B79;--faint:#8D98A6;--glass:rgba(255,255,255,.8);--line:rgba(20,30,40,.1);--warn:#B8860B;--warnbg:rgba(245,197,66,.14)}
  .mdi *{box-sizing:border-box}
  .mdi button{font:inherit;color:inherit;cursor:pointer}
  .mdi-toast{position:fixed;left:18px;bottom:22px;z-index:2147481500;width:min(370px,calc(100vw - 36px));padding:14px;border-radius:16px;
    background:var(--bg);border:1px solid rgba(var(--a-rgb),.45);-webkit-backdrop-filter:blur(22px) saturate(160%);backdrop-filter:blur(22px) saturate(160%);
    box-shadow:0 20px 60px -20px rgba(0,0,0,.55),0 0 0 4px rgba(var(--a-rgb),.08);animation:mdi-in .35s cubic-bezier(.2,.8,.2,1)}
  @keyframes mdi-in{from{transform:translateY(20px);opacity:0}}
  .mdi-toast b{display:block;font-size:14px;margin-bottom:2px}
  .mdi-toast p{margin:0 0 10px;color:var(--muted);font-size:12.5px}
  .mdi-row{display:flex;gap:7px;flex-wrap:wrap}
  .mdi-pri{border:0;border-radius:10px;padding:8px 14px;font-weight:700;color:#fff;background:linear-gradient(135deg,var(--a),rgba(var(--a-rgb),.75))}
  .mdi-sec{border:1px solid var(--line);background:var(--glass);border-radius:10px;padding:8px 12px;color:var(--muted)}
  .mdi-ic{font-size:20px;margin-right:6px}
  .mdi-back{position:fixed;inset:0;z-index:2147483100;background:rgba(5,8,12,.5);display:flex;align-items:center;justify-content:center;padding:16px}
  .mdi-modal{width:min(1080px,100%);max-height:calc(100vh - 32px);display:flex;flex-direction:column;border-radius:20px;overflow:hidden;
    background:var(--bg);border:1px solid var(--line);-webkit-backdrop-filter:blur(26px) saturate(170%);backdrop-filter:blur(26px) saturate(170%);
    box-shadow:0 40px 100px -30px rgba(0,0,0,.7)}
  @media (max-width:700px){.mdi-back{padding:0}.mdi-modal{max-height:100vh;height:100%;border-radius:0}}
  .mdi-head{padding:16px 18px 12px;border-bottom:1px solid var(--line);display:flex;gap:12px;align-items:flex-start}
  .mdi-head h3{margin:0;font:600 18px "Iowan Old Style",Palatino,Georgia,serif}
  .mdi-head small{color:var(--faint)}
  .mdi-tag{display:inline-block;font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:999px;background:rgba(var(--a-rgb),.15);color:var(--a);margin-left:6px;vertical-align:2px}
  .mdi-x{margin-left:auto;width:32px;height:32px;border-radius:10px;border:1px solid var(--line);background:var(--glass);flex-shrink:0}
  .mdi-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;padding:12px 18px;border-bottom:1px solid var(--line)}
  .mdi-meta label{font-size:11px;color:var(--faint);display:block}
  .mdi-in{width:100%;border:1px solid var(--line);background:var(--glass);color:var(--ink);border-radius:8px;padding:6px 8px;font:inherit;outline:none}
  .mdi-in:focus{border-color:rgba(var(--a-rgb),.65)}
  .mdi-sum{display:flex;gap:14px;flex-wrap:wrap;padding:10px 18px;font-size:12.5px;color:var(--muted);border-bottom:1px solid var(--line);align-items:center}
  .mdi-sum b{color:var(--ink)}
  .mdi-ok{color:var(--a);font-weight:700}
  .mdi-bad{color:var(--warn);font-weight:700}
  .mdi-tbl{flex:1;overflow:auto}
  .mdi table{width:100%;border-collapse:collapse;min-width:820px}
  .mdi th{position:sticky;top:0;background:var(--bg);text-align:left;font-size:11px;font-weight:600;color:var(--faint);padding:8px 6px;border-bottom:1px solid var(--line);z-index:1}
  .mdi td{padding:5px 6px;border-bottom:1px solid var(--line);vertical-align:top}
  .mdi td .mdi-in{padding:5px 7px}
  .mdi tr.off td{opacity:.4}
  .mdi tr.flag td{background:var(--warnbg)}
  .mdi .iss{font-size:11px;color:var(--warn);margin-top:3px}
  .mdi .raw{font-size:10.5px;color:var(--faint);margin-top:3px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .mdi-num{text-align:right;font-variant-numeric:tabular-nums}
  .mdi-foot{display:flex;gap:8px;align-items:center;padding:12px 18px;border-top:1px solid var(--line);flex-wrap:wrap}
  .mdi-note{font-size:12px;color:var(--muted);margin-right:auto}
  .mdi-warn{margin:10px 18px 0;padding:9px 12px;border-radius:10px;background:var(--warnbg);color:var(--warn);font-size:12.5px}
  .mdi-tabs{display:flex;gap:6px;padding:10px 18px 0;flex-wrap:wrap}
  .mdi-tabs button{border:1px solid var(--line);background:var(--glass);border-radius:999px;padding:5px 12px;font-size:12px;color:var(--muted)}
  .mdi-tabs button.on{border-color:var(--a);color:var(--a);font-weight:700}
  input[type=checkbox].mdi-ck{width:16px;height:16px;accent-color:var(--a)}
  `;

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style") el.setAttribute("style", v);
      else if (k === "value") el.value = v;
      else if (k === "checked") el.checked = !!v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.appendChild(typeof kid === "string" || typeof kid === "number" ? document.createTextNode(String(kid)) : kid);
    }
    return el;
  }

  function themed(el) {
    const c = ctx();
    const acc = (c && c.accent) || "#2FBF87";
    const n = parseInt(acc.slice(1), 16);
    el.classList.add("mdi", c && c.isDark === false ? "light" : "dark");
    el.style.setProperty("--a", acc);
    el.style.setProperty("--a-rgb", `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`);
    return el;
  }

  /* ---------- the feed ---------- */
  async function loadFeed() {
    try {
      const r = await fetch("/api/automation/feed", { credentials: "same-origin" });
      if (!r.ok) return null;
      S.feed = await r.json();
      return S.feed;
    } catch (e) { return null; }
  }
  const invoicesIn = (item) => (item.documents || []).filter((d) => d.rows && d.rows.length);
  function pending(feed) {
    const out = [], skip = dismissed();
    for (const item of (feed && feed.items) || []) {
      if (item.decided === "ignored") continue;
      for (const d of invoicesIn(item)) {
        const k = item.id + ":" + d.sha;
        if (!d.logged && !skip.has(k)) out.push({ item, doc: d, key: k });
      }
    }
    return out;
  }

  /* ---------- "I found an invoice" ---------- */
  function showToast(list) {
    if (S.toast || S.open || !list.length) return;
    const { item, doc, key } = list[0];
    const total = doc.total || doc.rows.reduce((n, r) => n + (r.amount || r.qty * r.price || 0), 0);
    const more = list.length - 1;
    const close = () => { if (S.toast) { S.toast.remove(); S.toast = null; } };
    S.toast = themed(h("div", { class: "mdi-toast", role: "status" },
      h("b", null, h("span", { class: "mdi-ic" }, "🧾"), "Invoice found", doc.byAI ? h("span", { class: "mdi-tag" }, "read by AI") : null),
      h("p", null, `${doc.supplier || item.from}${doc.reference ? " · " + doc.reference : ""} — ${doc.rows.length} line${doc.rows.length === 1 ? "" : "s"}, ${money(total)}. Log it to Auctions?`
        + (more ? ` (${more} more waiting)` : "")),
      h("div", { class: "mdi-row" },
        h("button", { class: "mdi-pri", onclick: () => { close(); open(item.id, doc.sha); } }, "Review & log"),
        h("button", { class: "mdi-sec", onclick: () => { S.asked.add(key); close(); } }, "Later"),
        h("button", { class: "mdi-sec", title: "Don't ask about this invoice again", onclick: () => { dismiss(key); close(); } }, "Don't ask"))));
    document.body.appendChild(S.toast);
  }
  async function check() {
    if (!ctx() || S.open) return;
    const feed = await loadFeed();
    if (!feed) return;
    showToast(pending(feed).filter((x) => !S.asked.has(x.key)));
  }

  /* ---------- review & log ---------- */
  async function open(itemId, sha) {
    const feed = await loadFeed();
    const item = feed && (feed.items || []).find((x) => x.id === itemId);
    if (!item) { toastMsg("That email isn't in the Automation list any more."); return; }
    const docs = invoicesIn(item);
    if (!docs.length) { toastMsg("No invoice lines were read from that email."); return; }
    const c = ctx();
    S.open = {
      item, docs, at: Math.max(0, docs.findIndex((d) => d.sha === sha)),
      status: "won",
      edits: docs.map((d) => ({
        supplier: d.supplier || "", date: d.date || item.date || (c && c.today) || "",
        reference: d.reference || "", auction: d.auction || "",
        rows: d.rows.map((r) => ({ on: true, oem: r.oem || "", model: r.model || "", size: r.size || "—", grade: r.grade || "",
          carrier: r.carrier || "", qty: r.qty || 1, price: r.price || 0, amount: r.amount, raw: r.raw || "",
          issues: r.issues || [], confidence: r.confidence == null ? 1 : r.confidence })),
      })),
    };
    if (S.toast) { S.toast.remove(); S.toast = null; }
    draw();
  }
  function close() { if (S.el.back) S.el.back.remove(); S.el.back = null; S.open = null; }

  function draw() {
    const O = S.open; if (!O) return;
    const doc = O.docs[O.at], E = O.edits[O.at];
    const c = ctx();
    const cat = (c && c.state && c.state.catalog) || { suppliers: [], oems: [] };
    const suppliers = [...new Set([...(cat.suppliers || []).map((s) => s.name), ...((c && c.state && c.state.entries) || []).map((e) => e.supplier)].filter(Boolean))];
    const makes = [...new Set([...(cat.oems || []).map((o) => o.name), "Apple", "Samsung", "Google", "Motorola", "OnePlus", "LG", "TCL"])];

    const on = E.rows.filter((r) => r.on);
    const qty = on.reduce((n, r) => n + (+r.qty || 0), 0);
    const lines = on.reduce((n, r) => n + (+r.qty || 0) * (+r.price || 0), 0);
    const allLines = E.rows.reduce((n, r) => n + (+r.qty || 0) * (+r.price || 0), 0);
    const fees = (doc.fees || []).reduce((n, f) => n + (f.amount || 0), 0);
    const total = doc.total;
    const match = total ? Math.abs(allLines + fees - total) <= 1 : null;
    const flagged = E.rows.filter((r) => r.on && (r.confidence < 0.8 || !r.model || !r.price)).length;

    const bind = (r, k, num) => (e) => { r[k] = num ? Number(e.target.value) : e.target.value; if (num || k === "on") drawSoon(); };
    const meta = (label, key, extra) => h("div", null, h("label", null, label),
      h("input", { class: "mdi-in", value: E[key], ...(extra || {}), oninput: (e) => { E[key] = e.target.value; } }));

    const dl = (id, list) => h("datalist", { id }, list.map((x) => h("option", { value: x })));
    const table = h("table", null,
      h("thead", null, h("tr", null, ["", "Make", "Model", "Size", "Grade", "Qty", "Unit price", "Line total", ""].map((x, i) =>
        h("th", { class: i >= 5 && i <= 7 ? "mdi-num" : "" }, i === 0 ? h("input", { type: "checkbox", class: "mdi-ck", title: "All / none",
          checked: E.rows.every((r) => r.on), onchange: (e) => { E.rows.forEach((r) => (r.on = e.target.checked)); draw(); } }) : x)))),
      h("tbody", null, E.rows.map((r) => {
        const flag = r.on && (r.confidence < 0.8 || !r.model || !r.price);
        return h("tr", { class: (r.on ? "" : "off ") + (flag ? "flag" : "") },
          h("td", null, h("input", { type: "checkbox", class: "mdi-ck", checked: r.on, onchange: (e) => { r.on = e.target.checked; draw(); } })),
          h("td", { style: "width:120px" }, h("input", { class: "mdi-in", value: r.oem, list: "mdi-makes", oninput: bind(r, "oem") })),
          h("td", null, h("input", { class: "mdi-in", value: r.model, oninput: bind(r, "model") }),
            r.raw ? h("div", { class: "raw", title: r.raw }, r.raw) : null,
            r.issues.length ? h("div", { class: "iss" }, "⚠ " + r.issues.join(" · ")) : null),
          h("td", { style: "width:84px" }, h("input", { class: "mdi-in", value: r.size, oninput: bind(r, "size") })),
          h("td", { style: "width:70px" }, h("input", { class: "mdi-in", value: r.grade, oninput: bind(r, "grade") })),
          h("td", { style: "width:64px" }, h("input", { class: "mdi-in mdi-num", type: "number", min: "1", value: r.qty, oninput: bind(r, "qty", true) })),
          h("td", { style: "width:100px" }, h("input", { class: "mdi-in mdi-num", type: "number", step: "0.01", value: r.price, oninput: bind(r, "price", true) })),
          h("td", { class: "mdi-num", style: "width:96px;padding-top:10px" }, money((+r.qty || 0) * (+r.price || 0))),
          h("td", { style: "width:20px;padding-top:9px;color:var(--faint)", title: r.carrier ? "Carrier: " + r.carrier : "" }, r.carrier ? "📶" : ""));
      })));

    const logged = doc.logged;
    const modal = themed(h("div", { class: "mdi-modal", role: "dialog", "aria-label": "Review invoice" },
      h("div", { class: "mdi-head" },
        h("div", null,
          h("h3", null, `Invoice from ${E.supplier || doc.supplier || "unknown supplier"}`, h("span", { class: "mdi-tag" }, doc.byAI ? "read by AI" : "read by MYDAY")),
          h("small", null, `${doc.filename} · from ${O.item.from}`)),
        h("button", { class: "mdi-x", title: "Close", onclick: close }, "✕")),
      O.docs.length > 1 ? h("div", { class: "mdi-tabs" }, O.docs.map((d, i) =>
        h("button", { class: i === O.at ? "on" : "", onclick: () => { O.at = i; draw(); } }, `${d.filename} (${d.rows.length})${d.logged ? " ✓" : ""}`))) : null,
      logged ? h("div", { class: "mdi-warn" }, `Already logged ${logged.count} lines to Auctions on ${new Date(logged.at).toLocaleDateString()}. Logging again would add them twice.`) : null,
      (doc.issues || []).length ? h("div", { class: "mdi-warn" }, "⚠ " + doc.issues.join(" · ")) : null,
      h("div", { class: "mdi-meta" },
        meta("Supplier", "supplier", { list: "mdi-sups" }),
        meta("Invoice date", "date", { type: "date" }),
        meta("Invoice no.", "reference"),
        meta("Auction / lot", "auction"),
        h("div", null, h("label", null, "Status for these"),
          h("select", { class: "mdi-in", onchange: (e) => { O.status = e.target.value; } },
            [["won", "Won / bought"], ["pending", "Pending"], ["lost", "Lost"]].map(([v, l]) => h("option", { value: v, selected: O.status === v ? true : null }, l))))),
      h("div", { class: "mdi-sum" },
        h("span", null, h("b", null, on.length), ` of ${E.rows.length} lines`),
        h("span", null, h("b", null, qty), " devices"),
        h("span", null, "Lines ", h("b", null, money(lines))),
        fees ? h("span", { title: (doc.fees || []).map((f) => `${f.label} ${money(f.amount)}`).join(", ") }, "Fees ", h("b", null, money(fees))) : null,
        total ? h("span", null, "Invoice total ", h("b", null, money(total))) : null,
        match === true ? h("span", { class: "mdi-ok" }, "✓ adds up") : match === false ? h("span", { class: "mdi-bad" }, `⚠ off by ${money(allLines + fees - total)}`) : null,
        flagged ? h("span", { class: "mdi-bad" }, `⚠ ${flagged} to check`) : null),
      h("div", { class: "mdi-tbl" }, table, dl("mdi-makes", makes), dl("mdi-sups", suppliers)),
      h("div", { class: "mdi-foot" },
        h("span", { class: "mdi-note" }, "Edit anything that's wrong, untick what you don't want. Highlighted lines need a look."),
        h("button", { class: "mdi-sec", onclick: () => { dismiss(O.item.id + ":" + doc.sha); close(); try { window.__mydayFeedRefresh && window.__mydayFeedRefresh(); } catch (e) {} } }, "Don't log this"),
        h("button", { class: "mdi-pri", disabled: on.length ? null : true, onclick: logIt },
          on.length ? `${logged ? "Log again anyway" : "Log"} ${on.length} line${on.length === 1 ? "" : "s"} to Auctions` : "Nothing ticked"))));

    if (!S.el.back) {
      S.el.back = h("div", { class: "mdi-back", onclick: (e) => { if (e.target === S.el.back) close(); } });
      document.body.appendChild(S.el.back);
    }
    S.el.back.replaceChildren(modal);
  }
  let drawTimer = null;
  function drawSoon() {
    clearTimeout(drawTimer);
    drawTimer = setTimeout(() => {
      const a = document.activeElement, id = a && a.closest && a.closest("td") ? [...document.querySelectorAll(".mdi td .mdi-in")].indexOf(a) : -1;
      const pos = a && a.selectionStart;
      draw();
      if (id >= 0) { const b = document.querySelectorAll(".mdi td .mdi-in")[id]; if (b) { b.focus(); try { b.setSelectionRange(pos, pos); } catch (e) {} } }
    }, 450);
  }

  async function logIt() {
    const O = S.open, c = ctx(); if (!O || !c) return;
    const doc = O.docs[O.at], E = O.edits[O.at];
    const rows = E.rows.filter((r) => r.on && r.model && r.price);
    if (!rows.length) return;
    const supplier = E.supplier.trim() || doc.supplier || "";
    const date = /^\d{4}-\d{2}-\d{2}$/.test(E.date) ? E.date : c.today;
    const ref = [E.reference && "Invoice " + E.reference, E.auction && "Auction " + E.auction].filter(Boolean).join(" · ");

    rows.forEach((r) => c.addEntry({
      id: rid(), date, supplier, oem: r.oem.trim(), model: r.model.trim(), size: r.size.trim() || "—",
      grade: r.grade.trim().toUpperCase() || "—", price: Math.round((+r.price || 0) * 100) / 100,
      qty: Math.max(1, Math.round(+r.qty || 1)), status: O.status, premium: null, tax: null, shipEach: null,
      notes: [r.carrier, ref, doc.filename].filter(Boolean).join(" · "), createdAt: Date.now(),
      source: { kind: "invoice", mailId: O.item.id, sha: doc.sha, byAI: !!doc.byAI },
    }));

    // Teach the catalog any new supplier grades and models, as an import does.
    c.setCatalog((cat) => {
      const sups = (cat.suppliers || []).map((s) => ({ ...s, grades: [...(s.grades || [])] }));
      const oems = (cat.oems || []).map((o) => ({ ...o, models: (o.models || []).map((m) => ({ ...m, sizes: [...(m.sizes || [])] })) }));
      if (supplier) {
        let s = sups.find((x) => x.name.toLowerCase() === supplier.toLowerCase());
        if (!s) { s = { id: rid(), name: supplier, grades: [] }; sups.push(s); }
        rows.forEach((r) => { const g = r.grade.trim().toUpperCase(); if (g && !s.grades.some((x) => x.toLowerCase() === g.toLowerCase())) s.grades.push(g); });
      }
      rows.forEach((r) => {
        if (!r.oem.trim() || !r.model.trim()) return;
        let o = oems.find((x) => x.name.toLowerCase() === r.oem.trim().toLowerCase());
        if (!o) { o = { id: rid(), name: r.oem.trim(), models: [] }; oems.push(o); }
        let m = o.models.find((x) => x.name.toLowerCase() === r.model.trim().toLowerCase());
        if (!m) { m = { id: rid(), name: r.model.trim(), sizes: [] }; o.models.push(m); }
        const sz = r.size.trim(); if (sz && sz !== "—" && m.sizes.indexOf(sz) < 0) m.sizes.push(sz);
      });
      return { suppliers: sups, oems };
    });

    try {
      await fetch("/api/automation/logged", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: O.item.id, sha: doc.sha, count: rows.length }) });
    } catch (e) {}
    close();
    try { window.__mydayFeedRefresh && window.__mydayFeedRefresh(); } catch (e) {}
    toastMsg(`Logged ${rows.length} line${rows.length === 1 ? "" : "s"} to Auctions.`, "Open Auctions", () => { try { c.setView("auctions"); } catch (e) {} });
    setTimeout(check, 1500);
  }

  function toastMsg(text, action, fn) {
    const el = themed(h("div", { class: "mdi-toast" }, h("p", { style: "margin:0 0 " + (action ? "10px" : "0") + ";color:var(--ink)" }, text),
      action ? h("div", { class: "mdi-row" }, h("button", { class: "mdi-pri", onclick: () => { el.remove(); fn(); } }, action)) : null));
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 6000);
  }

  function boot() {
    const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    setTimeout(check, 4000);
    setInterval(check, 45000);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.open) close(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  /* Used by the Automation screen's buttons. Each returns a line to show. */
  async function post(url, body) {
    try {
      const r = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
      const j = await r.json().catch(() => ({}));
      return { ok: r.ok, j };
    } catch (e) { return { ok: false, j: { error: "Couldn't reach the server" } }; }
  }
  async function reread(ids) {
    const { ok, j } = await post("/api/automation/reread", ids ? { ids } : {});
    setTimeout(check, 800);
    if (!ok) return j.error || "Couldn't read them again";
    return j.read ? `Read ${j.read} again${j.left ? `, ${j.left} more next time` : ""}` + (j.problems && j.problems.length ? ` — ${j.problems[0].error}` : "") : "Nothing waiting to read again";
  }
  async function lookback(days) {
    const { ok, j } = await post("/api/automation/lookback", { days });
    setTimeout(check, 800);
    if (!ok) return j.error || "Couldn't look back";
    return j.added ? `Found ${j.added} more from the last ${days} days` : `Nothing new in the last ${days} days`;
  }

  window.MYDAYInvoice = { open, check, reread, lookback };
})();
