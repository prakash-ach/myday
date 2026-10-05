/* The quote card at the bottom of the dashboard. Asks the server for today's
   line (made once a day and cached there), shows who made it, and offers a
   new one. Mounted by the app into the dashboard. */
(function () {
  "use strict";
  const ctx = () => window.__myday || null;
  const S = { el: null, q: null, busy: false, note: "" };

  const CSS = `
  .mdq{position:relative;overflow:hidden;border-radius:16px;padding:18px 20px 14px;margin-top:16px;
    border:1px solid var(--line);background:var(--card);-webkit-backdrop-filter:blur(20px) saturate(160%);backdrop-filter:blur(20px) saturate(160%);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.07);font:13px/1.45 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink)}
  .mdq.dark{--card:rgba(24,29,38,.58);--ink:#E9EDF3;--muted:#8C97A8;--faint:#5E6878;--line:rgba(255,255,255,.09)}
  .mdq.light{--card:rgba(255,255,255,.62);--ink:#141A21;--muted:#5F6B79;--faint:#8D98A6;--line:rgba(20,30,40,.09)}
  .mdq::before{content:"";position:absolute;inset:0;background:radial-gradient(80% 120% at 0% 0%,rgba(var(--a-rgb),.16),transparent 60%);pointer-events:none}
  .mdq-text{position:relative;font:italic 400 19px/1.45 "Iowan Old Style",Palatino,Georgia,serif;letter-spacing:-.005em;margin:0 0 10px;min-height:28px}
  .mdq-text::before{content:"\\201C";color:var(--a);font-size:26px;margin-right:2px;vertical-align:-3px}
  .mdq-foot{position:relative;display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11.5px;color:var(--faint)}
  .mdq-tag{padding:2px 8px;border-radius:999px;background:rgba(var(--a-rgb),.13);color:var(--a);font-weight:700}
  .mdq-btn{margin-left:auto;border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:9px;padding:5px 10px;font:inherit;cursor:pointer}
  .mdq-btn:hover{color:var(--a);border-color:rgba(var(--a-rgb),.5)}
  .mdq-btn:disabled{opacity:.5;cursor:default}
  `;

  function paint() {
    if (!S.el) return;
    const c = ctx(), acc = (c && c.accent) || "#2FBF87", n = parseInt(acc.slice(1), 16);
    S.el.className = "mdq " + (c && c.isDark === false ? "light" : "dark");
    S.el.style.setProperty("--a", acc);
    S.el.style.setProperty("--a-rgb", `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`);
  }
  function draw() {
    if (!S.el) return;
    paint();
    const q = S.q;
    const text = document.createElement("p"); text.className = "mdq-text";
    text.textContent = q ? q.text : "…";
    const foot = document.createElement("div"); foot.className = "mdq-foot";
    const tag = document.createElement("span"); tag.className = "mdq-tag";
    tag.textContent = q && q.by === "ai" ? "✦ AI-generated" : "From MYDAY's list";
    tag.title = q && q.by === "ai" ? "Written by AI for today. Not a quotation from anyone." : "The AI isn't available, so this is one of MYDAY's own lines.";
    const theme = document.createElement("span"); theme.textContent = q ? `Today's theme: ${q.theme}` : "";
    const btn = document.createElement("button"); btn.className = "mdq-btn";
    btn.textContent = S.busy ? "Thinking…" : "↻ New quote";
    btn.disabled = S.busy || (q && q.refreshesLeft === 0);
    btn.title = q && q.refreshesLeft === 0 ? "That's today's limit — more tomorrow" : `${q ? q.refreshesLeft : ""} left today`;
    btn.onclick = () => load(true);
    foot.append(tag, theme);
    if (S.note) { const n = document.createElement("span"); n.textContent = S.note; foot.append(n); }
    foot.append(btn);
    S.el.replaceChildren(text, foot);
  }
  async function load(refresh) {
    if (S.busy) return;
    S.busy = true; S.note = ""; draw();
    try {
      const r = await fetch(refresh ? "/api/quote/refresh" : "/api/quote", { method: refresh ? "POST" : "GET", credentials: "same-origin" });
      const j = await r.json();
      if (r.ok) { S.q = j; S.note = j.note || ""; } else S.note = j.error || "Couldn't get a quote";
    } catch (e) { S.note = "Couldn't reach the server"; }
    S.busy = false; draw();
  }

  function mount(host) {
    if (!document.getElementById("mdq-css")) { const st = document.createElement("style"); st.id = "mdq-css"; st.textContent = CSS; document.head.appendChild(st); }
    S.el = document.createElement("div");
    host.replaceChildren(S.el);
    draw();
    const today = ctx() && ctx().today;
    if (!S.q || S.q.day !== today) load(false); else draw();
  }
  function unmount() { S.el = null; }

  const prev = window.__mydayTick;
  window.__mydayTick = () => { try { prev && prev(); } catch (e) {} paint(); };
  window.MYDAYQuote = { mount, unmount };
})();
