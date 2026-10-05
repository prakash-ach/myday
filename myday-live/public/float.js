/* MYDAY floating view — My day tasks, a timer and a calculator in one small
 * window that stays on top.
 *
 * Chrome and Edge on a computer: a real Picture-in-Picture window that floats
 * above every other window and app, even when this tab is in the background.
 * Safari, iPad, Firefox: browsers there don't allow that, so it becomes a
 * panel that floats above every screen inside MYDAY instead.
 *
 * The app hands over its live state as window.__myday on every render and
 * calls window.__mydayTick, so ticking a task here ticks it there and the
 * other way round. The timer lives here, in the main window, so it keeps
 * running while the floating view is minimised.
 */
(function () {
  "use strict";

  const PIP = "documentPictureInPicture" in window;
  const FULL = { w: 360, h: 540 };
  const MINI = { w: 340, h: 92 };

  const S = {
    win: null,            // the Picture-in-Picture window, when there is one
    doc: null,            // the document we draw into
    root: null,
    tab: "tasks",
    mini: false,
    timer: { mode: "down", setMs: 25 * 60e3, leftMs: 25 * 60e3, upMs: 0, runningSince: 0, done: false, flash: 0 },
    calc: { expr: "", result: "", history: [] },
    tick: null,
    audio: null,
  };

  const ctx = () => window.__myday || null;
  const notify = () => { try { window.__mydayFloatChange && window.__mydayFloatChange(); } catch (e) {} };

  /* ---------- small DOM helper that builds in whichever document is showing ---------- */
  function h(tag, attrs, ...kids) {
    const el = S.doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style") el.setAttribute("style", v);
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.appendChild(typeof kid === "string" || typeof kid === "number" ? S.doc.createTextNode(String(kid)) : kid);
    }
    return el;
  }
  const $ = (sel) => S.root && S.root.querySelector(sel);

  /* ---------- look ---------- */
  const CSS = `
  .mdf{--a:#2FBF87;--a-rgb:47,191,135;font:13px/1.4 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;
    color:var(--ink);display:flex;flex-direction:column;height:100%;box-sizing:border-box;
    background:radial-gradient(120% 70% at 0% 0%,rgba(var(--a-rgb),.22),transparent 60%),
               radial-gradient(90% 60% at 100% 100%,rgba(var(--a-rgb),.12),transparent 60%),var(--bg);}
  .mdf *{box-sizing:border-box}
  .mdf.dark{--bg:#10141A;--ink:#E9EDF3;--muted:#8C97A8;--faint:#5E6878;--glass:rgba(255,255,255,.06);--line:rgba(255,255,255,.09);--key:rgba(255,255,255,.07)}
  .mdf.light{--bg:#F1F3F5;--ink:#141A21;--muted:#5F6B79;--faint:#8D98A6;--glass:rgba(255,255,255,.66);--line:rgba(20,30,40,.09);--key:rgba(255,255,255,.8)}
  .mdf button{font:inherit;color:inherit;cursor:pointer;outline:none}
  .mdf button:focus-visible{box-shadow:0 0 0 2px rgba(var(--a-rgb),.7)}
  .mdf-head{display:flex;align-items:center;gap:8px;padding:10px 10px 8px 14px;user-select:none}
  .mdf-brand{font:600 14px "Iowan Old Style",Palatino,Georgia,serif;letter-spacing:-.01em;flex:1}
  .mdf-brand small{font:500 10.5px ui-sans-serif,-apple-system,sans-serif;color:var(--faint);margin-left:6px}
  .mdf-ic{width:28px;height:28px;border-radius:9px;border:1px solid var(--line);background:var(--glass);
    display:flex;align-items:center;justify-content:center;color:var(--muted);padding:0;
    -webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}
  .mdf-ic:hover{color:var(--a);border-color:rgba(var(--a-rgb),.5)}
  .mdf-tabs{display:flex;gap:3px;margin:0 12px 10px;padding:3px;border-radius:11px;background:var(--glass);border:1px solid var(--line)}
  .mdf-tabs button{flex:1;border:0;background:transparent;padding:7px 0;border-radius:8px;color:var(--muted);font-weight:500}
  .mdf-tabs button.on{background:rgba(var(--a-rgb),.16);color:var(--a);font-weight:700}
  .mdf-body{flex:1;overflow:auto;padding:0 12px 12px}
  .mdf-card{background:var(--glass);border:1px solid var(--line);border-radius:14px;padding:12px;
    -webkit-backdrop-filter:blur(18px) saturate(160%);backdrop-filter:blur(18px) saturate(160%);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.07)}
  .mdf-sub{font-size:11.5px;color:var(--faint)}
  .mdf-add{display:flex;gap:6px;margin-bottom:10px}
  .mdf-add input{flex:1;min-width:0;border:1px solid var(--line);background:var(--glass);color:var(--ink);
    border-radius:10px;padding:9px 11px;font:inherit;outline:none}
  .mdf-add input:focus{border-color:rgba(var(--a-rgb),.6)}
  .mdf-go{border:0;border-radius:10px;width:38px;background:linear-gradient(135deg,var(--a),rgba(var(--a-rgb),.7));color:#fff;font-size:18px;font-weight:700}
  .mdf-row{display:flex;align-items:center;gap:10px;padding:8px 2px;border-bottom:1px solid var(--line)}
  .mdf-row:last-child{border-bottom:0}
  .mdf-chk{width:20px;height:20px;border-radius:999px;border:2px solid rgba(var(--a-rgb),.5);background:transparent;flex-shrink:0;
    display:flex;align-items:center;justify-content:center;padding:0;color:#fff;font-size:11px;font-weight:900}
  .mdf-chk.on{background:var(--a);border-color:var(--a)}
  .mdf-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .mdf-t.done{text-decoration:line-through;color:var(--faint)}
  .mdf-meta{font-size:11px;color:var(--faint);flex-shrink:0}
  .mdf-meta.late{color:#FF8A90;font-weight:700}
  .mdf-ring{display:block;margin:4px auto 6px}
  .mdf-big{font:300 40px ui-sans-serif,-apple-system,sans-serif;font-variant-numeric:tabular-nums;letter-spacing:-.03em;text-align:center}
  .mdf-chips{display:flex;flex-wrap:wrap;gap:5px;justify-content:center;margin:10px 0}
  .mdf-chip{border:1px solid var(--line);background:var(--glass);border-radius:999px;padding:5px 11px;font-size:12px;color:var(--muted)}
  .mdf-chip.on{border-color:var(--a);color:var(--a);background:rgba(var(--a-rgb),.12);font-weight:700}
  .mdf-btns{display:flex;gap:7px;justify-content:center}
  .mdf-btn{border:1px solid var(--line);background:var(--glass);border-radius:11px;padding:9px 18px;font-weight:600}
  .mdf-btn.pri{border:0;background:linear-gradient(135deg,var(--a),rgba(var(--a-rgb),.7));color:#fff}
  .mdf-flash{animation:mdf-flash .6s ease-in-out 6}
  @keyframes mdf-flash{50%{background:rgba(var(--a-rgb),.35)}}
  .mdf-disp{text-align:right;padding:10px 6px 12px;min-height:76px}
  .mdf-expr{font-size:13px;color:var(--faint);min-height:18px;word-break:break-all}
  .mdf-res{font:300 34px ui-sans-serif,-apple-system,sans-serif;font-variant-numeric:tabular-nums;letter-spacing:-.02em;word-break:break-all;cursor:copy}
  .mdf-keys{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
  .mdf-k{border:1px solid var(--line);background:var(--key);border-radius:12px;height:44px;font-size:16px;font-weight:500}
  .mdf-k:active{transform:scale(.96)}
  .mdf-k.op{color:var(--a);font-weight:700}
  .mdf-k.eq{border:0;background:linear-gradient(135deg,var(--a),rgba(var(--a-rgb),.7));color:#fff;font-weight:700}
  .mdf-hist{display:flex;gap:5px;flex-wrap:wrap;margin-top:9px}
  .mdf-mini{display:flex;align-items:center;gap:10px;padding:10px 12px;height:100%}
  .mdf-mini .mdf-t{font-weight:600}
  .mdf-led{width:8px;height:8px;border-radius:999px;background:var(--a);box-shadow:0 0 8px var(--a);flex-shrink:0;animation:mdf-led 1.4s ease-in-out infinite}
  @keyframes mdf-led{50%{opacity:.35;box-shadow:none}}
  .mdf-panel{position:fixed;z-index:2147483000;width:${FULL.w}px;height:${FULL.h}px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);
    border-radius:18px;overflow:hidden;border:1px solid rgba(255,255,255,.12);
    box-shadow:0 30px 80px -20px rgba(0,0,0,.6),0 0 0 1px rgba(0,0,0,.08)}
  .mdf-panel.min{height:${MINI.h - 28}px}
  .mdf-panel .mdf-head{cursor:grab;touch-action:none}
  @media (prefers-reduced-motion:reduce){.mdf-led,.mdf-flash{animation:none}}
  `;

  function paint() {
    const c = ctx();
    if (!S.root) return;
    const dark = c ? !!c.isDark : true;
    const acc = (c && c.accent) || "#2FBF87";
    const n = parseInt(acc.slice(1), 16);
    S.root.classList.toggle("dark", dark);
    S.root.classList.toggle("light", !dark);
    S.root.style.setProperty("--a", acc);
    S.root.style.setProperty("--a-rgb", `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`);
  }

  /* ---------- svg icons ---------- */
  const svg = (d, size = 15) => {
    const el = S.doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    el.setAttribute("viewBox", "0 0 24 24"); el.setAttribute("width", size); el.setAttribute("height", size);
    el.setAttribute("fill", "none"); el.setAttribute("stroke", "currentColor"); el.setAttribute("stroke-width", "2.2");
    el.setAttribute("stroke-linecap", "round"); el.setAttribute("stroke-linejoin", "round");
    el.innerHTML = d;
    return el;
  };
  const I = {
    min: '<path d="M5 12h14"/>',
    max: '<path d="M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6"/>',
    back: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
  };

  /* ---------- tasks ---------- */
  function taskList() {
    const c = ctx();
    if (!c) return [];
    const seen = new Set(), out = [];
    const push = (t, key, late) => { if (!seen.has(t.id)) { seen.add(t.id); out.push({ t, key, late }); } };
    (c.overdue || []).forEach((t) => push(t, t.date, true));
    (c.dayTasks || []).forEach((t) => push(t, c.today, false));
    out.forEach((r) => (r.done = !!(r.t.done && r.t.done[r.key])));
    const mins = (s) => { const [a, b] = String(s || "").split(":").map(Number); return a * 60 + (b || 0); };
    out.sort((x, y) => (x.done - y.done) || (y.late - x.late) || ((x.t.time ? mins(x.t.time) : 1e5) - (y.t.time ? mins(y.t.time) : 1e5)));
    return out;
  }
  const clock = (s) => { if (!s) return ""; const [a, b] = s.split(":").map(Number); return `${a % 12 || 12}:${String(b).padStart(2, "0")}${a >= 12 ? "pm" : "am"}`; };

  function renderTasks() {
    const box = $("#mdf-tasks");
    const head = $("#mdf-taskhead");
    if (!box) return;
    const c = ctx();
    const rows = taskList();
    const left = rows.filter((r) => !r.done).length;
    if (head) head.textContent = rows.length ? `${rows.length - left} of ${rows.length} done${left ? ` · ${left} to go` : " · all clear"}` : "Nothing on today";
    box.replaceChildren(
      ...(rows.length
        ? rows.map((r) => {
            const col = (c && c.state && c.state.prefs.accents[r.t.space]) || "";
            return h("div", { class: "mdf-row" },
              h("button", { class: "mdf-chk" + (r.done ? " on" : ""), title: r.done ? "Mark not done" : "Done",
                style: col ? `border-color:${col};${r.done ? "background:" + col : ""}` : null,
                onclick: () => { const cc = ctx(); cc && cc.toggleTask(r.t.id, r.key); } }, r.done ? "✓" : ""),
              h("span", { class: "mdf-t" + (r.done ? " done" : ""), title: r.t.title }, r.t.title),
              r.late ? h("span", { class: "mdf-meta late" }, "overdue") : r.t.time ? h("span", { class: "mdf-meta" }, clock(r.t.time)) : null);
          })
        : [h("p", { class: "mdf-sub", style: "text-align:center;margin:18px 0" }, "Nothing on today. Add one above.")])
    );
  }

  function addTask(input) {
    const c = ctx();
    const title = input.value.trim();
    if (!c || !title) return;
    const space = c.space === "all" || !c.space ? "company" : c.space;
    const cats = (c.state && c.state.categories && c.state.categories[space]) || [""];
    c.addTask({
      id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4),
      title, space, category: cats[0], date: c.today, time: "", repeat: "none", repeatDays: null,
      repeatEvery: 1, repeatUntil: null, priority: "normal", note: "", subtasks: [], projectId: null,
      done: {}, createdAt: Date.now(),
    });
    input.value = "";
  }

  function viewTasks() {
    const input = h("input", { placeholder: "Add to today…", onkeydown: (e) => e.key === "Enter" && addTask(input) });
    return h("div", null,
      h("div", { class: "mdf-add" }, input, h("button", { class: "mdf-go", title: "Add", onclick: () => addTask(input) }, "+")),
      h("div", { class: "mdf-card" },
        h("div", { id: "mdf-taskhead", class: "mdf-sub", style: "margin-bottom:4px" }),
        h("div", { id: "mdf-tasks" })),
      h("p", { class: "mdf-sub", style: "margin:9px 2px 0" }, "Ticks here tick in MYDAY too. New ones go in your first category; move them from the task if needed."));
  }

  /* ---------- timer ---------- */
  const T = S.timer;
  const running = () => !!T.runningSince;
  function timerNow() {
    const run = running() ? Date.now() - T.runningSince : 0;
    return T.mode === "down" ? Math.max(0, T.leftMs - run) : T.upMs + run;
  }
  const fmt = (ms) => {
    const s = Math.round(ms / 1000), hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    return (hh ? hh + ":" + String(mm).padStart(2, "0") : String(mm).padStart(2, "0")) + ":" + String(ss).padStart(2, "0");
  };
  function beep() {
    try {
      S.audio = S.audio || new (window.AudioContext || window.webkitAudioContext)();
      const a = S.audio;
      [0, 0.32, 0.64, 1.3, 1.62, 1.94].forEach((t0) => {
        const o = a.createOscillator(), g = a.createGain();
        o.type = "sine"; o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, a.currentTime + t0);
        g.gain.exponentialRampToValueAtTime(0.3, a.currentTime + t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + t0 + 0.25);
        o.connect(g); g.connect(a.destination); o.start(a.currentTime + t0); o.stop(a.currentTime + t0 + 0.27);
      });
    } catch (e) {}
  }
  function timerStart() {
    try { S.audio = S.audio || new (window.AudioContext || window.webkitAudioContext)(); S.audio.resume(); } catch (e) {}
    if (T.mode === "down" && T.leftMs <= 0) T.leftMs = T.setMs;
    T.done = false; T.runningSince = Date.now(); ensureTick(); renderTimer();
  }
  function timerPause() {
    if (!running()) return;
    const run = Date.now() - T.runningSince;
    if (T.mode === "down") T.leftMs = Math.max(0, T.leftMs - run); else T.upMs += run;
    T.runningSince = 0; renderTimer();
  }
  function timerReset() { T.runningSince = 0; T.done = false; T.leftMs = T.setMs; T.upMs = 0; renderTimer(); }
  function timerSet(min) { T.mode = "down"; T.setMs = T.leftMs = Math.max(1, min) * 60e3; T.runningSince = 0; T.done = false; renderTimer(true); }

  function ensureTick() {
    if (S.tick) return;
    S.tick = setInterval(() => {
      if (T.mode === "down" && running() && timerNow() <= 0) {
        T.leftMs = 0; T.runningSince = 0; T.done = true; beep();
        if (S.mini) setMini(false);
        if (S.tab !== "timer") { S.tab = "timer"; renderAll(); }
        const card = $("#mdf-timercard"); card && card.classList.add("mdf-flash");
      }
      renderTimerFace(); renderMiniBar();
      if (!running() && !S.root) { clearInterval(S.tick); S.tick = null; }
    }, 250);
  }

  function ring(frac) {
    const NS = "http://www.w3.org/2000/svg", R = 54, C = 2 * Math.PI * R;
    const el = S.doc.createElementNS(NS, "svg");
    el.setAttribute("viewBox", "0 0 128 128"); el.setAttribute("width", "150"); el.setAttribute("height", "150"); el.setAttribute("class", "mdf-ring");
    el.innerHTML = `<circle cx="64" cy="64" r="${R}" fill="none" stroke="var(--line)" stroke-width="8"/>
      <circle id="mdf-arc" cx="64" cy="64" r="${R}" fill="none" stroke="var(--a)" stroke-width="8" stroke-linecap="round"
        transform="rotate(-90 64 64)" stroke-dasharray="${C * frac} ${C}" style="transition:stroke-dasharray .25s linear;filter:drop-shadow(0 0 6px rgba(var(--a-rgb),.6))"/>
      <text id="mdf-ringtxt" x="64" y="72" text-anchor="middle" fill="var(--ink)" style="font:300 25px ui-sans-serif,-apple-system,sans-serif;font-variant-numeric:tabular-nums"></text>`;
    return el;
  }
  function renderTimerFace() {
    const txt = S.root && S.root.querySelector("#mdf-ringtxt"), arc = S.root && S.root.querySelector("#mdf-arc");
    if (!txt) return;
    const ms = timerNow();
    txt.textContent = fmt(ms);
    const C = 2 * Math.PI * 54;
    const frac = T.mode === "down" ? (T.setMs ? ms / T.setMs : 0) : (ms / 60e3) % 1;
    arc.setAttribute("stroke-dasharray", `${C * frac} ${C}`);
    const st = $("#mdf-timerstate");
    if (st) st.textContent = T.done ? "Time's up" : running() ? (T.mode === "down" ? "Counting down" : "Running") : (T.mode === "down" && T.leftMs < T.setMs) || T.upMs ? "Paused" : "Ready";
  }
  function viewTimer() {
    const presets = [5, 10, 15, 25, 45, 60];
    const custom = h("input", { type: "number", min: "1", max: "600", placeholder: "min",
      style: "width:64px;border:1px solid var(--line);background:var(--glass);color:var(--ink);border-radius:999px;padding:5px 10px;font:inherit;outline:none",
      onkeydown: (e) => { if (e.key === "Enter" && +custom.value > 0) timerSet(+custom.value); } });
    return h("div", null,
      h("div", { class: "mdf-tabs", style: "margin:0 0 10px" },
        h("button", { class: T.mode === "down" ? "on" : "", onclick: () => { timerPause(); T.mode = "down"; renderTimer(true); } }, "Countdown"),
        h("button", { class: T.mode === "up" ? "on" : "", onclick: () => { timerPause(); T.mode = "up"; renderTimer(true); } }, "Stopwatch")),
      h("div", { id: "mdf-timercard", class: "mdf-card" },
        ring(1),
        h("div", { id: "mdf-timerstate", class: "mdf-sub", style: "text-align:center" }),
        T.mode === "down" ? h("div", { class: "mdf-chips" },
          presets.map((m) => h("button", { class: "mdf-chip" + (T.setMs === m * 60e3 ? " on" : ""), onclick: () => timerSet(m) }, m + "m")),
          custom) : h("div", { style: "height:12px" }),
        h("div", { class: "mdf-btns" },
          running() ? h("button", { class: "mdf-btn pri", onclick: timerPause }, "Pause")
                    : h("button", { class: "mdf-btn pri", onclick: timerStart }, T.done ? "Again" : "Start"),
          h("button", { class: "mdf-btn", onclick: timerReset }, "Reset"))),
      h("p", { class: "mdf-sub", style: "margin:9px 2px 0" }, "Keeps running when you minimise or close this window. Beeps when it's done."));
  }
  function renderTimer(full) {
    if (S.tab === "timer" && S.root && full !== false) {
      const body = $(".mdf-body"); if (body) body.replaceChildren(viewTimer());
    }
    renderTimerFace(); renderMiniBar();
  }

  /* ---------- calculator: its own parser, never eval ---------- */
  function evaluate(src) {
    const s = src.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/\s+/g, "");
    let i = 0;
    const peek = () => s[i];
    function num() {
      let j = i; while (/[0-9.]/.test(s[i] || "")) i++;
      if (j === i) throw 0;
      const v = parseFloat(s.slice(j, i)); if (!isFinite(v)) throw 0; return v;
    }
    function atom() {
      let v;
      if (peek() === "-") { i++; return -atom(); }
      if (peek() === "+") { i++; return atom(); }
      if (peek() === "(") { i++; v = expr(); if (peek() === ")") i++; }
      else v = num();
      while (peek() === "%") { i++; v = v / 100; }
      return v;
    }
    function term() {
      let v = atom();
      while (peek() === "*" || peek() === "/") { const op = s[i++]; const r = atom(); v = op === "*" ? v * r : v / r; }
      return v;
    }
    function expr() {
      let v = term();
      while (peek() === "+" || peek() === "-") { const op = s[i++]; const r = term(); v = op === "+" ? v + r : v - r; }
      return v;
    }
    const v = expr();
    if (i !== s.length || !isFinite(v)) throw 0;
    return v;
  }
  const show = (v) => {
    if (Math.abs(v) >= 1e15 || (Math.abs(v) < 1e-9 && v !== 0)) return v.toExponential(6);
    return (+v.toFixed(10)).toLocaleString("en-US", { maximumFractionDigits: 10 });
  };
  const C2 = S.calc;
  function calcPreview() { try { return C2.expr ? show(evaluate(C2.expr)) : ""; } catch (e) { return ""; } }
  function calcPress(k) {
    if (k === "C") { C2.expr = ""; C2.result = ""; }
    else if (k === "⌫") { C2.expr = C2.expr.slice(0, -1); C2.result = ""; }
    else if (k === "=") {
      try {
        const v = evaluate(C2.expr);
        C2.history = [{ e: C2.expr, v }, ...C2.history].slice(0, 4);
        C2.result = show(v); C2.expr = String(+v.toFixed(10));
      } catch (e) { C2.result = "Can't work that out"; }
    } else if (k === "±") {
      C2.expr = C2.expr.startsWith("-(") && C2.expr.endsWith(")") ? C2.expr.slice(2, -1) : C2.expr ? `-(${C2.expr})` : "-";
    } else {
      if (C2.result && /[0-9.(]/.test(k) && C2.history[0] && C2.expr === String(+C2.history[0].v.toFixed(10))) C2.expr = "";
      C2.result = ""; C2.expr += k;
    }
    renderCalcDisplay();
  }
  function renderCalcDisplay() {
    const e = $("#mdf-expr"), r = $("#mdf-res"), hb = $("#mdf-hist");
    if (!e) return;
    e.textContent = C2.result ? C2.history[0] ? C2.history[0].e + " =" : "" : C2.expr || "";
    r.textContent = C2.result || calcPreview() || (C2.expr ? "…" : "0");
    r.style.color = C2.result === "Can't work that out" ? "#FF8A90" : "";
    hb.replaceChildren(...C2.history.map((x) =>
      h("button", { class: "mdf-chip", title: x.e, onclick: () => { C2.expr += String(+x.v.toFixed(10)); C2.result = ""; renderCalcDisplay(); } }, show(x.v))));
  }
  function viewCalc() {
    const keys = [["C", "⌫", "%", "÷"], ["7", "8", "9", "×"], ["4", "5", "6", "−"], ["1", "2", "3", "+"], ["±", "0", ".", "="]];
    const ops = new Set(["÷", "×", "−", "+", "%", "C", "⌫", "±"]);
    return h("div", null,
      h("div", { class: "mdf-card" },
        h("div", { class: "mdf-disp" },
          h("div", { id: "mdf-expr", class: "mdf-expr" }),
          h("div", { id: "mdf-res", class: "mdf-res", title: "Click to copy",
            onclick: () => { const v = $("#mdf-res").textContent; try { navigator.clipboard.writeText(v.replace(/,/g, "")); $("#mdf-res").title = "Copied"; } catch (e) {} } })),
        h("div", { class: "mdf-keys" }, keys.flat().map((k) =>
          h("button", { class: "mdf-k" + (k === "=" ? " eq" : ops.has(k) ? " op" : ""), onclick: () => calcPress(k) }, k))),
        h("div", { id: "mdf-hist", class: "mdf-hist" })),
      h("p", { class: "mdf-sub", style: "margin:9px 2px 0" }, "Typing works too: numbers, + − × ÷, %, brackets, Enter and Backspace. Tap the answer to copy it."));
  }
  function calcKeys(e) {
    if (S.tab !== "calc" || S.mini) return;
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    const map = { "*": "×", "/": "÷", "-": "−", Enter: "=", "=": "=", Backspace: "⌫", Escape: "C", c: "C", C: "C" };
    const k = map[e.key] || (/^[0-9.+%()]$/.test(e.key) ? e.key : null);
    if (k) { e.preventDefault(); calcPress(k); }
  }

  /* ---------- frame ---------- */
  function renderMiniBar() {
    const bar = $("#mdf-minibar");
    if (!bar) return;
    const next = taskList().find((r) => !r.done);
    const t = $("#mdf-mini-t"), x = $("#mdf-mini-x");
    t.textContent = next ? next.t.title : "Nothing left today";
    const showTimer = running() || T.done || (T.mode === "down" ? T.leftMs < T.setMs : T.upMs > 0);
    x.textContent = showTimer ? (T.done ? "done" : fmt(timerNow())) : "";
  }

  function renderAll() {
    if (!S.root) return;
    paint();
    const head = h("div", { class: "mdf-head", id: "mdf-head" },
      h("div", { class: "mdf-brand" }, "MYDAY", h("small", null, PIP && S.win ? "on top of everything" : "floating")),
      h("button", { class: "mdf-ic", title: S.mini ? "Expand" : "Minimise", onclick: () => setMini(!S.mini) }, svg(S.mini ? I.max : I.min)),
      h("button", { class: "mdf-ic", title: "Back to My day", onclick: backToApp }, svg(I.back)),
      h("button", { class: "mdf-ic", title: "Close", onclick: close }, svg(I.close)));

    if (S.mini) {
      S.root.replaceChildren(h("div", { id: "mdf-minibar", class: "mdf-mini" },
        h("span", { class: "mdf-led" }),
        h("span", { id: "mdf-mini-t", class: "mdf-t" }),
        h("span", { id: "mdf-mini-x", class: "mdf-meta", style: "font-variant-numeric:tabular-nums;font-weight:700;color:var(--a);font-size:13px" }),
        h("button", { class: "mdf-ic", title: "Expand", onclick: () => setMini(false) }, svg(I.max)),
        h("button", { class: "mdf-ic", title: "Back to My day", onclick: backToApp }, svg(I.back)),
        h("button", { class: "mdf-ic", title: "Close", onclick: close }, svg(I.close))));
      if (!S.win) S.root.querySelector("#mdf-minibar").addEventListener("pointerdown", dragStart);
      renderMiniBar();
      return;
    }

    const tabs = h("div", { class: "mdf-tabs" },
      [["tasks", "My day"], ["timer", "Timer"], ["calc", "Calculator"]].map(([k, l]) =>
        h("button", { class: S.tab === k ? "on" : "", onclick: () => { S.tab = k; renderAll(); } }, l)));
    const body = h("div", { class: "mdf-body" }, S.tab === "tasks" ? viewTasks() : S.tab === "timer" ? viewTimer() : viewCalc());
    S.root.replaceChildren(head, tabs, body);
    if (!S.win) head.addEventListener("pointerdown", dragStart);
    if (S.tab === "tasks") renderTasks();
    if (S.tab === "timer") renderTimerFace();
    if (S.tab === "calc") renderCalcDisplay();
  }

  function setMini(on) {
    S.mini = on;
    if (S.win) { try { on ? S.win.resizeTo(MINI.w, MINI.h) : S.win.resizeTo(FULL.w, FULL.h); } catch (e) {} }
    if (S.panel) S.panel.classList.toggle("min", on);
    renderAll();
  }

  function backToApp() {
    const c = ctx();
    try { c && c.setView("today"); } catch (e) {}
    try { window.focus(); } catch (e) {}
    if (!S.win) setMini(true); // in-page: tuck it away so the page is visible
  }

  /* dragging the in-page panel */
  function dragStart(e) {
    if (!S.panel || e.target.closest("button")) return;
    const r = S.panel.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = (ev) => {
      const x = Math.min(Math.max(8, ev.clientX - dx), window.innerWidth - r.width - 8);
      const y = Math.min(Math.max(8, ev.clientY - dy), window.innerHeight - 60);
      S.panel.style.left = x + "px"; S.panel.style.top = y + "px"; S.panel.style.right = "auto"; S.panel.style.bottom = "auto";
    };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up);
      try { localStorage.setItem("myday_float_pos", JSON.stringify({ l: S.panel.style.left, t: S.panel.style.top })); } catch (e) {} };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  }

  /* ---------- open / close ---------- */
  async function open() {
    if (S.root) { if (S.win) try { S.win.focus(); } catch (e) {} return; }
    if (PIP) {
      try {
        const win = await window.documentPictureInPicture.requestWindow({ width: FULL.w, height: FULL.h });
        S.win = win; S.doc = win.document;
        const st = S.doc.createElement("style"); st.textContent = CSS + "html,body{margin:0;height:100%}"; S.doc.head.appendChild(st);
        S.doc.title = "MYDAY";
        S.root = S.doc.createElement("div"); S.root.className = "mdf"; S.doc.body.appendChild(S.root);
        S.doc.addEventListener("keydown", calcKeys);
        win.addEventListener("pagehide", teardown);
        S.mini = false; renderAll(); ensureTick(); notify();
        return;
      } catch (e) { S.win = null; S.doc = null; /* fall through to the in-page panel */ }
    }
    S.doc = document;
    if (!document.getElementById("mdf-css")) { const st = document.createElement("style"); st.id = "mdf-css"; st.textContent = CSS; document.head.appendChild(st); }
    S.panel = document.createElement("div"); S.panel.className = "mdf-panel";
    let pos = null; try { pos = JSON.parse(localStorage.getItem("myday_float_pos") || "null"); } catch (e) {}
    if (pos && pos.l) { S.panel.style.left = pos.l; S.panel.style.top = pos.t; } else { S.panel.style.right = "86px"; S.panel.style.bottom = "18px"; }
    S.root = document.createElement("div"); S.root.className = "mdf"; S.panel.appendChild(S.root);
    document.body.appendChild(S.panel);
    document.addEventListener("keydown", calcKeys);
    S.mini = false; renderAll(); ensureTick(); notify();
  }

  function teardown() {
    if (S.doc) S.doc.removeEventListener("keydown", calcKeys);
    if (S.panel) S.panel.remove();
    S.win = null; S.doc = null; S.root = null; S.panel = null; S.mini = false;
    notify();
  }
  function close() { if (S.win) { try { S.win.close(); } catch (e) {} } teardown(); }

  window.__mydayTick = () => { if (!S.root) return; paint(); renderTasks(); renderMiniBar(); };
  window.MYDAYFloat = { open, close, supported: PIP, isOpen: () => !!S.root };
})();
