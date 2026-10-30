/* 🖨 Print on the task pages: today's date card + open tasks on lined paper, in a handwritten style. */
(function () {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  function page(tasks, who) {
    const t = today(), d = new Date();
    const open = tasks.filter((x) => !(x.done || x.completed || x.status === "done"));
    const rank = (x) => (!x.date ? 3 : x.date < t ? 0 : x.date === t ? 1 : 2);
    open.sort((a, b) => rank(a) - rank(b) || String(a.date || "").localeCompare(String(b.date || "")) || String(a.time || "").localeCompare(String(b.time || "")));
    const label = (x) => (!x.date ? "" : x.date < t ? `<span class="od">overdue · ${esc(x.date)}</span>` : x.date === t ? (x.time ? esc(x.time) : "today") : esc(x.date));
    return `<!doctype html><html><head><meta charset="utf-8"><title>Tasks — ${esc(d.toDateString())}</title>
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Patrick+Hand&display=swap" rel="stylesheet">
<style>
  @page{size:A4;margin:12mm}*{box-sizing:border-box}
  body{margin:0;background:#fff;color:#1d2a44;font-family:"Patrick Hand","Segoe Print","Bradley Hand","Comic Sans MS",cursive}
  .paper{position:relative;min-height:100%;padding:26px 30px 30px 74px;background:#fffef8 repeating-linear-gradient(#fffef8 0 31px,#cfdcef 31px 32px);border-radius:6px}
  .paper:before{content:"";position:absolute;top:0;bottom:0;left:56px;width:2px;background:#f2a7a7}
  .top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}
  h1{font-family:Caveat,"Segoe Print",cursive;font-size:40px;font-weight:700;margin:0;line-height:1;color:#22324f}
  .sub{font-size:16px;color:#6a7690;margin-top:4px}
  .card{border:2px solid #22324f;border-radius:12px;padding:6px 14px;text-align:center;background:#fff;box-shadow:3px 3px 0 #22324f;transform:rotate(2deg);min-width:96px}
  .card .m{font-size:15px;letter-spacing:2px;text-transform:uppercase;color:#c0392b}.card .d{font-family:Caveat,cursive;font-size:46px;font-weight:700;line-height:1}.card .w{font-size:15px}
  ol{list-style:none;margin:0;padding:0}
  li{display:flex;gap:12px;align-items:baseline;min-height:32px;line-height:32px;page-break-inside:avoid}
  .box{flex:none;width:17px;height:17px;border:2px solid #22324f;border-radius:4px;transform:translateY(2px) rotate(-3deg)}
  .t{font-size:21px;flex:1}.meta{font-size:14px;color:#6a7690;white-space:nowrap}.od{color:#c0392b}
  .end{margin-top:22px;font-family:Caveat,cursive;font-size:24px;color:#6a7690}
</style></head><body><div class="paper">
  <div class="top"><div><h1>To do today</h1><div class="sub">${open.length} open task${open.length === 1 ? "" : "s"}${who ? " · " + esc(who) : ""}</div></div>
    <div class="card"><div class="m">${d.toLocaleString("en", { month: "short" })} ${d.getFullYear()}</div><div class="d">${d.getDate()}</div><div class="w">${d.toLocaleString("en", { weekday: "long" })}</div></div></div>
  <ol>${open.map((x) => `<li><span class="box"></span><span class="t">${esc(x.title)}</span><span class="meta">${esc(x.category || "")}${x.category && x.date ? " · " : ""}${label(x)}</span></li>`).join("") || "<li><span class='t'>Nothing open — enjoy the day ☺</span></li>"}</ol>
  <div class="end">— done is better than perfect ✓</div>
</div><script>document.fonts&&document.fonts.ready.then(()=>setTimeout(()=>print(),250))<\/script></body></html>`;
  }
  function printTasks() {
    const c = window.__myday; if (!c || !c.state) return;
    let tasks = c.state.tasks || [];
    if (c.space && c.space !== "all") tasks = tasks.filter((x) => !x.space || x.space === c.space);
    const w = window.open("", "_blank"); if (!w) return alert("Allow pop-ups for MYDAY to print.");
    w.document.write(page(tasks, c.me && (c.me.displayName || c.me.username))); w.document.close();
  }
  // Put the button next to the Search box on the task pages.
  setInterval(() => {
    const c = window.__myday; if (!c || !["tasks", "today"].includes(c.view)) return;
    if (document.querySelector("[data-myday-print]")) return;
    const s = [...document.querySelectorAll("main input, input")].find((i) => /search/i.test(i.placeholder || "") && i.offsetParent && !i.closest("header"));
    if (!s) return;
    const b = document.createElement("button");
    b.setAttribute("data-myday-print", "1"); b.title = "Print today's tasks"; b.textContent = "🖨 Print";
    b.style.cssText = "margin-left:8px;border:1px solid rgba(140,151,168,.35);background:rgba(255,255,255,.7);border-radius:999px;padding:7px 14px;cursor:pointer;font:inherit;font-size:14px;color:inherit";
    b.onclick = printTasks;
    (s.parentElement.parentElement || s.parentElement).appendChild(b);
  }, 700);
  window.MYDAYPrint = { page, printTasks };
})();
