/* MYDAY automatic rules — the browser side.
 *
 * 1. Collects automatic tasks from the server's outbox every few seconds and
 *    puts them in My Day (once each: a task already there is just
 *    acknowledged). Also tells the server your timezone the first time.
 * 2. The "Auto rules" panel: switch each rule on or off, set who counts as a
 *    review sender (e.g. Saad Javed's address), your company domains and
 *    timezone, and see every automatic action with its reason. An
 *    automatically ignored message can be put back in Review from there.
 */
(function () {
  "use strict";

  const ctx = () => window.__myday || null;
  const S = { busy: false, el: null, data: null, draft: null };
  const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { return ""; } })();

  /* ---------- 1. collecting automatic tasks ---------- */
  async function collect() {
    const c = ctx();
    if (!c || S.busy) return;
    S.busy = true;
    try {
      const r = await fetch("/api/automation/outbox?tz=" + encodeURIComponent(TZ), { credentials: "same-origin" });
      if (!r.ok) return;
      const { tasks } = await r.json();
      if (!tasks || !tasks.length) return;
      const have = new Set(((c.state && c.state.tasks) || []).map((t) => t.id));
      const fresh = tasks.filter((t) => !have.has(t.id));
      fresh.forEach((t) => c.addTask(t));
      // give the app a moment to save before saying they're in
      setTimeout(() => {
        fetch("/api/automation/outbox/seen", { method: "POST", credentials: "same-origin",
          headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: tasks.map((t) => t.id) }) }).catch(() => {});
      }, fresh.length ? 2500 : 0);
      if (fresh.length && c.setToast) c.setToast(`${fresh.length} task${fresh.length === 1 ? "" : "s"} added to My Day from your email`);
    } catch (e) {
    } finally { S.busy = false; }
  }

  /* ---------- 2. the panel ---------- */
  const CSS = `
  .mdr-back{position:fixed;inset:0;z-index:2147483100;background:rgba(5,8,12,.5);display:flex;align-items:center;justify-content:center;padding:16px}
  .mdr{width:min(860px,100%);max-height:calc(100vh - 32px);display:flex;flex-direction:column;border-radius:20px;overflow:hidden;
    font:13px/1.45 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg);border:1px solid var(--line);
    -webkit-backdrop-filter:blur(26px) saturate(170%);backdrop-filter:blur(26px) saturate(170%);box-shadow:0 40px 100px -30px rgba(0,0,0,.7)}
  .mdr.dark{--bg:rgba(16,20,26,.95);--ink:#E9EDF3;--muted:#8C97A8;--faint:#5E6878;--glass:rgba(255,255,255,.06);--line:rgba(255,255,255,.1);--warn:#F5C542}
  .mdr.light{--bg:rgba(250,251,252,.97);--ink:#141A21;--muted:#5F6B79;--faint:#8D98A6;--glass:rgba(255,255,255,.85);--line:rgba(20,30,40,.1);--warn:#B8860B}
  @media (max-width:700px){.mdr-back{padding:0}.mdr{max-height:100vh;height:100%;border-radius:0}}
  .mdr *{box-sizing:border-box}
  .mdr button{font:inherit;color:inherit;cursor:pointer}
  .mdr-head{display:flex;align-items:flex-start;gap:12px;padding:16px 18px 12px;border-bottom:1px solid var(--line)}
  .mdr-head h3{margin:0;font:600 18px "Iowan Old Style",Palatino,Georgia,serif}
  .mdr-head p{margin:3px 0 0;color:var(--muted);font-size:12.5px}
  .mdr-x{margin-left:auto;width:32px;height:32px;border-radius:10px;border:1px solid var(--line);background:var(--glass);flex-shrink:0}
  .mdr-body{overflow:auto;padding:14px 18px;display:grid;gap:14px}
  .mdr-card{border:1px solid var(--line);background:var(--glass);border-radius:14px;padding:12px 14px}
  .mdr-card h4{margin:0 0 8px;font-size:13.5px}
  .mdr-rule{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid var(--line)}
  .mdr-rule:first-of-type{border-top:0}
  .mdr-rule b{display:block;font-size:13px}
  .mdr-rule span{color:var(--muted);font-size:12px}
  .mdr-sw{position:relative;width:38px;height:22px;border-radius:999px;border:0;flex-shrink:0;margin-top:2px;background:var(--line);transition:background .2s}
  .mdr-sw::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:999px;background:#fff;transition:transform .2s}
  .mdr-sw.on{background:var(--a)}.mdr-sw.on::after{transform:translateX(16px)}
  .mdr label{display:block;font-size:11.5px;color:var(--faint);margin:8px 0 3px}
  .mdr-in{width:100%;border:1px solid var(--line);background:var(--glass);color:var(--ink);border-radius:9px;padding:7px 9px;font:inherit;outline:none}
  .mdr-in:focus{border-color:var(--a)}
  .mdr-pair{display:grid;grid-template-columns:1fr 2fr auto;gap:6px;align-items:center;margin-bottom:6px}
  .mdr-warn{color:var(--warn);font-size:12px;margin-top:6px}
  .mdr-log{display:grid;gap:6px;max-height:300px;overflow:auto}
  .mdr-ev{display:grid;grid-template-columns:auto 1fr auto;gap:9px;align-items:start;padding:8px 10px;border-radius:10px;border:1px solid var(--line);background:var(--glass)}
  .mdr-ev small{display:block;color:var(--faint);font-size:11.5px}
  .mdr-badge{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap}
  .mdr-badge.task{background:rgba(var(--a-rgb),.15);color:var(--a)}
  .mdr-badge.ignore{background:rgba(140,151,168,.18);color:var(--muted)}
  .mdr-badge.review,.mdr-badge.undo{background:rgba(245,197,66,.15);color:var(--warn)}
  .mdr-foot{display:flex;gap:8px;align-items:center;padding:12px 18px;border-top:1px solid var(--line)}
  .mdr-pri{border:0;border-radius:10px;padding:9px 16px;font-weight:700;color:#fff;background:linear-gradient(135deg,var(--a),rgba(var(--a-rgb),.75))}
  .mdr-sec{border:1px solid var(--line);background:var(--glass);border-radius:10px;padding:8px 12px;color:var(--muted)}
  .mdr-note{margin-right:auto;color:var(--muted);font-size:12px}
  `;
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style") el.setAttribute("style", v);
      else if (k === "value") el.value = v;
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
    const c = ctx(), acc = (c && c.accent) || "#2FBF87", n = parseInt(acc.slice(1), 16);
    el.classList.add(c && c.isDark === false ? "light" : "dark");
    el.style.setProperty("--a", acc);
    el.style.setProperty("--a-rgb", `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`);
    return el;
  }
  const RULES = [
    ["bids", "Auction bid files → My Day", "A task for today with the sender, auction, bid deadline, and links to the email and file."],
    ["invoices", "Supplier invoices → review task", "Stays in Review, plus \u201cReview invoice from [supplier]\u201d today with number, amount, due date and file. Never marks it reviewed or paid."],
    ["reviewSenders", "Review senders → review task", "Mail from the addresses below stays in Review, plus a review task today."],
    ["orders", "Outside orders → review task", "Actionable orders from customers or suppliers. Not your own company's notifications or MobileSentrix confirmations."],
    ["promotions", "Promotions → Ignored", "Marketing content only, judged message by message. If the AI isn't sure, it stays in Review."],
  ];
  const ago = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + "m ago" : s < 86400 ? Math.round(s / 3600) + "h ago" : Math.round(s / 86400) + "d ago"; };
  const ruleName = { bids: "Bid file", invoices: "Invoice", reviewSender: "Review sender", orders: "Order", promotions: "Promotion", you: "You" };

  async function load() {
    const r = await fetch("/api/automation/rules", { credentials: "same-origin" });
    if (!r.ok) throw new Error("couldn't load the rules");
    S.data = await r.json();
    S.draft = JSON.parse(JSON.stringify(S.data.rules));
  }
  async function open() {
    try { await load(); } catch (e) { const c = ctx(); c && c.setToast && c.setToast("Couldn't load the rules"); return; }
    draw();
  }
  function close() { if (S.el) S.el.remove(); S.el = null; }

  function draw() {
    const D = S.draft, data = S.data;
    const senders = D.reviewSenders.length ? D.reviewSenders : [{ name: "", emails: [] }];
    D.reviewSenders = senders;
    const missing = senders.filter((s) => s.name && !(s.emails || []).length);
    const zones = (() => { try { return Intl.supportedValuesOf("timeZone"); } catch (e) { return [TZ, "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Asia/Kathmandu", "Europe/London", "UTC"]; } })();

    const panel = themed(h("div", { class: "mdr", role: "dialog", "aria-label": "Automatic rules" },
      h("div", { class: "mdr-head" },
        h("div", null, h("h3", null, "Automatic rules"),
          h("p", null, "What MYDAY does with mail on its own. It only adds tasks and marks messages Ignored inside MYDAY — it never sends, bids, pays or deletes anything.")),
        h("button", { class: "mdr-x", title: "Close", onclick: close }, "✕")),
      h("div", { class: "mdr-body" },
        !data.aiOn ? h("div", { class: "mdr-card mdr-warn" }, "AI reading of your mail is off, so only the review-sender rule and invoices MYDAY already knows how to read will work. The owner can switch on \u201cAI reads their Gmail\u201d in Settings \u2192 Team.") : null,
        h("div", { class: "mdr-card" }, h("h4", null, "Rules"),
          RULES.map(([k, title, sub]) => h("div", { class: "mdr-rule" },
            h("button", { class: "mdr-sw" + (D.enabled[k] ? " on" : ""), role: "switch", "aria-checked": String(!!D.enabled[k]), title: D.enabled[k] ? "On" : "Off",
              onclick: () => { D.enabled[k] = !D.enabled[k]; draw(); } }),
            h("div", null, h("b", null, title), h("span", null, sub))))),
        h("div", { class: "mdr-card" }, h("h4", null, "Review senders"),
          h("span", { style: "color:var(--muted);font-size:12px" }, "Matched only by email address. Separate several addresses with commas."),
          senders.map((s, i) => h("div", { class: "mdr-pair", style: "margin-top:8px" },
            h("input", { class: "mdr-in", placeholder: "Name", value: s.name, oninput: (e) => { s.name = e.target.value; } }),
            h("input", { class: "mdr-in", placeholder: "their@email.com", value: (s.emails || []).join(", "),
              oninput: (e) => { s.emails = e.target.value.split(/[,\s]+/).filter(Boolean); } }),
            h("button", { class: "mdr-sec", title: "Remove", onclick: () => { D.reviewSenders.splice(i, 1); draw(); } }, "✕"))),
          h("button", { class: "mdr-sec", onclick: () => { D.reviewSenders.push({ name: "", emails: [] }); draw(); } }, "+ Add someone"),
          missing.length ? h("div", { class: "mdr-warn" }, `Add an email address for ${missing.map((s) => s.name).join(", ")} — without one, this rule can't recognise them.`) : null),
        h("div", { class: "mdr-card" }, h("h4", null, "Your company and time"),
          h("label", null, "Company domains (mail from these is your own — never a supplier, order or promotion)"),
          h("input", { class: "mdr-in", placeholder: "e.g. apt-ability.com", value: D.companyDomains.join(", "),
            oninput: (e) => { D.companyDomains = e.target.value.split(/[,\s]+/).filter(Boolean); } }),
          h("div", { style: "font-size:11.5px;color:var(--faint);margin-top:4px" }, "Already counted from Automation settings: " + (data.ownDomains || []).join(", ")),
          h("label", null, "Senders known for promotions (a hint only — each message is still judged on its content)"),
          h("input", { class: "mdr-in", value: D.promoHints.join(", "), oninput: (e) => { D.promoHints = e.target.value.split(/[,\s]+/).filter(Boolean); } }),
          h("label", null, `Timezone for \u201ctoday\u201d (today there is ${data.today})`),
          h("select", { class: "mdr-in", onchange: (e) => { D.timezone = e.target.value; } },
            [D.timezone || data.zoneInUse, ...zones].filter((z, i, a) => z && a.indexOf(z) === i)
              .map((z) => h("option", { value: z, selected: z === (D.timezone || data.zoneInUse) ? true : null }, z)))),
        h("div", { class: "mdr-card" }, h("h4", null, "What it did, and why"),
          data.log.length ? h("div", { class: "mdr-log" }, data.log.map((x) => h("div", { class: "mdr-ev" },
            h("span", { class: "mdr-badge " + x.action }, x.action === "task" ? "Task added" : x.action === "ignore" ? "Ignored" : x.action === "undo" ? "Put back" : "Left in Review"),
            h("div", null, h("b", null, x.title || x.subject || "(no subject)"),
              h("small", null, `${ruleName[x.rule] || x.rule} · ${x.from || ""} · ${ago(x.at)}`),
              h("small", null, "Why: " + x.reason)),
            x.canUndo ? h("button", { class: "mdr-sec", onclick: () => undo(x.mailId) }, "Put back in Review") : h("span"))))
            : h("span", { style: "color:var(--muted)" }, "Nothing yet. Automatic actions will be listed here with the reason for each."))),
      h("div", { class: "mdr-foot" },
        h("span", { class: "mdr-note" }, "Changes apply to mail read from now on. Use \u201cLook back\u201d or \u201cRead again\u201d to apply them to older mail."),
        h("button", { class: "mdr-sec", onclick: close }, "Cancel"),
        h("button", { class: "mdr-pri", onclick: saveIt }, "Save"))));

    if (!S.el) {
      S.el = h("div", { class: "mdr-back", onclick: (e) => { if (e.target === S.el) close(); } });
      document.body.appendChild(S.el);
    }
    S.el.replaceChildren(panel);
  }
  async function saveIt() {
    const c = ctx();
    try {
      const r = await fetch("/api/automation/rules", { method: "PUT", credentials: "same-origin",
        headers: { "content-type": "application/json" }, body: JSON.stringify(S.draft) });
      if (!r.ok) throw 0;
      S.data = await r.json(); S.draft = JSON.parse(JSON.stringify(S.data.rules));
      c && c.setToast && c.setToast("Rules saved");
      close();
    } catch (e) { c && c.setToast && c.setToast("Couldn't save the rules"); }
  }
  async function undo(id) {
    await fetch("/api/automation/undo", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => {});
    try { window.__mydayFeedRefresh && window.__mydayFeedRefresh(); } catch (e) {}
    await load(); draw();
  }

  function boot() {
    const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    setTimeout(collect, 2500);
    setInterval(collect, 20000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) collect(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.el) close(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  window.MYDAYRules = { open, collect };
})();
