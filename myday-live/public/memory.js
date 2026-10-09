/* 🧠 AI memory — see what MYDAY's AI knows and has learned, teach it, and
   make it forget. Opened from Automation (🧠 Memory) or Settings. */
(function () {
  "use strict";
  const ctx = () => window.__myday || null;
  let el = null, data = null, filter = "all";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
  const ago = (t) => { const d = Math.round((Date.now() - t) / 864e5); return d < 1 ? "today" : d === 1 ? "yesterday" : d + " days ago"; };
  const say = (x) => x.kind === "inbox"
    ? `Mail from <b>${esc(x.sender || x.domain)}</b> like “${esc(x.pattern)}” → you <b>${x.choice === "needs" ? "wanted to see it" : x.choice === "ignored" ? "ignored it" : "acted on it"}</b>`
    : x.kind === "suggestion" ? `Suggestion “${esc(x.title)}” → you <b>${x.choice === "added" ? "added it" : "skipped it"}</b>`
    : `Invoice from <b>${esc(x.supplier || x.sender)}</b>${x.model ? ` (${esc(x.model)})` : ""}: ${esc(x.field)} “${esc(x.ai)}” → <b>“${esc(x.yours)}”</b>`;

  const CSS = `
  .mdm2-back{position:fixed;inset:0;z-index:2147483100;background:rgba(5,8,12,.5);display:flex;align-items:center;justify-content:center;padding:16px}
  .mdm2{width:min(860px,100%);max-height:calc(100vh - 32px);display:flex;flex-direction:column;border-radius:20px;overflow:hidden;
    font:13.5px/1.45 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg);border:1px solid var(--line);
    -webkit-backdrop-filter:blur(26px) saturate(170%);backdrop-filter:blur(26px) saturate(170%);box-shadow:0 40px 100px -30px rgba(0,0,0,.7)}
  .mdm2.dark{--bg:rgba(16,20,26,.97);--ink:#E9EDF3;--muted:#8C97A8;--faint:#5E6878;--line:rgba(255,255,255,.09);--glass:rgba(255,255,255,.05)}
  .mdm2.light{--bg:rgba(250,251,252,.98);--ink:#141A21;--muted:#5F6B79;--faint:#8D98A6;--line:rgba(20,30,40,.09);--glass:rgba(255,255,255,.85)}
  @media (max-width:700px){.mdm2-back{padding:0}.mdm2{max-height:100vh;height:100%;border-radius:0}}
  .mdm2 *{box-sizing:border-box}.mdm2 button,.mdm2 textarea{font:inherit;color:inherit}
  .mdm2-head{display:flex;gap:10px;padding:16px 18px 10px;border-bottom:1px solid var(--line)}
  .mdm2-head h3{margin:0;font:600 20px "Iowan Old Style",Palatino,Georgia,serif}.mdm2-head p{margin:2px 0 0;color:var(--muted);font-size:12.5px}
  .mdm2-x{margin-left:auto;width:32px;height:32px;border-radius:10px;border:1px solid var(--line);background:var(--glass);cursor:pointer}
  .mdm2-body{overflow:auto;padding:14px 18px;display:grid;gap:12px}
  .mdm2-card{border:1px solid var(--line);background:var(--glass);border-radius:14px;padding:12px 14px}
  .mdm2-card h4{margin:0 0 8px;font-size:13.5px;display:flex;gap:8px;align-items:center}.mdm2-card h4 small{color:var(--faint);font-weight:400}
  .mdm2-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:6px 16px;font-size:12.5px;color:var(--muted)}
  .mdm2-facts b{color:var(--ink)}
  .mdm2 textarea{width:100%;min-height:90px;border:1px solid var(--line);background:var(--bg);border-radius:10px;padding:9px 11px;resize:vertical;outline:none}
  .mdm2 textarea:focus{border-color:var(--a)}
  .mdm2-row{display:flex;gap:8px;align-items:center;margin-top:8px}
  .mdm2-pri{border:0;border-radius:10px;padding:7px 14px;font-weight:700;color:#fff;background:var(--a);cursor:pointer}
  .mdm2-sec{border:1px solid var(--line);background:transparent;border-radius:9px;padding:5px 10px;color:var(--muted);cursor:pointer;font-size:12px}
  .mdm2-chips{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px}
  .mdm2-chip{border:1px solid var(--line);background:transparent;border-radius:999px;padding:4px 11px;color:var(--muted);cursor:pointer;font-size:12px}
  .mdm2-chip.on{border-color:var(--a);color:var(--a);font-weight:700}
  .mdm2-l{display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-bottom:1px solid var(--line);font-size:12.5px}
  .mdm2-l:last-child{border-bottom:0}.mdm2-l span{flex:1}.mdm2-l small{color:var(--faint);white-space:nowrap}
  .mdm2-empty{color:var(--faint);padding:14px;text-align:center}
  `;
  async function load() {
    try { const r = await fetch("/api/memory", { credentials: "same-origin" }); data = r.ok ? await r.json() : null; } catch (e) { data = null; }
  }
  async function open() {
    if (!document.getElementById("mdm2-css")) { const st = document.createElement("style"); st.id = "mdm2-css"; st.textContent = CSS; document.head.appendChild(st); }
    await load(); draw();
  }
  function close() { if (el) el.remove(); el = null; }
  function draw() {
    const c = ctx();
    if (!el) {
      el = document.createElement("div"); el.className = "mdm2-back";
      el.addEventListener("click", async (e) => {
        const t = e.target;
        if (t === el || t.hasAttribute("data-x")) return close();
        if (t.hasAttribute("data-f")) { filter = t.getAttribute("data-f"); return draw(); }
        if (t.hasAttribute("data-save")) {
          await fetch("/api/memory/notes", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ notes: el.querySelector("textarea").value }) });
          c && c.setToast && c.setToast("Saved — the AI will use this from now on"); await load(); return draw();
        }
        const at = t.getAttribute("data-forget");
        if (at) {
          if (at === "all" && !confirm("Forget everything MYDAY has learned from your corrections? Your notes, tasks, mail and auction data stay exactly as they are.")) return;
          await fetch("/api/memory/forget", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ at }) });
          await load(); return draw();
        }
      });
      document.body.appendChild(el);
    }
    const D = data || { facts: { suppliers: [], makes: [], categories: {}, people: [], ownDomains: [] }, notes: "", lessons: [], total: 0, byKind: {} };
    const F = D.facts;
    const lessons = D.lessons.filter((x) => filter === "all" || x.kind === filter);
    const kinds = [["all", "All", D.total], ["inbox", "Email", D.byKind.inbox || 0], ["suggestion", "Suggestions", D.byKind.suggestion || 0], ["invoice", "Invoices", D.byKind.invoice || 0]];
    el.innerHTML = `<div class="mdm2 ${c && c.isDark === false ? "light" : "dark"}" style="--a:${(c && c.accent) || "#2FBF87"}">
      <div class="mdm2-head"><div><h3>🧠 AI memory</h3><p>What MYDAY's AI knows about your world and has learned from you. Every AI feature uses it. It's kept separately — changing it never touches your tasks, mail, invoices or auctions.</p></div><button class="mdm2-x" data-x>✕</button></div>
      <div class="mdm2-body">
        <div class="mdm2-card"><h4>What it knows <small>(read live from your MYDAY)</small></h4>
          <div class="mdm2-facts">
            <div><b>Suppliers:</b> ${F.suppliers.map((s) => `${esc(s.name)} <span style="color:var(--faint)">[${s.grades.map(esc).join(", ")}]</span>`).join("; ") || "none yet"}</div>
            <div><b>Makes:</b> ${F.makes.map((m) => `${esc(m.name)} (${m.models} models)`).join(", ") || "none yet"}</div>
            <div><b>Your company:</b> ${F.ownDomains.map(esc).join(", ") || "—"}</div>
            <div><b>People to watch for:</b> ${F.people.map(esc).join(", ") || "—"}</div>
            <div><b>Categories:</b> ${Object.entries(F.categories || {}).map(([k, v]) => `${esc(k)}: ${(v || []).length}`).join(", ")}</div>
            <div><b>Timezone:</b> ${esc(F.timezone)}</div>
          </div></div>
        <div class="mdm2-card"><h4>Things to know <small>(in your words — the AI reads this every time)</small></h4>
          <textarea placeholder="e.g. Mannapov LLC is our Verizon supplier (Verizon Via MNVP); their grades are DNA–DNE. Rexi sends bid sheets on Mondays. Ignore anything from Dell or Microsoft Store.">${esc(D.notes)}</textarea>
          <div class="mdm2-row"><button class="mdm2-pri" data-save>Save notes</button><span style="color:var(--faint);font-size:12px">Short, plain sentences work best.</span></div></div>
        <div class="mdm2-card"><h4>Learned from you <small>${D.total} lesson${D.total === 1 ? "" : "s"} — from what you ignore, keep, add, skip and correct</small>
            ${D.total ? `<button class="mdm2-sec" style="margin-left:auto" data-forget="all">Forget all</button>` : ""}</h4>
          <div class="mdm2-chips">${kinds.map(([k, l, n]) => `<button class="mdm2-chip ${filter === k ? "on" : ""}" data-f="${k}">${l} · ${n}</button>`).join("")}</div>
          ${lessons.length ? lessons.map((x) => `<div class="mdm2-l"><span>${say(x)}${x.times > 1 ? ` <small>· ${x.times}×</small>` : ""}</span><small>${ago(x.at)}</small><button class="mdm2-sec" data-forget="${x.at}" title="Forget this lesson">Forget</button></div>`).join("")
            : `<div class="mdm2-empty">Nothing learned yet. As you ignore, keep, add or correct things, the lessons show up here — and the AI starts following them.</div>`}
        </div>
      </div></div>`;
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && el) close(); });
  window.MYDAYMemory = { open, close };
})();
