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
  .mdi-new{margin:10px 18px 0;padding:11px 13px;border-radius:12px;background:rgba(var(--a-rgb),.08);border:1px dashed rgba(var(--a-rgb),.5);font-size:12.5px}
  .mdi-new .mdi-row{align-items:center}
  .mdi select.mdi-in{padding:5px 6px}
  .mdi-addg{display:flex;align-items:center;gap:6px;padding:9px 18px 0;font-size:12.5px;color:var(--muted);cursor:pointer}
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

  /* ---------- matching to YOUR suppliers and grades ----------
   * Suppliers in Auctions → Setup are named like "T-Mobile Via ONM". An
   * invoice is matched to one by, in order: a match you confirmed before
   * (by the invoice's supplier name or the sender's domain); the part after
   * "Via" (ONM, MNVP, B-Stock) appearing in the sender, invoice or file
   * name; a few known aliases (Mannapov is MNVP); the full name.
   * Each line's grade is then turned into one of that supplier's grades. */
  const norm = (s) => String(s || "").toLowerCase().replace(/\bplus\b/g, "+").replace(/[^a-z0-9+]/g, "");
  const ALIASES = [["mannapov", "mnvp"], ["bstock", "bstock"], ["onlinemobile", "onm"]];
  const channelOf = (name) => { const p = String(name || "").split(/\s+via\s+/i); return p.length > 1 ? norm(p[1]) : ""; };
  const domainOf = (from) => ((String(from || "").match(/@([^>\s]+)/) || [])[1] || "").toLowerCase();
  const learnedMap = () => { const c = ctx(); return (c && c.state && c.state.prefs && c.state.prefs.invoiceMap) || { suppliers: {}, grades: {} }; };

  function matchSupplier(doc, item) {
    const c = ctx();
    const sups = (c && c.state && c.state.catalog && c.state.catalog.suppliers) || [];
    const L = learnedMap().suppliers || {};
    const dom = domainOf(item.from);
    for (const k of [norm(doc.supplier), dom && "@" + dom]) {
      if (k && L[k] && sups.some((s) => s.name === L[k])) return { name: L[k], how: "you matched this sender before" };
    }
    const hay = norm([doc.supplier, item.from, doc.filename, item.subject].join(" "));
    let hay2 = hay;
    for (const [w, ch] of ALIASES) if (hay.includes(w)) hay2 += "|" + ch;
    for (const s of sups) {
      const ch = channelOf(s.name);
      if (ch.length >= 3 && hay2.includes(ch)) return { name: s.name, how: `"${s.name.split(/\s+via\s+/i)[1]}" appears in the sender or invoice` };
    }
    for (const s of sups) if (norm(s.name).length >= 4 && hay.includes(norm(s.name))) return { name: s.name, how: "same name as on the invoice" };
    return null;
  }

  function prefixOf(grades) {
    const groups = {};
    for (const g of grades.map(norm)) { if (g.length >= 3) (groups[g.slice(0, 2)] = groups[g.slice(0, 2)] || []).push(g); }
    let best = "";
    for (const list of Object.values(groups)) {
      if (list.length < 2) continue;
      let p = list[0];
      for (const g of list) while (!g.startsWith(p)) p = p.slice(0, -1);
      if (p.length > best.length) best = p;
    }
    return best;
  }
  const SAME_GRADE = [["sealed", "newsealed", "brandnew", "nib", "factorysealed"], ["new", "brandnew"], ["cpo", "certifiedpreowned"]];
  /* The supplier's grade written in the printed line itself, e.g.
     "APPLE IPHONE 13 256 MIDNIGHT — DNC MLAH3LL/A". Only if exactly one of
     their grades appears — two different ones means ask, never guess. */
  function gradeInLine(line, sup) {
    const text = String(line || "");
    if (!text || !sup) return "";
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const found = new Set();
    for (const g of sup.grades.slice().sort((a, b) => b.length - a.length)) {
      // Short grades (A, B+, C) only right after "grade"/"cond"; longer codes
      // (DNB, AA+, T-Mobile A) anywhere as their own word. Never glued to a
      // "/" — Apple part numbers end in "LL/A".
      const re = g.length <= 2
        ? new RegExp(`\\b(grade|grd|cond(ition)?)\\s*[:#-]?\\s*${esc(g)}(?![A-Za-z0-9+])`, "i")
        : new RegExp(`(^|[\\s,;:|()\\[\\]—–-])${esc(g)}(?![A-Za-z0-9+/])`, "i");
      if (re.test(text) && ![...found].some((f) => f.toLowerCase().includes(g.toLowerCase()))) found.add(g);
    }
    return found.size === 1 ? [...found][0] : "";
  }
  function mapGrade(raw, sup, line) {
    const r = String(raw || "").trim();
    if (!sup || !(sup.grades || []).length) return { grade: r.toUpperCase(), ok: !!r, how: "" };
    const inLine = gradeInLine(line, sup);
    const viaRaw = mapGradeRaw(r, sup);
    // The printed line wins when it plainly names one of their grades.
    if (inLine && (!viaRaw.ok || viaRaw.grade !== inLine)) return { grade: inLine, ok: true, how: `found "${inLine}" in the invoice line` };
    return viaRaw;
  }
  function mapGradeRaw(raw, sup) {
    const r = String(raw || "").trim();
    const G = sup.grades;
    const learned = (learnedMap().grades || {})[sup.name] || {};
    const nr = norm(r.replace(/\b(grade|condition|cond)\b/gi, ""));
    if (learned[nr] && G.includes(learned[nr])) return { grade: learned[nr], ok: true, how: "as you set before" };
    if (!nr) return { grade: "", ok: false, how: "no grade on the invoice" };
    let g = G.find((x) => norm(x) === nr);
    if (g) return { grade: g, ok: true, how: g === r ? "" : `"${r}" is ${g}` };
    const p = prefixOf(G);
    if (p) { g = G.find((x) => norm(x) === p + nr); if (g) return { grade: g, ok: true, how: `"${r}" is ${g}` }; }
    for (const set of SAME_GRADE) if (set.includes(nr)) { g = G.find((x) => set.includes(norm(x))); if (g) return { grade: g, ok: true, how: `"${r}" is ${g}` }; }
    return { grade: "", ok: false, how: `"${r}" isn't one of ${sup.name}'s grades — pick one` };
  }

  /* ---------- "I found an invoice" ---------- */
  async function list() {
    try {
      const r = await fetch("/api/automation/invoices", { credentials: "same-origin" });
      return r.ok ? await r.json() : null;
    } catch (e) { return null; }
  }
  function showToast(waiting) {
    if (S.toast || S.open || !waiting.length) return;
    const inv = waiting[0], key = inv.mailId + ":" + inv.sha, more = waiting.length - 1;
    const close = () => { if (S.toast) { S.toast.remove(); S.toast = null; } };
    S.toast = themed(h("div", { class: "mdi-toast", role: "status" },
      h("b", null, h("span", { class: "mdi-ic" }, "🧾"), "Invoice captured", inv.byAI ? h("span", { class: "mdi-tag" }, "read by AI") : null),
      h("p", null, `${inv.supplier || inv.from}${inv.reference ? " · " + inv.reference : ""} — ${inv.qty} devices, ${money(inv.total)}. Add it to the Auction table?`
        + (more ? ` (${more} more waiting)` : "")),
      h("div", { class: "mdi-row" },
        h("button", { class: "mdi-pri", onclick: () => { close(); open(inv.mailId, inv.sha); } }, "View invoice"),
        h("button", { class: "mdi-sec", onclick: () => { S.asked.add(key); close(); } }, "Later"))));
    document.body.appendChild(S.toast);
  }
  async function check() {
    if (!ctx() || S.open) return;
    const d = await list();
    if (!d) return;
    try { window.dispatchEvent(new CustomEvent("myday-invoices", { detail: d })); } catch (e) {}
    showToast(d.invoices.filter((x) => x.status === "review" && !S.asked.has(x.mailId + ":" + x.sha)));
  }

  /* ---------- view invoice → add to the Auction table ---------- */
  async function open(itemId, sha) {
    let d = null;
    try {
      const r = await fetch(`/api/automation/invoice?id=${encodeURIComponent(itemId)}&sha=${encodeURIComponent(sha || "")}`, { credentials: "same-origin" });
      d = await r.json();
      if (!r.ok) { toastMsg(d.error || "Couldn't open that invoice."); return; }
    } catch (e) { toastMsg("Couldn't reach the server."); return; }
    if (!sha) {   // older callers pass only the email: take its first invoice
      const all = await list();
      const first = all && all.invoices.find((x) => x.mailId === itemId);
      if (first && first.sha !== d.doc.sha) return open(itemId, first.sha);
    }
    const c = ctx(), { item, doc } = d;
    if (d.alreadyAdded && !doc.logged) doc.logged = { ...d.alreadyAdded, twin: true };
    const m = matchSupplier(doc, item);
    S.open = {
      item, doc, status: "won", supplier: m ? m.name : "", matchHow: m ? m.how : "", newName: doc.supplier || "",
      date: doc.date || item.date || (c && c.today) || "", reference: doc.reference || "", auction: doc.auction || "",
      rows: doc.rows.map((r) => ({ on: true, raw: r.raw || "", rawGrade: r.grade || "", oem: r.oem || "", model: r.model || "", size: r.size || "—",
        carrier: r.carrier || "", qty: r.qty || 1, price: r.price || 0, issues: (r.issues || []).filter((x) => !/grade/.test(x)),
        confidence: r.confidence == null ? 1 : r.confidence, grade: "", gradeOk: false, gradeHow: "" })),
    };
    regrade();
    if (S.toast) { S.toast.remove(); S.toast = null; }
    draw();
  }
  const supObj = () => { const c = ctx(), O = S.open; return O && O.supplier ? ((c.state.catalog.suppliers || []).find((s) => s.name === O.supplier) || null) : null; };
  function regrade() {
    const sup = supObj();
    for (const r of S.open.rows) { if (r.manual) continue; const g = mapGrade(r.rawGrade, sup, r.raw); r.grade = g.grade; r.gradeOk = g.ok; r.gradeHow = g.how; }
  }
  function close() { if (S.el.back) S.el.back.remove(); S.el.back = null; S.open = null; }

  function addSupplier(name) {
    const c = ctx(), O = S.open; if (!c || !name.trim()) return;
    const grades = [...new Set(O.rows.map((r) => String(r.rawGrade || r.grade || "").trim().toUpperCase()).filter(Boolean))];
    c.setCatalog((cat) => {
      const sups = (cat.suppliers || []).slice();
      if (!sups.some((s) => s.name.toLowerCase() === name.trim().toLowerCase())) sups.push({ id: rid(), name: name.trim(), grades: grades.length ? grades : ["A", "B", "C"] });
      return { ...cat, suppliers: sups };
    });
    setTimeout(() => { O.supplier = name.trim(); O.matchHow = "added just now"; regrade(); draw(); }, 50);
  }

  function draw() {
    const O = S.open; if (!O) return;
    const c = ctx(), doc = O.doc;
    const cat = (c && c.state && c.state.catalog) || { suppliers: [], oems: [] };
    const sups = cat.suppliers || [];
    const sup = supObj();
    const makes = [...new Set([...(cat.oems || []).map((o) => o.name), "Apple", "Samsung", "Google", "Motorola", "OnePlus", "LG", "TCL"])];

    const on = O.rows.filter((r) => r.on);
    const qty = on.reduce((n, r) => n + (+r.qty || 0), 0);
    const lines = on.reduce((n, r) => n + (+r.qty || 0) * (+r.price || 0), 0);
    const allLines = O.rows.reduce((n, r) => n + (+r.qty || 0) * (+r.price || 0), 0);
    const fees = (doc.fees || []).reduce((n, f) => n + (f.amount || 0), 0);
    const total = doc.total;
    const match = total ? Math.abs(allLines + fees - total) <= 1 : null;
    const needGrade = on.filter((r) => sup && !r.grade).length;
    const flagged = on.filter((r) => r.confidence < 0.8 || !r.model || !r.price || (sup && !r.grade)).length;
    const bind = (r, k, num) => (e) => { r[k] = num ? Number(e.target.value) : e.target.value; if (num) drawSoon(); };
    const dl = (id, l) => h("datalist", { id }, l.map((x) => h("option", { value: x })));

    const gradeCell = (r) => {
      if (sup && (sup.grades || []).length) {
        const fromInvoice = r.rawGrade && r.rawGrade !== r.grade ? h("div", { class: "raw" }, "invoice: " + r.rawGrade) : null;
        if (r.manual) {
          const isNew = r.grade && !sup.grades.some((g) => g.toLowerCase() === r.grade.trim().toLowerCase());
          return h("div", null,
            h("div", { style: "display:flex;gap:4px" },
              h("input", { class: "mdi-in", value: r.grade, placeholder: "Type grade", "data-grade": "1",
                oninput: (e) => { r.grade = e.target.value; r.gradeOk = !!r.grade.trim(); r.gradeHow = r.gradeOk ? "you typed it" : ""; drawSoon(); } }),
              h("button", { class: "mdi-sec", style: "padding:4px 7px", title: "Back to the list", onclick: () => { r.manual = false; r.grade = ""; r.gradeOk = false; regrade(); draw(); } }, "↩")),
            isNew ? h("div", { class: "raw", style: "color:#C9A227" }, "new grade for " + sup.name) : null, fromInvoice);
        }
        return h("div", null,
          h("select", { class: "mdi-in", onchange: (e) => {
            if (e.target.value === "__type__") { r.manual = true; r.grade = r.rawGrade || ""; r.gradeOk = !!r.grade; r.gradeHow = r.grade ? "you typed it" : ""; draw();
              setTimeout(() => { const i = [...document.querySelectorAll('.mdi [data-grade]')].find((x) => x.value === r.grade); if (i) i.focus(); }, 30); return; }
            r.grade = e.target.value; r.gradeOk = !!r.grade; r.gradeHow = r.grade ? "you picked" : ""; draw(); } },
            h("option", { value: "" }, "— pick —"), sup.grades.map((g) => h("option", { value: g, selected: r.grade === g ? true : null }, g)),
            h("option", { value: "__type__" }, "✎ Type a grade…")),
          fromInvoice);
      }
      return h("input", { class: "mdi-in", value: r.grade || r.rawGrade, oninput: (e) => { r.grade = e.target.value; r.rawGrade = e.target.value; } });
    };

    const table = h("table", null,
      h("thead", null, h("tr", null, ["", "Make", "Model", "Size", sup ? `Grade (${sup.name})` : "Grade", "Qty", "Unit price", "Line total"].map((x, i) =>
        h("th", { class: i >= 5 ? "mdi-num" : "" }, i === 0 ? h("input", { type: "checkbox", class: "mdi-ck", title: "All / none",
          checked: O.rows.every((r) => r.on), onchange: (e) => { O.rows.forEach((r) => (r.on = e.target.checked)); draw(); } }) : x)))),
      h("tbody", null, O.rows.map((r) => {
        const bad = r.on && (r.confidence < 0.8 || !r.model || !r.price || (sup && !r.grade));
        const notes = [...r.issues, sup && !r.grade ? r.gradeHow || "pick a grade" : null].filter(Boolean);
        return h("tr", { class: (r.on ? "" : "off ") + (bad ? "flag" : "") },
          h("td", null, h("input", { type: "checkbox", class: "mdi-ck", checked: r.on, onchange: (e) => { r.on = e.target.checked; draw(); } })),
          h("td", { style: "width:115px" }, h("input", { class: "mdi-in", value: r.oem, list: "mdi-makes", oninput: bind(r, "oem") })),
          h("td", null, h("input", { class: "mdi-in", value: r.model, oninput: bind(r, "model") }),
            r.raw ? h("div", { class: "raw", title: r.raw }, r.raw) : null,
            notes.length ? h("div", { class: "iss" }, "⚠ " + notes.join(" · ")) : r.gradeHow && r.gradeOk ? h("div", { class: "raw", style: "color:var(--a)" }, "✓ " + r.gradeHow) : null),
          h("td", { style: "width:82px" }, h("input", { class: "mdi-in", value: r.size, oninput: bind(r, "size") })),
          h("td", { style: "width:140px" }, gradeCell(r)),
          h("td", { style: "width:62px" }, h("input", { class: "mdi-in mdi-num", type: "number", min: "1", value: r.qty, oninput: bind(r, "qty", true) })),
          h("td", { style: "width:96px" }, h("input", { class: "mdi-in mdi-num", type: "number", step: "0.01", value: r.price, oninput: bind(r, "price", true) })),
          h("td", { class: "mdi-num", style: "width:96px;padding-top:10px" }, money((+r.qty || 0) * (+r.price || 0))));
      })));

    const supplierBox = h("div", null, h("label", null, "Supplier (from your setup)"),
      h("select", { class: "mdi-in", onchange: (e) => { O.supplier = e.target.value; O.matchHow = O.supplier ? "you picked" : ""; regrade(); draw(); } },
        h("option", { value: "" }, sups.length ? "— not in your setup —" : "— no suppliers set up yet —"),
        sups.map((s) => h("option", { value: s.name, selected: O.supplier === s.name ? true : null }, s.name))),
      O.supplier && O.matchHow ? h("div", { class: "raw", style: "color:var(--a);margin-top:3px" }, "✓ " + O.matchHow) : null);

    const logged = doc.logged;
    const modal = themed(h("div", { class: "mdi-modal", role: "dialog", "aria-label": "Invoice" },
      h("div", { class: "mdi-head" },
        h("div", null,
          h("h3", null, `Invoice ${O.reference || ""}`.trim(), h("span", { class: "mdi-tag" }, doc.byAI ? "read by AI" : "read by MYDAY")),
          h("small", null, `From ${O.item.from} · ${O.item.date || ""} · ${doc.filename}`)),
        h("button", { class: "mdi-x", title: "Close", onclick: close }, "✕")),
      logged ? h("div", { class: "mdi-warn" }, `Invoice ${O.reference || ""} is already in the Auction table — ${logged.count} lines added on ${new Date(logged.at).toLocaleDateString()}${logged.twin ? ` from another copy (${logged.from})` : ""}. Adding again would duplicate them.`) : null,
      !O.supplier ? h("div", { class: "mdi-new" },
        h("div", null, h("b", null, "New supplier? "), `"${O.newName || "This sender"}" isn't in your Suppliers setup. Pick one above, or add it:`),
        h("div", { class: "mdi-row", style: "margin-top:7px" },
          h("input", { class: "mdi-in", style: "max-width:280px", value: O.newName, placeholder: "e.g. Sprint Via NewCo", oninput: (e) => { O.newName = e.target.value; } }),
          h("button", { class: "mdi-pri", onclick: () => addSupplier(O.newName) }, "+ Add as new supplier"),
          h("span", { class: "raw" }, "Its grades will be the ones on this invoice; you can edit them in Setup."))) : null,
      (doc.issues || []).length ? h("div", { class: "mdi-warn" }, "⚠ " + doc.issues.join(" · ")) : null,
      h("div", { class: "mdi-meta" },
        supplierBox,
        h("div", null, h("label", null, "Invoice date"), h("input", { class: "mdi-in", type: "date", value: O.date, oninput: (e) => { O.date = e.target.value; } })),
        h("div", null, h("label", null, "Invoice no."), h("input", { class: "mdi-in", value: O.reference, oninput: (e) => { O.reference = e.target.value; } })),
        h("div", null, h("label", null, "Auction / lot"), h("input", { class: "mdi-in", value: O.auction, oninput: (e) => { O.auction = e.target.value; } })),
        h("div", null, h("label", null, "Status for these"),
          h("select", { class: "mdi-in", onchange: (e) => { O.status = e.target.value; } },
            [["won", "Won / bought"], ["pending", "Pending"], ["lost", "Lost"]].map(([v, l]) => h("option", { value: v, selected: O.status === v ? true : null }, l))))),
      h("div", { class: "mdi-sum" },
        h("span", null, h("b", null, on.length), ` of ${O.rows.length} lines`),
        h("span", null, h("b", null, qty), " devices"),
        h("span", null, "Lines ", h("b", null, money(lines))),
        fees ? h("span", { title: (doc.fees || []).map((f) => `${f.label} ${money(f.amount)}`).join(", ") }, "Fees ", h("b", null, money(fees))) : null,
        total ? h("span", null, "Invoice total ", h("b", null, money(total))) : null,
        match === true ? h("span", { class: "mdi-ok" }, "✓ adds up") : match === false ? h("span", { class: "mdi-bad" }, `⚠ off by ${money(allLines + fees - total)}`) : null,
        needGrade ? h("span", { class: "mdi-bad" }, `⚠ ${needGrade} need a grade`) : flagged ? h("span", { class: "mdi-bad" }, `⚠ ${flagged} to check`) : null),
      h("div", { class: "mdi-tbl" }, table, dl("mdi-makes", makes)),
      sup && newGrades(sup).length ? h("label", { class: "mdi-addg" },
        h("input", { type: "checkbox", class: "mdi-ck", checked: O.addGrades !== false, onchange: (e) => { O.addGrades = e.target.checked; } }),
        ` Also add ${newGrades(sup).map((g) => `"${g}"`).join(", ")} to ${sup.name}'s grades in Setup`) : null,
      h("div", { class: "mdi-foot" },
        h("span", { class: "mdi-note" }, !O.supplier ? "Choose or add the supplier first." : needGrade ? "Pick a grade for the highlighted lines." : "Everything's filled in from the invoice — check and add."),
        h("button", { class: "mdi-sec", onclick: async () => { await setStatus(O.item.id, doc.sha, "dismissed"); close(); } }, "Don't add this invoice"),
        h("button", { class: "mdi-pri", disabled: !on.length || !O.supplier || needGrade ? true : null, onclick: logIt },
          `${logged ? "Add again anyway" : "Add"} ${on.length} line${on.length === 1 ? "" : "s"} to Auction table`))));

    if (!S.el.back) {
      S.el.back = h("div", { class: "mdi-back", onclick: (e) => { if (e.target === S.el.back) close(); } });
      document.body.appendChild(S.el.back);
    }
    S.el.back.replaceChildren(modal);
  }
  /* Grades typed by hand that the supplier doesn't have yet. */
  function newGrades(sup) {
    const O = S.open; if (!O || !sup) return [];
    const have = new Set((sup.grades || []).map((g) => g.toLowerCase()));
    return [...new Set(O.rows.filter((r) => r.on && r.manual && r.grade.trim()).map((r) => r.grade.trim()))].filter((g) => !have.has(g.toLowerCase()));
  }
  let drawTimer = null;
  function drawSoon() {
    clearTimeout(drawTimer);
    drawTimer = setTimeout(() => {
      const a = document.activeElement, all = () => [...document.querySelectorAll(".mdi td .mdi-in")];
      const id = a && a.closest && a.closest("td") ? all().indexOf(a) : -1, pos = a && a.selectionStart;
      draw();
      if (id >= 0) { const b = all()[id]; if (b) { b.focus(); try { b.setSelectionRange(pos, pos); } catch (e) {} } }
    }, 450);
  }
  async function setStatus(id, sha, status) {
    try { await fetch("/api/automation/invoice-status", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, sha, status }) }); } catch (e) {}
    refreshAll();
  }
  function refreshAll() {
    try { window.__mydayFeedRefresh && window.__mydayFeedRefresh(); } catch (e) {}
    setTimeout(check, 300);
  }

  async function logIt() {
    const O = S.open, c = ctx(); if (!O || !c) return;
    const doc = O.doc;
    const rows = O.rows.filter((r) => r.on && r.model && r.price && (r.grade || r.rawGrade));
    if (!rows.length || !O.supplier) return;
    const supplier = O.supplier;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(O.date) ? O.date : c.today;
    const ref = [O.reference && "Invoice " + O.reference, O.auction && "Auction " + O.auction].filter(Boolean).join(" · ");

    rows.forEach((r) => c.addEntry({
      id: rid(), date, supplier, oem: r.oem.trim(), model: r.model.trim(), size: r.size.trim() || "—",
      grade: (r.grade || r.rawGrade).trim() || "—", price: Math.round((+r.price || 0) * 100) / 100,
      qty: Math.max(1, Math.round(+r.qty || 1)), status: O.status, premium: null, tax: null, shipEach: null,
      notes: [r.carrier, ref, doc.filename].filter(Boolean).join(" · "), createdAt: Date.now(),
      source: { kind: "invoice", mailId: O.item.id, sha: doc.sha, byAI: !!doc.byAI },
    }));

    // Makes, models and sizes go into Setup; typed grades too, if you ticked the box.
    const supNow = supObj();
    const addG = O.addGrades !== false ? newGrades(supNow) : [];
    c.setCatalog((cat) => {
      const suppliers = addG.length ? (cat.suppliers || []).map((s) => s.name === supplier ? { ...s, grades: [...(s.grades || []), ...addG] } : s) : cat.suppliers;
      const oems = (cat.oems || []).map((o) => ({ ...o, models: (o.models || []).map((m) => ({ ...m, sizes: [...(m.sizes || [])] })) }));
      rows.forEach((r) => {
        if (!r.oem.trim() || !r.model.trim()) return;
        let o = oems.find((x) => x.name.toLowerCase() === r.oem.trim().toLowerCase());
        if (!o) { o = { id: rid(), name: r.oem.trim(), models: [] }; oems.push(o); }
        let m = o.models.find((x) => x.name.toLowerCase() === r.model.trim().toLowerCase());
        if (!m) { m = { id: rid(), name: r.model.trim(), sizes: [] }; o.models.push(m); }
        const sz = r.size.trim(); if (sz && sz !== "—" && m.sizes.indexOf(sz) < 0) m.sizes.push(sz);
      });
      return { ...cat, suppliers, oems };
    });

    // Remember this sender → supplier, and these invoice grades → their grades.
    const L = learnedMap();
    const next = { suppliers: { ...(L.suppliers || {}) }, grades: { ...(L.grades || {}) } };
    if (norm(doc.supplier)) next.suppliers[norm(doc.supplier)] = supplier;
    const dom = domainOf(O.item.from); if (dom) next.suppliers["@" + dom] = supplier;
    next.grades[supplier] = { ...(next.grades[supplier] || {}) };
    rows.forEach((r) => { const k = norm(String(r.rawGrade || "").replace(/\b(grade|condition|cond)\b/gi, "")); if (k && r.grade) next.grades[supplier][k] = r.grade; });
    try { c.setPref({ invoiceMap: next }); } catch (e) {}

    try {
      await fetch("/api/automation/logged", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: O.item.id, sha: doc.sha, count: rows.length }) });
    } catch (e) {}
    close();
    refreshAll();
    toastMsg(`Added ${rows.length} line${rows.length === 1 ? "" : "s"} to the Auction table under ${supplier}.`, "Open Auctions", () => { try { c.setView("auctions"); } catch (e) {} });
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

  window.MYDAYInvoice = { open, check, reread, lookback, matchSupplier, mapGrade, list };
})();
