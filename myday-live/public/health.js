/* System health: is Gmail being read, is the AI answering, are the news
   sources up, did last night's backup run, when was your data last saved.
   Opened from the light on the Automation menu item or the 🩺 button. */
(function () {
  "use strict";
  const ctx = () => window.__myday || null;
  let el = null;
  const CSS = `
  .myday-led.warn{background:radial-gradient(circle at 35% 30%,#FFF8E6 0%,#FFE08A 22%,#F5C542 55%,#8F6A0B 100%);animation:mdh-amber 1.8s ease-in-out infinite}
  @keyframes mdh-amber{50%{opacity:.4;box-shadow:none}0%,100%{box-shadow:0 0 10px 2px rgba(245,197,66,.6)}}
  .mdh-back{position:fixed;inset:0;z-index:2147483100;background:rgba(5,8,12,.45);display:flex;align-items:center;justify-content:center;padding:16px}
  .mdh{width:min(520px,100%);border-radius:18px;overflow:hidden;font:13.5px/1.45 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg);border:1px solid var(--line);box-shadow:0 40px 100px -30px rgba(0,0,0,.7)}
  .mdh.dark{--bg:rgba(16,20,26,.97);--ink:#E9EDF3;--muted:#8C97A8;--line:rgba(255,255,255,.1);--glass:rgba(255,255,255,.05)}
  .mdh.light{--bg:rgba(250,251,252,.98);--ink:#141A21;--muted:#5F6B79;--line:rgba(20,30,40,.1);--glass:rgba(255,255,255,.85)}
  .mdh h3{margin:0;padding:16px 18px 6px;font:600 19px "Iowan Old Style",Palatino,Georgia,serif}
  .mdh-list{padding:6px 18px 12px;display:grid;gap:7px}
  .mdh-row{display:flex;gap:10px;align-items:flex-start;padding:9px 11px;border:1px solid var(--line);border-radius:11px;background:var(--glass)}
  .mdh-row i{width:10px;height:10px;border-radius:999px;margin-top:5px;flex-shrink:0}
  .mdh-row b{display:block}.mdh-row span{color:var(--muted);font-size:12.5px}
  .mdh-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid var(--line)}
  .mdh-foot button{border:1px solid var(--line);background:var(--glass);color:var(--ink);border-radius:10px;padding:7px 13px;font:inherit;cursor:pointer}`;
  const dot = { ok: "#22C55E", warn: "#F5C542", bad: "#F2545B" };
  async function open() {
    const c = ctx();
    if (!el) { el = document.createElement("div"); el.className = "mdh-back"; el.addEventListener("click", (e) => { if (e.target === el || e.target.hasAttribute("data-x")) close(); if (e.target.hasAttribute("data-again")) open(); }); document.body.appendChild(el); }
    el.innerHTML = `<div class="mdh ${c && c.isDark === false ? "light" : "dark"}"><h3>System health</h3><div class="mdh-list">Checking…</div></div>`;
    let d = null;
    try { const r = await fetch("/api/health/status", { credentials: "same-origin" }); d = await r.json(); } catch (e) {}
    const esc = (s) => String(s || "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
    el.firstChild.querySelector(".mdh-list").innerHTML = d && d.checks ? d.checks.map((x) => `<div class="mdh-row"><i style="background:${dot[x.state]};box-shadow:0 0 8px ${dot[x.state]}"></i><div><b>${esc(x.name)}</b><span>${esc(x.detail)}</span></div></div>`).join("") : "Couldn't reach the server.";
    el.firstChild.insertAdjacentHTML("beforeend", `<div class="mdh-foot"><button data-again>Check again</button><button data-x>Close</button></div>`);
  }
  function close() { if (el) el.remove(); el = null; }
  const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && el) close(); });
  window.MYDAYHealth = { open };
})();
