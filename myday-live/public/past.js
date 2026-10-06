/* Past days — what got done, and what didn't, on a day or over a range.
 *
 * Opened from the clock icon next to "My day". Pick one date or a from–to
 * range (or Yesterday / Last 7 days / Last 30 days). For each day it lists
 * the tasks ticked off that day, and one-off tasks that were due that day
 * and still aren't done — those can be moved to today in one tap. Repeating
 * tasks show on the days they were ticked. Follows the space you're in
 * (Company / Personal / All).
 */
(function () {
  "use strict";
  const ctx = () => window.__myday || null;
  const S = { el: null, mode: "single", from: "", to: "" };
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const dayOf = (s) => new Date(s + "T12:00:00");
  const shift = (s, n) => { const d = dayOf(s); d.setDate(d.getDate() + n); return iso(d); };
  const pretty = (s) => dayOf(s).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: dayOf(s).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });

  const CSS = `
  .mdp-back{position:fixed;inset:0;z-index:2147483000;background:rgba(5,8,12,.45);display:flex;align-items:center;justify-content:center;padding:16px}
  .mdp{width:min(680px,100%);max-height:calc(100vh - 32px);display:flex;flex-direction:column;border-radius:20px;overflow:hidden;
    font:13.5px/1.45 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg);border:1px solid var(--line);
    -webkit-backdrop-filter:blur(26px) saturate(170%);backdrop-filter:blur(26px) saturate(170%);box-shadow:0 40px 100px -30px rgba(0,0,0,.7)}
  .mdp.dark{--bg:rgba(16,20,26,.95);--ink:#E9EDF3;--muted:#8C97A8;--faint:#5E6878;--glass:rgba(255,255,255,.06);--line:rgba(255,255,255,.1)}
  .mdp.light{--bg:rgba(250,251,252,.97);--ink:#141A21;--muted:#5F6B79;--faint:#8D98A6;--glass:rgba(255,255,255,.85);--line:rgba(20,30,40,.1)}
  @media (max-width:700px){.mdp-back{padding:0}.mdp{max-height:100vh;height:100%;border-radius:0}}
  .mdp *{box-sizing:border-box}
  .mdp button{font:inherit;color:inherit;cursor:pointer}
  .mdp-head{display:flex;gap:10px;align-items:flex-start;padding:16px 18px 10px}
  .mdp-head h3{margin:0;font:600 19px "Iowan Old Style",Palatino,Georgia,serif}
  .mdp-head p{margin:2px 0 0;color:var(--muted);font-size:12.5px}
  .mdp-x{margin-left:auto;width:32px;height:32px;border-radius:10px;border:1px solid var(--line);background:var(--glass);flex-shrink:0}
  .mdp-ctl{padding:0 18px 12px;border-bottom:1px solid var(--line);display:grid;gap:8px}
  .mdp-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  .mdp-chip{border:1px solid var(--line);background:var(--glass);color:var(--muted);border-radius:999px;padding:5px 12px;font-size:12.5px}
  .mdp-chip.on{border-color:var(--a);color:var(--a);background:rgba(var(--a-rgb),.12);font-weight:700}
  .mdp-in{border:1px solid var(--line);background:var(--glass);color:var(--ink);border-radius:9px;padding:6px 9px;font:inherit;outline:none;color-scheme:var(--scheme)}
  .mdp-sum{display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;color:var(--muted)}
  .mdp-sum b{color:var(--ink)}
  .mdp-body{overflow:auto;padding:12px 18px 18px;display:grid;gap:12px}
  .mdp-day h4{margin:0 0 6px;font-size:13px;display:flex;gap:8px;align-items:baseline}
  .mdp-day h4 span{font-weight:400;color:var(--faint);font-size:12px}
  .mdp-t{display:flex;gap:9px;align-items:center;padding:7px 10px;border-radius:10px;background:var(--glass);border:1px solid var(--line);margin-bottom:5px}
  .mdp-t .mk{width:18px;height:18px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;flex-shrink:0}
  .mdp-t .mk.done{background:var(--a);color:#fff}
  .mdp-t .mk.miss{border:2px solid #F2545B;color:#F2545B}
  .mdp-t .tt{flex:1;min-width:0}
  .mdp-t small{display:block;color:var(--faint);font-size:11.5px}
  .mdp-t.miss .tt{color:var(--ink)}
  .mdp-mv{border:1px solid var(--line);background:transparent;border-radius:8px;padding:4px 9px;font-size:12px;color:var(--muted);white-space:nowrap}
  .mdp-mv:hover{color:var(--a);border-color:var(--a)}
  .mdp-empty{color:var(--faint);text-align:center;padding:24px}
  `;
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "value") el.value = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.appendChild(typeof kid === "string" || typeof kid === "number" ? document.createTextNode(String(kid)) : kid);
    }
    return el;
  }

  function collect(from, to) {
    const c = ctx(); if (!c) return [];
    const inSpace = typeof c.inSpace === "function" ? c.inSpace : () => true;
    const tasks = ((c.state && c.state.tasks) || []).filter((t) => inSpace(t));
    const days = [];
    for (let d = to; d >= from; d = shift(d, -1)) {
      const done = tasks.filter((t) => t.done && t.done[d]);
      const missed = d < c.today ? tasks.filter((t) => (t.repeat || "none") === "none" && t.date === d && !(t.done && t.done[d])) : [];
      days.push({ d, done, missed });
      if (days.length > 120) break;
    }
    return days;
  }

  function draw() {
    const c = ctx(); if (!c) return;
    const today = c.today, yest = shift(today, -1);
    if (!S.from) { S.from = yest; S.to = yest; }
    if (S.mode === "single") S.to = S.from;
    if (S.from > S.to) [S.from, S.to] = [S.to, S.from];
    const days = collect(S.from, S.to);
    const nDone = days.reduce((n, x) => n + x.done.length, 0), nMiss = days.reduce((n, x) => n + x.missed.length, 0);
    const acc = c.accent || "#2FBF87", num = parseInt(acc.slice(1), 16), dark = c.isDark !== false;
    const set = (from, to, mode) => { S.from = from; S.to = to; S.mode = mode; draw(); };

    const panel = h("div", { class: "mdp " + (dark ? "dark" : "light"), role: "dialog", "aria-label": "Past days" },
      h("div", { class: "mdp-head" },
        h("div", null, h("h3", null, "Past days"), h("p", null, "What got done — and what didn't — on a day or over a range.")),
        h("button", { class: "mdp-x", title: "Close", onclick: close }, "✕")),
      h("div", { class: "mdp-ctl" },
        h("div", { class: "mdp-row" },
          h("button", { class: "mdp-chip" + (S.mode === "single" && S.from === yest ? " on" : ""), onclick: () => set(yest, yest, "single") }, "Yesterday"),
          h("button", { class: "mdp-chip" + (S.mode === "range" && S.from === shift(today, -7) && S.to === yest ? " on" : ""), onclick: () => set(shift(today, -7), yest, "range") }, "Last 7 days"),
          h("button", { class: "mdp-chip" + (S.mode === "range" && S.from === shift(today, -30) && S.to === yest ? " on" : ""), onclick: () => set(shift(today, -30), yest, "range") }, "Last 30 days"),
          h("span", { style: "flex:1" }),
          h("button", { class: "mdp-chip" + (S.mode === "single" ? " on" : ""), onclick: () => { S.mode = "single"; draw(); } }, "One date"),
          h("button", { class: "mdp-chip" + (S.mode === "range" ? " on" : ""), onclick: () => { S.mode = "range"; draw(); } }, "Date range")),
        h("div", { class: "mdp-row" },
          h("label", { style: "font-size:12px;color:var(--faint)" }, S.mode === "range" ? "From" : "Date"),
          h("input", { class: "mdp-in", type: "date", max: today, value: S.from, onchange: (e) => { if (e.target.value) { S.from = e.target.value; draw(); } } }),
          S.mode === "range" ? [h("label", { style: "font-size:12px;color:var(--faint)" }, "to"),
            h("input", { class: "mdp-in", type: "date", max: today, value: S.to, onchange: (e) => { if (e.target.value) { S.to = e.target.value; draw(); } } })] : null),
        h("div", { class: "mdp-sum" },
          h("span", null, h("b", null, nDone), " done"),
          h("span", null, h("b", null, nMiss), " not done"),
          nDone + nMiss ? h("span", null, h("b", null, Math.round((nDone / (nDone + nMiss)) * 100) + "%"), " completed") : null,
          h("span", null, S.mode === "range" ? `${days.length} day${days.length === 1 ? "" : "s"}` : pretty(S.from)))),
      h("div", { class: "mdp-body" },
        !nDone && !nMiss ? h("div", { class: "mdp-empty" }, "Nothing was ticked off or left undone on " + (S.mode === "range" ? "those days." : "that day.")) : null,
        days.filter((x) => x.done.length || x.missed.length).map((x) => h("div", { class: "mdp-day" },
          h("h4", null, pretty(x.d), h("span", null, `${x.done.length} done${x.missed.length ? ` · ${x.missed.length} not done` : ""}`)),
          x.done.map((t) => h("div", { class: "mdp-t" }, h("span", { class: "mk done" }, "✓"),
            h("div", { class: "tt" }, t.title, h("small", null, [t.category, t.repeat && t.repeat !== "none" ? "repeats" : null].filter(Boolean).join(" · "))))),
          x.missed.map((t) => h("div", { class: "mdp-t miss" }, h("span", { class: "mk miss" }, "!"),
            h("div", { class: "tt" }, t.title, h("small", null, `${t.category || ""} · not done yet`)),
            h("button", { class: "mdp-mv", title: "Move this task to today", onclick: () => { c.patchTask(t.id, { date: c.today }); setTimeout(draw, 80); } }, "Move to today")))))));
    panel.style.setProperty("--a", acc);
    panel.style.setProperty("--a-rgb", `${(num >> 16) & 255},${(num >> 8) & 255},${num & 255}`);
    panel.style.setProperty("--scheme", dark ? "dark" : "light");
    if (!S.el) { S.el = h("div", { class: "mdp-back", onclick: (e) => { if (e.target === S.el) close(); } }); document.body.appendChild(S.el); }
    S.el.replaceChildren(panel);
  }
  function open() { draw(); }
  function close() { if (S.el) S.el.remove(); S.el = null; }

  function boot() {
    const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.el) close(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  window.MYDAYPast = { open, close };
})();
