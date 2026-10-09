/* Automation — the new inbox.
 *
 * Shows the server's read-only view (/api/automation/inbox): one row per
 * conversation or invoice number, sorted into
 *   Needs you · Added automatically · Handled quietly · All
 * Nothing here changes stored mail on its own. Only your taps do:
 *   Add (adds the ticked suggestions to My Day), Done, Ignore, Put back.
 * Suggestions held back (e.g. "Pay" on a PAID email) are shown greyed with
 * the reason and can still be ticked. The old screen is one click away.
 */
(function () {
  "use strict";
  const ctx = () => window.__myday || null;
  const S = { host: null, data: null, tab: "needs", open: new Set(), pick: new Set(), on: {}, busy: false, msg: "" };
  const money = (n) => (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const ago = (t) => { if (!t) return ""; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "now" : m < 60 ? m + "m" : m < 1440 ? Math.round(m / 60) + "h" : Math.round(m / 1440) + "d"; };
  const fmtDay = (d) => d ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

  const CSS = `
  .mdx{font:13.5px/1.45 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);padding-bottom:40px}
  .mdx.dark{--card:rgba(24,29,38,.58);--ink:#E9EDF3;--muted:#8C97A8;--faint:#5E6878;--line:rgba(255,255,255,.08);--chip:rgba(255,255,255,.05);--hover:rgba(255,255,255,.035)}
  .mdx.light{--card:rgba(255,255,255,.68);--ink:#141A21;--muted:#5F6B79;--faint:#8D98A6;--line:rgba(20,30,40,.08);--chip:rgba(255,255,255,.75);--hover:rgba(20,30,40,.025)}
  .mdx *{box-sizing:border-box}
  .mdx button{font:inherit;cursor:pointer}
  .mdx-top{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;margin:22px 0 12px}
  .mdx h1{font:600 30px "Iowan Old Style",Palatino,Georgia,serif;letter-spacing:-.02em;margin:0}
  .mdx-status{display:flex;align-items:center;gap:7px;color:var(--muted);font-size:12.5px;margin-top:3px}
  .mdx-status .myday-led{width:8px;height:8px}
  .mdx-act{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap}
  .mdx-btn{border:1px solid var(--line);background:var(--chip);color:var(--muted);border-radius:10px;padding:7px 12px;font-size:12.5px}
  .mdx-btn:hover{color:var(--a);border-color:rgba(var(--a-rgb),.45)}
  .mdx-btn.hot{color:#F2545B;border-color:rgba(242,84,91,.4)}
  .mdx-sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;margin-bottom:12px}
  .mdx-sum>button{text-align:left;border:1px solid var(--line);background:var(--card);border-radius:14px;padding:10px 13px;color:var(--ink);
    -webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px)}
  .mdx-sum>button.on{border-color:var(--a);box-shadow:0 0 0 1px var(--a) inset}
  .mdx-sum small{display:block;color:var(--faint);font-size:11px}.mdx-sum b{font-size:22px;letter-spacing:-.01em}.mdx-sum span{display:block;color:var(--muted);font-size:11.5px}
  .mdx-list{border:1px solid var(--line);background:var(--card);border-radius:16px;overflow:hidden;-webkit-backdrop-filter:blur(20px) saturate(160%);backdrop-filter:blur(20px) saturate(160%)}
  .mdx-row{display:grid;grid-template-columns:22px 1fr auto;gap:10px;padding:11px 14px;border-bottom:1px solid var(--line);align-items:start}
  .mdx-row:last-child{border-bottom:0}
  .mdx-row:hover{background:var(--hover)}
  .mdx-row input[type=checkbox]{width:16px;height:16px;margin-top:3px;accent-color:var(--a)}
  .mdx-main{min-width:0;cursor:pointer}
  .mdx-l1{display:flex;gap:7px;align-items:baseline;min-width:0}
  .mdx-who{font-weight:700;white-space:nowrap;max-width:190px;overflow:hidden;text-overflow:ellipsis}
  .mdx-subj{color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .mdx-n{font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:0 7px;white-space:nowrap}
  .mdx-sug{margin-top:4px;font-size:12.5px;color:var(--muted);display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  .mdx-sug b{color:var(--ink);font-weight:600}
  .mdx-tag{font-size:10.5px;font-weight:700;border-radius:999px;padding:1px 8px;white-space:nowrap}
  .mdx-tag.auto{background:rgba(var(--a-rgb),.14);color:var(--a)}
  .mdx-tag.quiet{background:rgba(140,151,168,.16);color:var(--muted)}
  .mdx-tag.inv{background:rgba(76,141,246,.14);color:#4C8DF6;cursor:pointer}
  .mdx-tag.held{background:rgba(245,197,66,.14);color:#C9A227}
  .mdx-right{display:flex;gap:6px;align-items:center}
  .mdx-when{color:var(--faint);font-size:11.5px;min-width:30px;text-align:right}
  .mdx-go{border:0;border-radius:9px;padding:6px 12px;font-size:12.5px;font-weight:700;color:#fff;background:var(--a)}
  .mdx-q{border:1px solid var(--line);background:transparent;border-radius:9px;padding:5px 10px;font-size:12px;color:var(--muted)}
  .mdx-q:hover{color:var(--ink)}
  .mdx-more{grid-column:2/-1;padding:4px 0 2px;display:grid;gap:8px}
  .mdx-task{display:flex;gap:8px;align-items:flex-start;font-size:12.5px}
  .mdx-task.held{color:var(--faint)}
  .mdx-task small{display:block;color:var(--faint)}
  .mdx-mail{font-size:12px;color:var(--muted);border-left:2px solid var(--line);padding-left:9px}
  .mdx-mail b{color:var(--ink);font-weight:600}
  .mdx-bulk{position:sticky;top:64px;z-index:5;display:flex;gap:8px;align-items:center;padding:8px 12px;margin-bottom:8px;border-radius:12px;
    background:var(--card);border:1px solid rgba(var(--a-rgb),.5);-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px)}
  .mdx-empty{padding:36px;text-align:center;color:var(--muted)}
  .mdx-head{display:flex;align-items:center;gap:12px;padding:0 14px 8px;font-size:12.5px;color:var(--muted)}
  .mdx-head label{display:flex;align-items:center;gap:7px;cursor:pointer}
  .mdx-head input{width:16px;height:16px;accent-color:var(--a)}
  .mdx-head .mdx-count{margin-right:auto;color:var(--faint)}
  .mdx-note{color:var(--faint);font-size:12px;margin:10px 2px}
  @media (max-width:700px){.mdx-who{max-width:110px}.mdx-row{grid-template-columns:22px 1fr}.mdx-right{grid-column:2;justify-content:flex-start}}
  `;
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "checked") el.checked = !!v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.appendChild(typeof kid === "string" || typeof kid === "number" ? document.createTextNode(String(kid)) : kid);
    }
    return el;
  }

  /* ---------- talking to the server ---------- */
  async function load() {
    try {
      const r = await fetch("/api/automation/inbox", { credentials: "same-origin" });
      if (r.ok) S.data = await r.json(); else S.msg = "Couldn't load the inbox";
    } catch (e) { S.msg = "Couldn't reach the server"; }
    draw();
  }
  const post = (url, body) => fetch(url, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) })
    .then((r) => r.json().then((j) => ({ ok: r.ok, j }))).catch(() => ({ ok: false, j: { error: "Couldn't reach the server" } }));
  const decide = (ids, decision) => Promise.all(ids.map((id) => post("/api/automation/decide", { id, decision })));

  /* The ticked suggestions for a row (held ones only if you ticked them). */
  const ticked = (row) => row.tasks.filter((t, i) => (S.on[row.key + ":" + i] != null ? S.on[row.key + ":" + i] : !t.held));
  async function addRow(row) {
    const c = ctx(); if (!c) return 0;
    const feed = await fetch("/api/automation/feed", { credentials: "same-origin" }).then((r) => r.json()).catch(() => null);
    const full = (id, title) => { const it = feed && (feed.items || []).find((x) => x.id === id); return it && (it.tasks || []).find((t) => t.title === title); };
    let n = 0;
    for (const t of ticked(row)) {
      const d = full(t.from, t.title) || t;
      c.addTask({
        id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4),
        title: d.title, space: d.space || "company", category: d.category, date: d.date || c.today, time: d.time || "",
        repeat: "none", repeatDays: null, repeatEvery: 1, repeatUntil: null, priority: d.priority || "normal",
        note: d.note || "", subtasks: (d.subtasks || []).map((z) => ({ ...z, done: false })), projectId: null, done: {}, createdAt: Date.now(),
        fromEmail: true, source: { kind: "gmail", from: row.from, subject: row.subject, at: Date.now(), amount: d.amount || null, reference: d.reference || "" },
      });
      n++;
    }
    await decide(row.ids, "approved");
    // Teach memory which suggestions you take and which you skip.
    const picked = new Set(ticked(row));
    const items = row.tasks.map((t) => ({ from: row.from, subject: row.subject, title: t.title, choice: picked.has(t) ? "added" : "skipped" }));
    if (items.length) post("/api/memory/learn", { kind: "suggestion", items });
    return n;
  }
  async function act(rows, what) {
    S.busy = true; draw();
    let added = 0;
    for (const row of rows) {
      if (what === "add") added += await addRow(row);
      else if (what === "done") await decide(row.ids, "approved");
      else if (what === "ignore") await decide(row.ids, "ignored");
      else if (what === "back") await post("/api/automation/view-override", { ids: row.ids, to: "needs" });
    }
    const c = ctx();
    if (c && c.setToast) c.setToast(what === "add" ? `Added ${added} task${added === 1 ? "" : "s"} to My Day` : what === "ignore" ? `Ignored ${rows.length} in MYDAY (Gmail untouched)` : what === "back" ? "Put back in Needs you" : "Marked done");
    S.pick.clear(); S.busy = false;
    try { window.__mydayFeedRefresh && window.__mydayFeedRefresh(); } catch (e) {}
    await load();
  }

  /* ---------- drawing ---------- */
  function rowView(row) {
    const isOpen = S.open.has(row.key);
    const toggle = () => { isOpen ? S.open.delete(row.key) : S.open.add(row.key); draw(); };
    const ok = ticked(row);
    const first = row.tasks.find((t) => !t.held);
    const held = row.tasks.filter((t) => t.held).length;
    const invs = row.invoices.filter((i) => !i.logged).length;
    const sug = row.bucket === "quiet" ? [h("span", { class: "mdx-tag quiet" }, "quiet"), h("span", null, "Handled quietly — " + row.quiet)]
      : row.bucket === "auto" ? [h("span", { class: "mdx-tag auto" }, "✦ in My Day"), h("b", null, row.auto[0].title)]
      : [first ? h("b", null, "→ " + first.title) : h("span", null, row.invoices.length ? "Invoice to review" : "No suggestion"),
         first && row.tasks.filter((t) => !t.held).length > 1 ? h("span", null, `+${row.tasks.filter((t) => !t.held).length - 1} more`) : null,
         first && first.date ? h("span", null, "· due " + fmtDay(first.date)) : null];
    const right = row.bucket === "quiet"
      ? [h("button", { class: "mdx-q", title: "Show it in Needs you", onclick: () => act([row], "back") }, "Put back")]
      : row.bucket === "auto"
      ? [h("button", { class: "mdx-go", title: "The task is already in My Day — clear this from the list", onclick: () => act([row], "done") }, "Done"),
         h("button", { class: "mdx-q", onclick: () => act([row], "ignore") }, "Ignore")]
      : [ok.length ? h("button", { class: "mdx-go", onclick: () => act([row], "add") }, ok.length > 1 ? `Add ${ok.length}` : "Add") : null,
         h("button", { class: "mdx-q", onclick: () => act([row], "ignore") }, "Ignore")];

    return h("div", { class: "mdx-row" },
      row.bucket === "quiet" ? h("span") : h("input", { type: "checkbox", checked: S.pick.has(row.key), onchange: (e) => { e.target.checked ? S.pick.add(row.key) : S.pick.delete(row.key); draw(); } }),
      h("div", { class: "mdx-main", onclick: (e) => { if (!e.target.closest("button,input,.mdx-tag.inv")) toggle(); } },
        h("div", { class: "mdx-l1" }, h("span", { class: "mdx-who" }, row.who), h("span", { class: "mdx-subj" }, row.subject),
          row.count > 1 ? h("span", { class: "mdx-n", title: "Replies and copies grouped into one row" }, `${row.count} emails`) : null),
        h("div", { class: "mdx-sug" }, sug,
          held ? h("span", { class: "mdx-tag held", title: "Click the row to see why" }, `${held} held back`) : null,
          invs ? h("span", { class: "mdx-tag inv", title: "Open in Captured Invoices", onclick: () => { const i = row.invoices.find((x) => !x.logged); window.MYDAYInvoice && window.MYDAYInvoice.open(i.mailId, i.sha); } }, `🧾 ${invs} invoice${invs === 1 ? "" : "s"}`) : null)),
      h("div", { class: "mdx-right" }, right, h("span", { class: "mdx-when", title: row.date }, ago(row.seenAt))),
      isOpen ? h("div", { class: "mdx-more" },
        row.tasks.map((t, i) => h("label", { class: "mdx-task" + (t.held ? " held" : "") },
          row.bucket === "needs" ? h("input", { type: "checkbox", checked: ok.includes(t), onchange: (e) => { S.on[row.key + ":" + i] = e.target.checked; draw(); } }) : h("span", null, "•"),
          h("div", null, t.title, h("small", null, [t.category, t.date ? "due " + fmtDay(t.date) : null, t.priority, t.amount ? money(t.amount) : null].filter(Boolean).join(" · ")),
            t.held ? h("small", { style: "color:#C9A227" }, "Held back: " + t.held + ". Tick it if you still want it.") : null))),
        row.auto.map((a) => h("div", { class: "mdx-task" }, h("span", null, "✦"), h("div", null, "Added to My Day: " + a.title, h("small", null, "why: " + a.reason)))),
        row.emails.map((m) => h("div", { class: "mdx-mail" }, h("b", null, m.from), " · ", fmtDay(m.date), h("div", null, m.subject), m.snippet ? h("div", { style: "color:var(--faint)" }, m.snippet.slice(0, 220)) : null)),
        h("div", { style: "display:flex;gap:6px" },
          h("button", { class: "mdx-q", onclick: async () => { S.msg = await window.MYDAYInvoice.reread(row.ids); load(); } }, "↻ Read again"),
          row.forced ? h("button", { class: "mdx-q", onclick: async () => { await post("/api/automation/view-override", { ids: row.ids, to: null }); load(); } }, "Let MYDAY decide again") : null)) : null);
  }

  function draw() {
    if (!S.host) return;
    const c = ctx(), acc = (c && c.accent) || "#2FBF87", n = parseInt(acc.slice(1), 16);
    const root = h("div", { class: "mdx " + (c && c.isDark === false ? "light" : "dark") });
    root.style.setProperty("--a", acc); root.style.setProperty("--a-rgb", `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`);
    const D = S.data;
    const rows = D ? D.rows.filter((r) => S.tab === "all" || r.bucket === S.tab) : [];
    const picked = rows.filter((r) => S.pick.has(r.key));

    root.append(h("div", { class: "mdx-top" },
      h("div", null, h("h1", null, "Automation"),
        h("div", { class: "mdx-status" }, D && D.connected ? [h("span", { class: "myday-led" }), `Watching ${D.email || "Gmail"} · read-only · last checked ${D.lastRun ? ago(D.lastRun) + " ago" : "—"}`]
          : D ? "Gmail isn't connected — open Classic view to connect it" : "Loading…"),
        D && D.since ? h("div", { class: "mdx-status" }, `Showing mail from ${new Date(D.since).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} on`,
          D.tucked ? ` · ${D.tucked} older tucked away (not deleted)` : "",
          h("button", { class: "mdx-q", style: "padding:2px 8px", onclick: () => setSince(null) }, "Show everything")) : null),
      h("div", { class: "mdx-act" },
        D && !D.since ? h("button", { class: "mdx-btn hot", title: "Only show mail from this moment on — older mail is tucked away, not deleted", onclick: () => setSince("now") }, "⏵ Start from now") : null,
        h("button", { class: "mdx-btn", disabled: S.busy || null, onclick: async () => { S.busy = true; draw(); const r = await post("/api/automation/check-now"); S.msg = r.ok ? (r.j.added ? `${r.j.added} new` : "Nothing new") : r.j.error; S.busy = false; load(); } }, S.busy ? "Checking…" : "↻ Check now"),
        D && D.toReviewInvoices ? h("button", { class: "mdx-btn hot", onclick: () => c && c.setView("captured") }, `🧾 ${D.toReviewInvoices} invoice${D.toReviewInvoices === 1 ? "" : "s"} to review →`) : null,
        h("button", { class: "mdx-btn", onclick: () => window.MYDAYRules && window.MYDAYRules.open() }, "⚙ Auto rules"),
        h("button", { class: "mdx-btn", onclick: () => window.MYDAYHealth && window.MYDAYHealth.open() }, "🩺 Health"),
        h("button", { class: "mdx-btn", title: "What the AI knows about your world, and what it has learned from you", onclick: () => window.MYDAYMemory && window.MYDAYMemory.open() }, "🧠 Memory"),
        h("button", { class: "mdx-btn", title: "The previous Automation screen, with Gmail settings", onclick: () => c && c.setView("automation-classic") }, "Classic view"))));

    if (D) {
      const tabs = [["needs", "Needs you", D.counts.needs, "to decide"], ["auto", "Added automatically", D.counts.auto, "already in My Day"],
        ["quiet", "Handled quietly", D.counts.quiet, "codes, notices, promos…"], ["all", "Owed", null, ""]];
      root.append(h("div", { class: "mdx-sum" }, tabs.map(([k, l, num, sub]) => k === "all"
        ? h("button", { class: S.tab === "all" ? "on" : "", title: "Unpaid invoices, each counted once; nothing paid or quiet", onclick: () => { S.tab = "all"; draw(); } },
            h("small", null, "Owed (unpaid, counted once)"), h("b", null, money(D.owed.total)), h("span", null, `${D.owed.invoices} invoice${D.owed.invoices === 1 ? "" : "s"} · tap for all rows`))
        : h("button", { class: S.tab === k ? "on" : "", onclick: () => { S.tab = k; S.pick.clear(); draw(); } }, h("small", null, l), h("b", null, num), h("span", null, sub)))));
    }
    if (picked.length) root.append(h("div", { class: "mdx-bulk" }, `${picked.length} selected`,
      S.tab !== "auto" ? h("button", { class: "mdx-go", onclick: () => act(picked, "add") }, "Add selected") : h("button", { class: "mdx-go", onclick: () => act(picked, "done") }, "Done"),
      h("button", { class: "mdx-q", onclick: () => act(picked, "ignore") }, "Ignore selected"),
      h("button", { class: "mdx-q", onclick: () => { S.pick.clear(); draw(); } }, "Clear")));
    if (S.msg) root.append(h("div", { class: "mdx-note" }, S.msg));

    if (D && rows.length) {
      const sel = S.tab !== "quiet" ? rows : [];
      const allOn = sel.length && sel.every((r) => S.pick.has(r.key));
      const clearAs = S.tab === "auto" ? "done" : "ignore";
      root.append(h("div", { class: "mdx-head" },
        sel.length ? h("label", null, h("input", { type: "checkbox", checked: allOn, onchange: (e) => { sel.forEach((r) => (e.target.checked ? S.pick.add(r.key) : S.pick.delete(r.key))); draw(); } }), " Select all") : h("span"),
        h("span", { class: "mdx-count" }, `${rows.length} row${rows.length === 1 ? "" : "s"} · ${rows.reduce((n, r) => n + r.count, 0)} emails`),
        S.tab !== "all" ? h("button", { class: "mdx-q", disabled: S.busy || null, onclick: () => {
          const what = S.tab === "auto" ? "Mark all done? Their tasks stay in My Day." : `Clear all ${rows.length}? They're marked handled inside MYDAY — nothing is deleted, and Gmail isn't touched.`;
          if (confirm(what)) act(rows, clearAs);
        } }, `Clear all ${rows.length}`) : null));
    }
    const list = h("div", { class: "mdx-list" });
    if (!D) list.append(h("div", { class: "mdx-empty" }, "Loading…"));
    else if (!rows.length) list.append(h("div", { class: "mdx-empty" }, S.tab === "needs" ? "Nothing needs you right now. 🎉" : "Nothing here."));
    else rows.forEach((r) => list.append(rowView(r)));
    root.append(list);
    if (D && S.tab === "quiet" && rows.length) root.append(h("div", { class: "mdx-note" }, "These are still in MYDAY exactly as they arrived — just tucked away, each with its reason. \u201cPut back\u201d moves one to Needs you. Gmail is never changed."));
    if (D && S.tab === "needs") root.append(h("div", { class: "mdx-note" }, `${D.counts.emails} emails waiting in total, grouped into conversations. Ignore marks them ignored inside MYDAY only.`));
    S.host.replaceChildren(root);
  }

  async function setSince(at) {
    if (at === "now" && !confirm("Start from now? Mail from before this moment is tucked away from this screen and from Captured Invoices — not deleted. New mail keeps coming in.")) return;
    await post("/api/automation/inbox-since", { at });
    S.pick.clear(); await load();
  }

  let timer = null;
  function mount(host) {
    if (!document.getElementById("mdx-css")) { const st = document.createElement("style"); st.id = "mdx-css"; st.textContent = CSS; document.head.appendChild(st); }
    S.host = host; draw(); load();
    clearInterval(timer); timer = setInterval(() => { if (S.host && !document.hidden && !S.busy) load(); }, 60000);
  }
  function unmount() { S.host = null; clearInterval(timer); }
  window.MYDAYInbox = { mount, unmount, reload: load };
})();
