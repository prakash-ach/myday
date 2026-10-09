/* MYDAY assistant — talk about your tasks, by typing or out loud.
 *
 * A round button on the right edge opens a panel. It sends your question and
 * a compact list of your tasks to /api/ai/chat; the server asks OpenAI and
 * sends back an answer, plus any changes it suggests. Suggested changes show
 * as buttons, and nothing changes until you tap one.
 *
 * "Talk" turns on a hands-free loop: it listens, answers out loud, then
 * listens again, until you tap it off. Uses the browser's own speech, which
 * works in Chrome, Edge and Safari (including iPad).
 *
 * Name and icon come from Settings → Appearance (prefs.aiName, prefs.aiIcon).
 */
(function () {
  "use strict";

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  const TTS = "speechSynthesis" in window;
  const S = {
    open: false, msgs: [], busy: false, status: null, signedIn: true,
    talk: false, listening: false, rec: null, el: {},
  };
  const ctx = () => window.__myday || null;
  const name = () => { const c = ctx(); return (c && c.state && c.state.prefs && String(c.state.prefs.aiName || "").trim()) || "Max"; };
  const icon = () => { const c = ctx(); return (c && c.state && c.state.prefs && c.state.prefs.aiIcon) || "✦"; };

  /* ---------- look ---------- */
  const CSS = `
  .mda-launch{position:fixed;right:18px;bottom:22px;z-index:2147481000;width:56px;height:56px;border-radius:999px;border:1px solid rgba(255,255,255,.22);
    cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:24px;line-height:1;color:#fff;padding:0;
    background:radial-gradient(circle at 32% 28%,rgba(255,255,255,.55),transparent 42%),linear-gradient(140deg,var(--mda-a),rgba(var(--mda-rgb),.62));
    box-shadow:0 10px 30px -6px rgba(var(--mda-rgb),.65),0 0 0 6px rgba(var(--mda-rgb),.12),inset 0 1px 0 rgba(255,255,255,.4);
    -webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);transition:transform .2s,box-shadow .2s}
  .mda-launch:hover{transform:translateY(-2px) scale(1.04)}
  .mda-launch .dot{position:absolute;top:3px;right:3px;width:11px;height:11px;border-radius:999px;border:2px solid rgba(0,0,0,.35);background:#22E06E;box-shadow:0 0 8px #39FF8C;animation:mda-blink 1.4s ease-in-out infinite}
  .mda-launch .dot.off{background:#8C97A8;box-shadow:none;animation:none}
  @keyframes mda-blink{50%{opacity:.35}}
  .mda-launch.hide{display:none}
  .mda{position:fixed;top:0;right:0;bottom:0;z-index:2147482000;width:min(420px,100vw);display:flex;flex-direction:column;
    font:14px/1.45 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);
    background:radial-gradient(110% 60% at 100% 0%,rgba(var(--mda-rgb),.22),transparent 60%),var(--bg);
    -webkit-backdrop-filter:blur(26px) saturate(170%);backdrop-filter:blur(26px) saturate(170%);
    border-left:1px solid var(--line);box-shadow:-30px 0 80px -30px rgba(0,0,0,.6);
    transform:translateX(105%);transition:transform .28s cubic-bezier(.2,.8,.2,1);
    padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
  .mda.on{transform:none}
  .mda.dark{--bg:rgba(14,17,22,.86);--ink:#E9EDF3;--muted:#8C97A8;--faint:#5E6878;--glass:rgba(255,255,255,.06);--line:rgba(255,255,255,.09)}
  .mda.light{--bg:rgba(246,248,250,.9);--ink:#141A21;--muted:#5F6B79;--faint:#8D98A6;--glass:rgba(255,255,255,.75);--line:rgba(20,30,40,.09)}
  .mda *{box-sizing:border-box}
  .mda button{font:inherit;color:inherit;cursor:pointer}
  .mda-head{display:flex;align-items:center;gap:10px;padding:14px 14px 12px;border-bottom:1px solid var(--line)}
  .mda-av{width:38px;height:38px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:19px;color:#fff;flex-shrink:0;
    background:radial-gradient(circle at 32% 28%,rgba(255,255,255,.5),transparent 45%),linear-gradient(140deg,var(--mda-a),rgba(var(--mda-rgb),.6));
    box-shadow:0 0 18px rgba(var(--mda-rgb),.45)}
  .mda-who{flex:1;min-width:0}
  .mda-who b{display:block;font-size:15px}
  .mda-who span{font-size:11.5px;color:var(--faint)}
  .mda-ic{width:32px;height:32px;border-radius:10px;border:1px solid var(--line);background:var(--glass);display:flex;align-items:center;justify-content:center;color:var(--muted);padding:0}
  .mda-ic:hover{color:var(--mda-a)}
  .mda-list{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:10px}
  .mda-b{max-width:86%;padding:10px 13px;border-radius:16px;white-space:pre-wrap;word-wrap:break-word}
  .mda-b.me{align-self:flex-end;background:linear-gradient(140deg,var(--mda-a),rgba(var(--mda-rgb),.75));color:#fff;border-bottom-right-radius:5px}
  .mda-b.ai{align-self:flex-start;background:var(--glass);border:1px solid var(--line);border-bottom-left-radius:5px}
  .mda-b.err{border-color:rgba(242,84,91,.5);color:#FF8A90}
  .mda-acts{align-self:flex-start;width:86%;display:flex;flex-direction:column;gap:6px}
  .mda-act{display:flex;align-items:center;gap:8px;padding:9px 10px;border-radius:12px;border:1px solid rgba(var(--mda-rgb),.35);background:rgba(var(--mda-rgb),.08);font-size:13px}
  .mda-act span{flex:1;min-width:0}
  .mda-act small{display:block;color:var(--faint);font-size:11.5px}
  .mda-do{border:0;border-radius:9px;padding:6px 12px;font-weight:700;font-size:12.5px;color:#fff;background:var(--mda-a);flex-shrink:0}
  .mda-did{color:var(--mda-a);font-weight:700;font-size:12.5px;flex-shrink:0}
  .mda-dots{align-self:flex-start;display:flex;gap:4px;padding:12px 14px;border-radius:16px;background:var(--glass);border:1px solid var(--line)}
  .mda-dots i{width:7px;height:7px;border-radius:999px;background:var(--mda-a);animation:mda-dot 1s infinite ease-in-out}
  .mda-dots i:nth-child(2){animation-delay:.15s}.mda-dots i:nth-child(3){animation-delay:.3s}
  @keyframes mda-dot{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}
  .mda-hello{text-align:center;padding:26px 8px 6px;color:var(--muted)}
  .mda-hello .mda-av{width:64px;height:64px;font-size:30px;margin:0 auto 12px}
  .mda-hello b{display:block;color:var(--ink);font-size:17px;margin-bottom:4px}
  .mda-chips{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:14px}
  .mda-chip{border:1px solid var(--line);background:var(--glass);border-radius:999px;padding:7px 12px;font-size:12.5px;color:var(--muted)}
  .mda-chip:hover{color:var(--mda-a);border-color:rgba(var(--mda-rgb),.5)}
  .mda-foot{padding:10px 12px 12px;border-top:1px solid var(--line);display:flex;gap:7px;align-items:flex-end}
  .mda-in{flex:1;min-width:0;resize:none;max-height:120px;border:1px solid var(--line);background:var(--glass);color:var(--ink);border-radius:14px;padding:10px 12px;font:inherit;outline:none}
  .mda-in:focus{border-color:rgba(var(--mda-rgb),.6)}
  .mda-send{width:40px;height:40px;border-radius:12px;border:0;background:linear-gradient(140deg,var(--mda-a),rgba(var(--mda-rgb),.7));color:#fff;display:flex;align-items:center;justify-content:center;padding:0;flex-shrink:0}
  .mda-send:disabled{opacity:.45}
  .mda-mic{width:40px;height:40px;border-radius:12px;border:1px solid var(--line);background:var(--glass);color:var(--muted);display:flex;align-items:center;justify-content:center;padding:0;flex-shrink:0}
  .mda-mic.on{color:#fff;background:#F2545B;border-color:#F2545B;animation:mda-pulse 1.2s infinite}
  @keyframes mda-pulse{0%{box-shadow:0 0 0 0 rgba(242,84,91,.55)}100%{box-shadow:0 0 0 12px rgba(242,84,91,0)}}
  .mda-talk{display:flex;align-items:center;gap:6px;height:32px;padding:0 11px;border-radius:10px;border:1px solid var(--line);background:var(--glass);color:var(--muted);font-size:12.5px;font-weight:600}
  .mda-talk.on{color:#fff;background:var(--mda-a);border-color:var(--mda-a);box-shadow:0 0 16px rgba(var(--mda-rgb),.5)}
  .mda-live{font-size:12px;color:var(--mda-a);text-align:center;padding:4px 0 0;min-height:18px}
  .mda-setup{margin:8px 0;padding:14px;border-radius:14px;background:var(--glass);border:1px solid var(--line);font-size:13px;color:var(--muted)}
  .mda-setup code{display:block;margin:6px 0;padding:7px 9px;border-radius:8px;background:rgba(0,0,0,.25);color:var(--ink);font:12px ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-all}
  @media (prefers-reduced-motion:reduce){.mda,.mda-launch{transition:none}.mda-dots i,.mda-launch .dot,.mda-mic.on{animation:none}}
  `;

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style") el.setAttribute("style", v);
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.appendChild(typeof kid === "string" || typeof kid === "number" ? document.createTextNode(String(kid)) : kid);
    }
    return el;
  }
  const svg = (d, size = 17) => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    el.setAttribute("viewBox", "0 0 24 24"); el.setAttribute("width", size); el.setAttribute("height", size);
    el.setAttribute("fill", "none"); el.setAttribute("stroke", "currentColor"); el.setAttribute("stroke-width", "2.1");
    el.setAttribute("stroke-linecap", "round"); el.setAttribute("stroke-linejoin", "round"); el.innerHTML = d; return el;
  };
  const I = {
    send: '<path d="M5 12h13M13 6l6 6-6 6"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    fresh: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    talk: '<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><rect x="2" y="14" width="5" height="7" rx="2"/><rect x="17" y="14" width="5" height="7" rx="2"/>',
  };

  /* ---------- theme ---------- */
  function paint() {
    const c = ctx();
    // Signed in since the last check (the app is showing): ask again now.
    if (c && (!S.signedIn || !S.status) && Date.now() - lastCheck > 4000) refreshStatus();
    const acc = (c && c.accent) || "#2FBF87";
    const n = parseInt(acc.slice(1), 16);
    const rgb = `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
    for (const el of [S.el.launch, S.el.panel]) {
      if (!el) continue;
      el.style.setProperty("--mda-a", acc); el.style.setProperty("--mda-rgb", rgb);
    }
    if (S.el.panel) {
      const dark = c ? !!c.isDark : true;
      S.el.panel.classList.toggle("dark", dark); S.el.panel.classList.toggle("light", !dark);
    }
    if (S.el.launch) {
      S.el.launch.querySelector(".ico").textContent = icon();
      S.el.launch.title = `Talk to ${name()}`;
      S.el.launch.style.bottom = c && c.narrow ? "calc(env(safe-area-inset-bottom,0px) + 86px)" : "22px";
      S.el.launch.classList.toggle("hide", !c || !S.signedIn || S.open || !!(S.status && S.status.allowedChat === false));
      const dot = S.el.launch.querySelector(".dot");
      dot.className = "dot" + (S.status && S.status.configured ? "" : " off");
    }
    if (S.el.av) S.el.av.textContent = icon();
    if (S.el.title) S.el.title.textContent = name();
    if (S.el.sub) S.el.sub.textContent = S.status ? (S.status.configured ? `OpenAI · ${S.status.model}` : "Not set up yet") : "…";
  }

  /* ---------- what it can see ---------- */
  const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
  function context() {
    const c = ctx();
    if (!c) return {};
    const hidePersonal = !!c.locked;
    const rows = [], seen = new Set();
    const put = (t, status, on) => {
      if (!t || seen.has(t.id) || (hidePersonal && t.space === "personal")) return;
      seen.add(t.id);
      const steps = t.subtasks || [];
      rows.push({
        id: t.id, title: clip(t.title, 120), status, on: on || t.date, time: t.time || "",
        space: t.space, category: t.category, priority: t.priority || "normal",
        repeat: t.repeat && t.repeat !== "none" ? t.repeat : undefined,
        steps: steps.length ? `${steps.filter((x) => x.done).length}/${steps.length}` : undefined,
        note: t.note ? clip(t.note, 160) : undefined,
      });
    };
    (c.overdue || []).forEach((t) => put(t, "overdue", t.date));
    (c.dayTasks || []).forEach((t) => put(t, t.done && t.done[c.today] ? "done today" : "today", c.today));
    (c.upcomingAll || []).slice(0, 80).forEach((x) => {
      const t = x && x.task ? x.task : x;
      put(t, "upcoming", (x && x.date) || (t && t.date));
    });
    // Your auction history, summed up: month × supplier × model × size × grade.
    const agg = {};
    const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
    for (const e of (c.state.entries || [])) {
      if (!e.date || e.date < yearAgo || !(+e.price > 0)) continue;
      const k = [e.date.slice(0, 7), e.supplier, e.oem, e.model, e.size, e.grade, e.status].join("|");
      const a = agg[k] || (agg[k] = { units: 0, spend: 0, min: Infinity, max: 0, lines: 0 });
      const q = +e.qty || 1; a.units += q; a.spend += (+e.price) * q; a.min = Math.min(a.min, +e.price); a.max = Math.max(a.max, +e.price); a.lines++;
    }
    const auctions = Object.entries(agg).sort((x, y) => y[0].localeCompare(x[0])).slice(0, 600).map(([k, a]) => {
      const [month, supplier, make, model, size, grade, status] = k.split("|");
      return { month, supplier, make, model, size, grade, status, units: a.units, avg: Math.round((a.spend / a.units) * 100) / 100, min: a.min, max: a.max };
    });
    const d = new Date();
    return {
      auctionHistory: auctions.length ? { note: "Auction table, last 12 months, one row per month+supplier+model+size+grade+status; avg is qty-weighted price paid", rows: auctions } : undefined,
      today: c.today,
      now: d.toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" }),
      space: c.space,
      categories: { company: (c.state.categories && c.state.categories.company) || [], personal: hidePersonal ? [] : (c.state.categories && c.state.categories.personal) || [] },
      tasks: rows.slice(0, 180),
      personalHidden: hidePersonal || undefined,
    };
  }

  /* ---------- doing what it suggests, only when tapped ---------- */
  const fmtDay = (iso) => {
    const c = ctx(); if (!iso) return "";
    if (c && iso === c.today) return "today";
    const d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  };
  const fmtTime = (s) => { if (!s) return ""; const [a, b] = s.split(":").map(Number); return ` ${a % 12 || 12}:${String(b).padStart(2, "0")}${a >= 12 ? "pm" : "am"}`; };
  const findTask = (id) => { const c = ctx(); return c && c.state && (c.state.tasks || []).find((t) => t.id === id); };
  function describe(a) {
    const t = a.id ? findTask(a.id) : null;
    if (a.type === "add") return ["Add task", `${a.title} · ${fmtDay(a.date)}${fmtTime(a.time)} · ${a.category || a.space}`];
    if (a.type === "approve_mail") return [`Add ${a.count === 1 ? "its task" : `its ${a.count} tasks`} from email`, a.subject];
    if (a.type === "ignore_mail") return ["Ignore email", a.subject];
    if (a.type === "review_invoice") return ["Review invoice & log to Auctions", a.label || a.subject];
    if (a.type === "watch") return ["Watch this model", a.model];
    if (!t) return null;
    if (a.type === "done") return ["Mark done", t.title];
    if (a.type === "move") return ["Move", `${t.title} → ${fmtDay(a.date)}${fmtTime(a.time)}`];
    if (a.type === "priority") return ["Set priority", `${t.title} → ${a.priority}`];
    return null;
  }
  const decide = (id, decision) => fetch("/api/automation/decide", { method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ id, decision }) }).then((r) => r.ok);
  async function applyMail(a) {
    const c = ctx(); if (!c) return false;
    if (a.type === "ignore_mail") return decide(a.mailId, "ignored");
    const r = await fetch("/api/automation/feed", { credentials: "same-origin" });
    const feed = r.ok ? await r.json() : null;
    const m = feed && (feed.items || []).find((x) => x.id === a.mailId);
    if (!m) return false;
    (m.tasks || []).forEach((d) => c.addTask({
      id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4),
      title: d.title, space: d.space || "company", category: d.category, date: d.date, time: d.time || "",
      repeat: "none", repeatDays: null, repeatEvery: 1, repeatUntil: null, priority: d.priority || "normal",
      note: d.note || "", subtasks: (d.subtasks || []).map((z) => ({ ...z, done: false })), projectId: null,
      done: {}, createdAt: Date.now(), fromEmail: true,
      source: { kind: "gmail", from: m.from, subject: m.subject, at: Date.now(), amount: d.amount || null, reference: d.reference || "" },
    }));
    return decide(a.mailId, "approved");
  }
  function apply(a) {
    const c = ctx(); if (!c) return false;
    if (a.type === "approve_mail" || a.type === "ignore_mail") return applyMail(a);
    if (a.type === "review_invoice") { if (window.MYDAYInvoice) { closePanel(); window.MYDAYInvoice.open(a.mailId); } return false; }
    if (a.type === "watch") { return window.MYDAYCool ? window.MYDAYCool.watch(a.model) : false; }
    if (a.type === "add") {
      c.addTask({
        id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4),
        title: a.title, space: a.space, category: a.category, date: a.date || c.today, time: a.time || "",
        repeat: "none", repeatDays: null, repeatEvery: 1, repeatUntil: null, priority: a.priority || "normal",
        note: a.note || "", subtasks: [], projectId: null, done: {}, createdAt: Date.now(),
        source: { kind: "assistant", at: Date.now() },
      });
      return true;
    }
    const t = findTask(a.id); if (!t) return false;
    if (a.type === "done") {
      const key = t.repeat && t.repeat !== "none" ? c.today : (t.date || c.today);
      if (!(t.done && t.done[key])) c.toggleTask(t.id, key);
      return true;
    }
    if (a.type === "move") { c.patchTask(t.id, { date: a.date, time: a.time || "" }); return true; }
    if (a.type === "priority") { c.patchTask(t.id, { priority: a.priority }); return true; }
    return false;
  }

  /* ---------- drawing ---------- */
  function renderList() {
    const L = S.el.list; if (!L) return;
    const kids = [];
    if (S.status && !S.status.configured) {
      kids.push(h("div", { class: "mda-setup" },
        h("b", { style: "color:var(--ink)" }, `${name()} needs an OpenAI key first`),
        h("div", { style: "margin-top:6px" }, "On the droplet Console:"),
        h("code", null, "nano /etc/myday/secrets.env"),
        h("div", null, "Add a line with your key after the = sign:"),
        h("code", null, "OPENAI_API_KEY="),
        h("div", null, "Save (Ctrl+O, Enter, Ctrl+X), then:"),
        h("code", null, "systemctl restart myday"),
        h("div", { style: "margin-top:6px" }, "Then close and reopen this panel.")));
    } else if (!S.msgs.length) {
      const c = ctx();
      const first = c && c.firstName ? `, ${c.firstName}` : "";
      kids.push(h("div", { class: "mda-hello" },
        h("div", { class: "mda-av" }, icon()),
        h("b", null, `Hi${first}, I'm ${name()}`),
        h("div", null, "Ask me anything about your tasks. I can suggest changes too — you tap to make them."),
        h("div", { class: "mda-chips" },
          ["What's on today?", "What's overdue?", "Plan my day", "Summarize my Automation inbox", "What's coming this week?"]
            .map((q) => h("button", { class: "mda-chip", onclick: () => ask(q) }, q)))));
    }
    S.msgs.forEach((m, i) => {
      if (m.role === "user") kids.push(h("div", { class: "mda-b me" }, m.content));
      else {
        kids.push(h("div", { class: "mda-b ai" + (m.error ? " err" : "") }, m.content));
        const acts = (m.actions || []).map((a, j) => ({ a, j, d: describe(a) })).filter((x) => x.d);
        if (acts.length) {
          const box = h("div", { class: "mda-acts" },
            acts.map(({ a, j, d }) => h("div", { class: "mda-act" },
              h("span", null, d[0], h("small", null, d[1])),
              m.did && m.did[j] ? h("span", { class: "mda-did" }, "Done ✓")
                : h("button", { class: "mda-do", onclick: async (e) => { e.target.disabled = true; if (await apply(a)) { (m.did = m.did || {})[j] = true; } renderList(); } }, "Do it"))));
          const left = acts.filter(({ j }) => !(m.did && m.did[j]));
          if (left.length > 1) box.appendChild(h("button", { class: "mda-chip", style: "align-self:flex-start", onclick: async (e) => {
            e.target.disabled = true; m.did = m.did || {};
            for (const { a, j } of left) { if (await apply(a)) m.did[j] = true; }
            renderList();
          } }, `Do all ${left.length}`));
          kids.push(box);
        }
      }
    });
    if (S.busy) kids.push(h("div", { class: "mda-dots" }, h("i"), h("i"), h("i")));
    L.replaceChildren(...kids);
    L.scrollTop = L.scrollHeight;
    if (S.el.send) S.el.send.disabled = S.busy;
  }

  function build() {
    const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    S.el.launch = h("button", { class: "mda-launch hide", onclick: openPanel, "aria-label": "Open assistant" },
      h("span", { class: "ico" }, "✦"), h("span", { class: "dot off" }));
    document.body.appendChild(S.el.launch);

    S.el.av = h("div", { class: "mda-av" });
    S.el.title = h("b"); S.el.sub = h("span");
    S.el.talkBtn = SR ? h("button", { class: "mda-talk", title: "Talk out loud: it listens, answers, then listens again", onclick: toggleTalk }, svg(I.talk, 15), "Talk") : null;
    S.el.list = h("div", { class: "mda-list" });
    S.el.input = h("textarea", { class: "mda-in", rows: "1", placeholder: "Ask about your tasks…",
      oninput: () => { S.el.input.style.height = "auto"; S.el.input.style.height = Math.min(120, S.el.input.scrollHeight) + "px"; },
      onkeydown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendTyped(); } } });
    S.el.send = h("button", { class: "mda-send", title: "Send", onclick: sendTyped }, svg(I.send));
    S.el.mic = SR ? h("button", { class: "mda-mic", title: "Speak", onclick: () => (S.listening ? stopListening() : listen(false)) }, svg(I.mic)) : null;
    S.el.live = h("div", { class: "mda-live" });
    S.el.panel = h("div", { class: "mda dark", role: "dialog", "aria-label": "Assistant" },
      h("div", { class: "mda-head" }, S.el.av, h("div", { class: "mda-who" }, S.el.title, S.el.sub),
        S.el.talkBtn,
        h("button", { class: "mda-ic", title: "New conversation", onclick: () => { stopTalk(); S.msgs = []; renderList(); } }, svg(I.fresh, 15)),
        h("button", { class: "mda-ic", title: "Close", onclick: closePanel }, svg(I.close, 15))),
      S.el.list,
      h("div", null, S.el.live, h("div", { class: "mda-foot" }, S.el.mic, S.el.input, S.el.send)));
    document.body.appendChild(S.el.panel);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.open) closePanel(); });
  }

  /* ---------- talking to the server ---------- */
  let lastCheck = 0;
  async function refreshStatus() {
    lastCheck = Date.now();
    try {
      const r = await fetch("/api/ai/status", { credentials: "same-origin" });
      if (r.status === 401) { S.signedIn = false; if (S.open) closePanel(); }
      else if (r.ok) { S.signedIn = true; S.status = await r.json(); }
    } catch (e) {}
    paint();
  }
  async function ask(text) {
    text = String(text || "").trim();
    if (!text || S.busy) return;
    if (S.status && !S.status.configured) return;
    S.msgs.push({ role: "user", content: text });
    S.busy = true; renderList();
    let reply;
    try {
      const r = await fetch("/api/ai/chat", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assistantName: name(), context: context(),
          messages: S.msgs.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const j = await r.json().catch(() => ({}));
      reply = r.ok ? { role: "assistant", content: j.reply, actions: j.actions || [] }
                   : { role: "assistant", content: j.error || "Something went wrong.", error: true };
    } catch (e) {
      reply = { role: "assistant", content: "Couldn't reach the server.", error: true };
    }
    S.msgs.push(reply); S.busy = false; renderList();
    if (S.talk && !reply.error) speak(reply.content, () => S.talk && listen(true));
    else if (S.talk) stopTalk();
  }
  function sendTyped() { const v = S.el.input.value; S.el.input.value = ""; S.el.input.style.height = "auto"; ask(v); }

  /* ---------- voice ---------- */
  function speak(text, then) {
    if (!TTS) { then && then(); return; }
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text).replace(/[•✓→]/g, " "));
      u.rate = 1.03; u.lang = "en-US";
      u.onend = () => { S.el.live.textContent = ""; then && then(); };
      u.onerror = () => { then && then(); };
      S.el.live.textContent = `${name()} is talking… tap Talk to stop`;
      speechSynthesis.speak(u);
    } catch (e) { then && then(); }
  }
  function listen(auto) {
    if (!SR || S.listening || S.busy) return;
    const rec = new SR();
    rec.lang = "en-US"; rec.interimResults = true; rec.continuous = false;
    let finalText = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
      }
      S.el.input.value = (finalText + interim).trim();
    };
    rec.onerror = (e) => {
      S.el.live.textContent = e.error === "not-allowed" ? "Microphone blocked. Allow it in the browser's site settings." : e.error === "no-speech" ? "Didn't hear anything." : "";
      if (e.error === "not-allowed") stopTalk();
    };
    rec.onend = () => {
      S.listening = false; S.rec = null; S.el.mic && S.el.mic.classList.remove("on");
      const said = (finalText || S.el.input.value).trim();
      if (said) { S.el.input.value = ""; S.el.live.textContent = ""; ask(said); }
      else if (S.talk && S.open) setTimeout(() => S.talk && listen(true), 400);
      else S.el.live.textContent = S.el.live.textContent.startsWith("Microphone") ? S.el.live.textContent : "";
    };
    try {
      rec.start(); S.rec = rec; S.listening = true;
      S.el.mic && S.el.mic.classList.add("on");
      S.el.live.textContent = auto ? "Listening… go ahead" : "Listening…";
    } catch (e) { S.listening = false; }
  }
  function stopListening() { try { S.rec && S.rec.stop(); } catch (e) {} }
  function toggleTalk() { S.talk ? stopTalk() : startTalk(); }
  function startTalk() {
    S.talk = true; S.el.talkBtn && S.el.talkBtn.classList.add("on");
    if (TTS) { try { speechSynthesis.speak(new SpeechSynthesisUtterance("")); } catch (e) {} } // unlocks speech on iPad
    listen(true);
  }
  function stopTalk() {
    S.talk = false; S.el.talkBtn && S.el.talkBtn.classList.remove("on");
    try { TTS && speechSynthesis.cancel(); } catch (e) {}
    try { S.rec && S.rec.abort(); } catch (e) {}
    S.listening = false; S.el.mic && S.el.mic.classList.remove("on"); S.el.live.textContent = "";
  }

  /* ---------- open / close ---------- */
  function openPanel() {
    S.open = true; S.el.panel.classList.add("on"); paint(); renderList(); refreshStatus().then(renderList);
    setTimeout(() => { try { S.el.input.focus({ preventScroll: true }); } catch (e) {} }, 250);
  }
  function closePanel() { stopTalk(); S.open = false; S.el.panel.classList.remove("on"); paint(); }

  /* the app calls this on every render */
  const prev = window.__mydayTick;
  window.__mydayTick = () => { try { prev && prev(); } catch (e) {} if (S.el.launch) paint(); };

  function boot() {
    build();
    refreshStatus();
    setInterval(refreshStatus, 120000);
    setInterval(paint, 3000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  window.MYDAYAssistant = { open: openPanel, close: closePanel, context };
})();
