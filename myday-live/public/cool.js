/* ✨ MYDAY extras
 *   📷 Snap & know   — photo of a phone/box/About screen → model, Apple trade-in, your prices, open tasks
 *   🎧 Briefing      — Max reads you a one-minute morning briefing
 *   ⏱ Bid board      — full-screen countdowns to today's and tomorrow's bid deadlines
 *   👁 Price watch   — alerts when a watched model's trade-in value or your prices move
 *   📱 Widget        — a home-screen widget (Scriptable app) from a private read-only link
 * Opens from the ✨ button in the top bar. Nothing here changes your data except
 * the watchlist, which you edit yourself.
 */
(function () {
  "use strict";
  const ctx = () => window.__myday || null;
  const money = (n) => (n == null || isNaN(n) ? "—" : Number(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
  const norm = (s) => String(s || "").toLowerCase().replace(/^apple\s+/, "").replace(/[^a-z0-9]/g, "");
  const post = (u, b) => fetch(u, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(b || {}) })
    .then((r) => r.json().then((j) => ({ ok: r.ok, j }))).catch(() => ({ ok: false, j: { error: "Couldn't reach the server" } }));

  /* ---------- a shared window ---------- */
  let win = null;
  function sheet(title, sub, html, wide) {
    const c = ctx();
    if (!win) {
      win = document.createElement("div"); win.className = "mdc2-back";
      win.addEventListener("click", (e) => { if (e.target === win || e.target.hasAttribute("data-x")) close(); });
      document.body.appendChild(win);
    }
    win.innerHTML = `<div class="mdc2 ${c && c.isDark === false ? "light" : "dark"} ${wide ? "wide" : ""}" style="--a:${(c && c.accent) || "#2FBF87"}">
      <div class="mdc2-head"><div><h3>${title}</h3>${sub ? `<p>${sub}</p>` : ""}</div><button class="mdc2-x" data-x>✕</button></div><div class="mdc2-body">${html}</div></div>`;
    return win.firstChild;
  }
  function close() { stopSpeech(); clearInterval(boardTimer); if (win) win.remove(); win = null; }

  /* ---------- ✨ menu ---------- */
  function menu(anchor) {
    const items = [["snap", "📷", "Snap & know", "Photo of a phone → model, trade-in, your prices"], ["brief", "🎧", "Morning briefing", "One minute, read aloud"],
      ["board", "⏱", "Bid board", "Countdowns to bid deadlines"], ["watch", "👁", "Price watch", alerts().length ? `${alerts().length} alert${alerts().length === 1 ? "" : "s"}` : "Models you're tracking"],
      ["widget", "📱", "Home-screen widget", "Today at a glance on your phone"]];
    const m = sheet("✨ Extras", "", `<div class="mdc2-menu">${items.map(([k, i, t, s]) => `<button data-go="${k}"><span>${i}</span><b>${t}</b><small>${esc(s)}</small></button>`).join("")}</div>`);
    m.addEventListener("click", (e) => { const b = e.target.closest("[data-go]"); if (!b) return; ({ snap, brief, board, watchlist: watchPanel, watch: watchPanel, widget })[b.dataset.go](); });
  }

  /* ---------- 📷 Snap & know ---------- */
  function snap() {
    const el = sheet("📷 Snap & know", "Take a photo of the phone, its box label, its Settings → About screen, or the IMEI sticker.",
      `<label class="mdc2-drop"><input type="file" accept="image/*" capture="environment" hidden><b>Take or choose a photo</b><small>Works best in good light, close up</small></label><div class="mdc2-out"></div>`);
    el.querySelector("input").addEventListener("change", async (e) => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      const out = el.querySelector(".mdc2-out"); out.innerHTML = `<p class="mdc2-dim">Looking…</p>`;
      const img = await shrink(f);
      const { ok, j } = await post("/api/snap", { image: img, mime: "image/jpeg" });
      if (!ok) { out.innerHTML = `<p class="mdc2-warn">${esc(j.error)}</p>`; return; }
      const M = window.MYDAYModels, c = ctx();
      const model = M && j.model ? M.clean(j.make, j.model).model : j.model;
      const mine = window.MYDAYTradeIn ? window.MYDAYTradeIn.yours()[norm(model)] : null;
      const entries = ((c && c.state.entries) || []).filter((x) => norm(x.model) === norm(model));
      if (window.MYDAYTradeIn && model) {
        const tl = await window.MYDAYTradeIn.lookup(model, 10);
        j.trade = tl.rows.find((x) => norm(x.model) === norm(model)) || null;
      }
      const tasks = ((c && c.state.tasks) || []).filter((t) => model && new RegExp(model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(t.title) && !Object.keys(t.done || {}).length);
      out.innerHTML = j.confidence < 0.4 || !model ? `<p class="mdc2-warn">Couldn't tell for sure. ${esc(j.seen)}</p>` : `
        <div class="mdc2-hero"><small>${esc(j.make)}</small><h2>${esc(model)}${j.storage ? ` <span>${esc(j.storage)}</span>` : ""}</h2>
          <p class="mdc2-dim">${esc(j.seen)}${j.colour ? " · " + esc(j.colour) : ""}${j.carrier ? " · " + esc(j.carrier) : ""} · ${Math.round(j.confidence * 100)}% sure</p>
          ${j.imei ? `<p>IMEI <b>${esc(j.imei)}</b> <button class="mdc2-sec" data-copy="${esc(j.imei)}">Copy</button></p>` : ""}</div>
        <div class="mdc2-grid">
          <div><small>Apple trade-in (up to)</small><b>${j.trade ? money(j.trade.value) : "—"}</b><span>${j.trade && j.trade.change ? (j.trade.change > 0 ? "▲ " : "▼ ") + money(Math.abs(j.trade.change)) : j.trade ? "no recent change" : "not in Apple's list"}</span></div>
          <div><small>You paid (30-day avg)</small><b>${mine ? money(mine.avg) : "—"}</b><span>${mine ? mine.units + " units" : "none recently"}</span></div>
          <div><small>In your Auction table</small><b>${entries.reduce((n, x) => n + (+x.qty || 1), 0)}</b><span>units · ${entries.length} lines</span></div>
          <div><small>Open tasks</small><b>${tasks.length}</b><span>${tasks.slice(0, 2).map((t) => esc(t.title)).join(" · ") || "none"}</span></div>
        </div>
        <div class="mdc2-row"><button class="mdc2-pri" data-watch="${esc(model)}">👁 Watch this model</button>
          <button class="mdc2-sec" data-ti="${esc(model)}">Open in Apple Trade-In</button></div>`;
      out.onclick = (ev) => {
        const t = ev.target;
        if (t.dataset.copy) { navigator.clipboard && navigator.clipboard.writeText(t.dataset.copy); t.textContent = "Copied"; }
        if (t.dataset.watch) { watch(t.dataset.watch).then(() => { t.textContent = "Watching ✓"; }); }
        if (t.dataset.ti && window.MYDAYTradeIn) { close(); window.MYDAYTradeIn.open(t.dataset.ti); }
      };
    });
  }
  function shrink(file) {
    return new Promise((res) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 1400 / Math.max(img.width, img.height)), cv = document.createElement("canvas");
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
        res(cv.toDataURL("image/jpeg", 0.82).split(",")[1]);
      };
      img.src = url;
    });
  }

  /* ---------- 🎧 Morning briefing ---------- */
  let utter = null;
  function stopSpeech() { try { speechSynthesis.cancel(); } catch (e) {} utter = null; }
  async function brief(fresh) {
    const el = sheet("🎧 Morning briefing", "Max reads you the day in about a minute. Made fresh once a day.", `<p class="mdc2-dim">Writing today's briefing…</p>`);
    const context = window.MYDAYAssistant && window.MYDAYAssistant.context ? window.MYDAYAssistant.context() : {};
    delete context.auctionHistory;
    const { ok, j } = await post("/api/briefing", { context, fresh: !!fresh });
    if (!win || win.firstChild !== el) return;
    el.querySelector(".mdc2-body").innerHTML = ok ? `
      <div class="mdc2-row"><button class="mdc2-pri" data-play>▶ Play</button><button class="mdc2-sec" data-stop>⏸ Stop</button>
        <button class="mdc2-sec" data-new>↻ Make a new one</button><span class="mdc2-dim">${new Date(j.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span></div>
      <p class="mdc2-script">${esc(j.script).replace(/\n/g, "<br>")}</p>
      <p class="mdc2-dim">Plays with your device's voice. Keep the screen on while it plays.</p>` : `<p class="mdc2-warn">${esc(j.error)}</p>`;
    el.onclick = (e) => {
      if (e.target.hasAttribute("data-play")) { stopSpeech(); utter = new SpeechSynthesisUtterance(j.script); utter.rate = 1.02; utter.lang = "en-US"; speechSynthesis.speak(utter); }
      if (e.target.hasAttribute("data-stop")) stopSpeech();
      if (e.target.hasAttribute("data-new")) { stopSpeech(); brief(true); }
    };
  }

  /* ---------- ⏱ Bid board ---------- */
  let boardTimer = null;
  function deadlines() {
    const c = ctx(); if (!c) return [];
    const tomorrow = (() => { const d = new Date(c.today + "T12:00:00"); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();
    return ((c.state && c.state.tasks) || []).filter((t) => {
      const done = t.done && Object.keys(t.done).length;
      const day = t.deadline || ((/bid|auction|lot/i.test(t.title) && t.time) ? t.date : "");
      return !done && day && day >= c.today && day <= tomorrow;
    }).map((t) => {
      const day = t.deadline || t.date, time = t.deadlineTime || t.time || "23:59";
      return { t, at: new Date(`${day}T${time}:00`).getTime(), label: t.title.replace(/^Review bid file:\s*/i, ""), timeText: t.deadlineTime || t.time ? new Date(`${day}T${time}:00`).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }) : day + " (no time given)" };
    }).sort((a, b) => a.at - b.at);
  }
  function board() {
    const el = sheet("⏱ Bid board", "Today's and tomorrow's bid deadlines. Leave it open on a second screen.", "", true);
    el.classList.add("board");
    const draw = () => {
      const list = deadlines(), now = Date.now();
      const left = (ms) => { if (ms <= 0) return "closed"; const h = Math.floor(ms / 3600e3), m = Math.floor(ms % 3600e3 / 60e3), s = Math.floor(ms % 60e3 / 1000); return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`; };
      el.querySelector(".mdc2-body").innerHTML = `${list.length ? `<div class="mdc2-board">${list.map((x) => { const ms = x.at - now, cls = ms <= 0 ? "gone" : ms < 30 * 60e3 ? "red" : ms < 2 * 3600e3 ? "amber" : "ok";
          return `<div class="mdc2-bid ${cls}"><small>${esc(x.timeText)}</small><b>${esc(x.label)}</b><div class="clock">${left(ms)}</div></div>`; }).join("")}</div>`
        : `<p class="mdc2-dim" style="text-align:center;padding:30px">No bid deadlines today or tomorrow. They appear here from bid-file tasks, or any task with "bid", "auction" or "lot" in the title and a time.</p>`}
        <div class="mdc2-check"><input placeholder="Price check — type a model, e.g. iphone 13 pro" value="${esc(boardQ)}"><div class="mdc2-res"></div></div>`;
      const inp = el.querySelector(".mdc2-check input");
      inp.oninput = () => { boardQ = inp.value; priceCheck(inp.value, el.querySelector(".mdc2-res")); };
      priceCheck(boardQ, el.querySelector(".mdc2-res"));
    };
    draw();
    clearInterval(boardTimer);
    boardTimer = setInterval(() => {
      if (!win || !win.firstChild.classList.contains("board")) return clearInterval(boardTimer);
      const a = document.activeElement; if (a && a.tagName === "INPUT") { // keep typing smooth: update clocks only
        const list = deadlines(), now = Date.now();
        win.querySelectorAll(".mdc2-bid .clock").forEach((c, i) => { const ms = list[i] ? list[i].at - now : 0; c.textContent = ms <= 0 ? "closed" : `${Math.floor(ms / 3600e3)}:${String(Math.floor(ms % 3600e3 / 60e3)).padStart(2, "0")}:${String(Math.floor(ms % 60e3 / 1000)).padStart(2, "0")}`; });
      } else draw();
    }, 1000);
  }
  let boardQ = "";
  async function priceCheck(q, box) {
    if (!box) return;
    if (!q || q.trim().length < 3 || !window.MYDAYTradeIn) { box.innerHTML = ""; return; }
    const r = await window.MYDAYTradeIn.lookup(q, 6);
    box.innerHTML = r.rows.length ? r.rows.map((x) => { const y = r.mine[norm(x.model)];
      return `<div><b>${esc(x.model)}</b><span>Apple up to <b>${money(x.value)}</b></span><span>${y ? "you paid " + money(y.avg) : ""}</span></div>`; }).join("") : `<p class="mdc2-dim">No trade-in match.</p>`;
  }

  /* ---------- 👁 Price watch ---------- */
  const watched = () => { const c = ctx(); return (c && c.state && c.state.prefs && c.state.prefs.watch) || []; };
  let tradeCache = null;
  async function loadTrade() {
    try { const r = await fetch("/api/tradein", { credentials: "same-origin" }); if (r.ok) tradeCache = await r.json(); } catch (e) {}
    return tradeCache;
  }
  async function watch(model) {
    const c = ctx(); if (!c || !model) return false;
    if (watched().some((w) => norm(w.model) === norm(model))) return true;
    if (!tradeCache) await loadTrade();
    const t = tradeCache && (tradeCache.rows || []).find((x) => norm(x.model) === norm(model));
    c.setPref({ watch: [...watched(), { model: t ? t.model : model, at: Date.now(), trade: t ? t.value : null }] });
    c.setToast && c.setToast(`Watching ${t ? t.model : model}${t ? ` — Apple up to $${t.value} now` : ""}`);
    return true;
  }
  function unwatch(model) { const c = ctx(); c.setPref({ watch: watched().filter((w) => norm(w.model) !== norm(model)) }); }
  function ack(model) {
    const c = ctx(); const t = tradeCache && tradeCache.rows.find((x) => norm(x.model) === norm(model));
    c.setPref({ watch: watched().map((w) => norm(w.model) === norm(model) ? { ...w, trade: t ? t.value : w.trade, ackAt: Date.now() } : w) });
  }
  function avg(list) { const q = list.reduce((n, e) => n + (+e.qty || 1), 0); return q ? list.reduce((n, e) => n + (+e.price) * (+e.qty || 1), 0) / q : null; }
  function alerts() {
    const c = ctx(); if (!c) return [];
    const out = [], entries = (c.state.entries || []).filter((e) => e.date && +e.price > 0 && e.status !== "lost");
    const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
    for (const w of watched()) {
      const t = tradeCache && tradeCache.rows.find((x) => norm(x.model) === norm(w.model));
      if (t && w.trade != null && t.value !== w.trade) out.push({ model: w.model, kind: "trade", text: `Apple trade-in ${t.value > w.trade ? "up" : "down"} ${money(Math.abs(t.value - w.trade))} to ${money(t.value)} (was ${money(w.trade)})` });
      const mine = entries.filter((e) => norm(e.model) === norm(w.model));
      const recent = mine.filter((e) => e.date >= day(7)), before = mine.filter((e) => e.date < day(7) && e.date >= day(37));
      const a = avg(recent), b = avg(before);
      if (a && b && Math.abs(a - b) / b >= 0.05) out.push({ model: w.model, kind: "drift", text: `Your buy price this week ${money(a)} vs ${money(b)} the month before (${a > b ? "+" : ""}${Math.round(((a - b) / b) * 100)}%)` });
      for (const e of recent.filter((x) => x.source && x.source.kind === "invoice")) {
        if (b && Math.abs(e.price - b) / b >= 0.1) out.push({ model: w.model, kind: "invoice", text: `${e.supplier} invoice: ${money(e.price)} each (${e.grade}) — ${e.price > b ? "above" : "below"} your usual ${money(b)}` });
      }
    }
    return out;
  }
  async function watchPanel() {
    await loadTrade();
    const draw = () => {
      const list = watched(), al = alerts();
      const el = sheet("👁 Price watch", "Models you're tracking. Alerts when Apple's trade-in value moves, your buy price drifts 5%+, or an invoice line is 10%+ off your usual.", `
        <div class="mdc2-row"><input class="mdc2-in" placeholder="Add a model, e.g. iPhone 13 Pro"><button class="mdc2-pri" data-add>Watch</button></div>
        ${al.length ? `<div class="mdc2-alerts">${al.map((a) => `<div><b>${esc(a.model)}</b><span>${esc(a.text)}</span>${a.kind === "trade" ? `<button class="mdc2-sec" data-ack="${esc(a.model)}">Got it</button>` : ""}</div>`).join("")}</div>` : `<p class="mdc2-dim">No alerts right now.</p>`}
        ${list.length ? `<div class="mdc2-list">${list.map((w) => { const t = tradeCache && tradeCache.rows.find((x) => norm(x.model) === norm(w.model)); const y = window.MYDAYTradeIn ? window.MYDAYTradeIn.yours()[norm(w.model)] : null;
          return `<div><b>${esc(w.model)}</b><span>Apple ${t ? money(t.value) : "—"}</span><span>you ${y ? money(y.avg) : "—"}</span><button class="mdc2-sec" data-un="${esc(w.model)}">Stop</button></div>`; }).join("")}</div>`
          : `<p class="mdc2-dim">Not watching anything yet. Add a model above, tap 👁 on a Snap result, or tell Max "watch iPhone 13 Pro".</p>`}`);
      el.onclick = (e) => {
        const t = e.target;
        if (t.hasAttribute("data-add")) { const v = el.querySelector(".mdc2-in").value.trim(); if (v) watch(v).then(() => setTimeout(draw, 120)); }
        if (t.dataset.un) { unwatch(t.dataset.un); setTimeout(draw, 120); }
        if (t.dataset.ack) { ack(t.dataset.ack); setTimeout(draw, 120); }
      };
    };
    draw();
  }

  /* ---------- 📱 Widget ---------- */
  async function widget() {
    const s = await fetch("/api/widget/token", { credentials: "same-origin" }).then((r) => r.json()).catch(() => ({}));
    const el = sheet("📱 Home-screen widget", "Today at a glance on your iPhone or iPad home screen, using the free Scriptable app.", `
      <ol class="mdc2-steps"><li>Install <b>Scriptable</b> from the App Store (free).</li><li>Tap <b>Make my widget link</b> below, then <b>Copy script</b>.</li>
        <li>In Scriptable, tap <b>+</b>, paste, and name it <b>MYDAY</b>.</li><li>On your home screen, add a <b>Scriptable</b> widget, edit it, and choose <b>MYDAY</b>.</li></ol>
      <div class="mdc2-row"><button class="mdc2-pri" data-make>${s.on ? "Make a new link (old one stops)" : "Make my widget link"}</button>${s.on ? `<button class="mdc2-sec" data-off>Switch the link off</button>` : ""}</div>
      <div class="mdc2-out"></div>
      <p class="mdc2-dim">The link only shows a summary (next task, how many today, bids closing, invoices waiting). It can't change anything, and you can switch it off any time.</p>`);
    el.onclick = async (e) => {
      if (e.target.hasAttribute("data-off")) { await post("/api/widget/token", { off: true }); widget(); }
      if (e.target.hasAttribute("data-make")) {
        const { j } = await post("/api/widget/token", {});
        const link = `${location.origin}/api/widget?t=${j.token}`;
        const script = scriptFor(link);
        el.querySelector(".mdc2-out").innerHTML = `<textarea class="mdc2-code" readonly>${esc(script)}</textarea><div class="mdc2-row"><button class="mdc2-pri" data-copyscript>Copy script</button></div>`;
        el.querySelector("[data-copyscript]").onclick = (ev) => { navigator.clipboard && navigator.clipboard.writeText(script); ev.target.textContent = "Copied ✓"; };
      }
    };
  }
  const scriptFor = (link) => `// MYDAY widget for Scriptable
const r = await new Request(${JSON.stringify(link)}).loadJSON();
const w = new ListWidget();
w.backgroundGradient = Object.assign(new LinearGradient(), { colors: [new Color("#0F2A22"), new Color("#10141A")], locations: [0, 1] });
const t = w.addText("MYDAY"); t.font = Font.boldSystemFont(13); t.textColor = new Color("#2FBF87");
w.addSpacer(4);
if (r.error) { const e = w.addText(r.error); e.font = Font.systemFont(11); e.textColor = Color.white(); }
else {
  const n = w.addText(r.next ? (r.next.overdue ? "Overdue: " : "Next: ") + r.next.title + (r.next.time ? " · " + r.next.time : "") : "Nothing left today 🎉");
  n.font = Font.semiboldSystemFont(14); n.textColor = Color.white(); n.lineLimit = 2;
  w.addSpacer(4);
  const s = w.addText(r.today + " to do · " + r.invoices + " invoice" + (r.invoices === 1 ? "" : "s") + " waiting");
  s.font = Font.systemFont(11); s.textColor = new Color("#8C97A8");
  for (const b of r.bids || []) { const x = w.addText("⏱ " + b.title + " — " + b.when); x.font = Font.systemFont(11); x.textColor = new Color("#F5C542"); x.lineLimit = 1; }
}
w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
Script.setWidget(w); Script.complete(); w.presentMedium();`;

  /* ---------- look ---------- */
  const CSS = `
  .mdc2-back{position:fixed;inset:0;z-index:2147483050;background:rgba(5,8,12,.5);display:flex;align-items:center;justify-content:center;padding:16px}
  .mdc2{width:min(620px,100%);max-height:calc(100vh - 32px);display:flex;flex-direction:column;border-radius:20px;overflow:hidden;
    font:13.5px/1.45 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg);border:1px solid var(--line);
    -webkit-backdrop-filter:blur(26px) saturate(170%);backdrop-filter:blur(26px) saturate(170%);box-shadow:0 40px 100px -30px rgba(0,0,0,.7)}
  .mdc2.wide{width:min(1200px,100%);height:calc(100vh - 32px)}
  .mdc2.dark{--bg:rgba(16,20,26,.97);--ink:#E9EDF3;--muted:#8C97A8;--faint:#5E6878;--line:rgba(255,255,255,.09);--glass:rgba(255,255,255,.05)}
  .mdc2.light{--bg:rgba(250,251,252,.98);--ink:#141A21;--muted:#5F6B79;--faint:#8D98A6;--line:rgba(20,30,40,.09);--glass:rgba(255,255,255,.85)}
  @media (max-width:700px){.mdc2-back{padding:0}.mdc2{max-height:100vh;height:100%;border-radius:0}}
  .mdc2 *{box-sizing:border-box}.mdc2 button,.mdc2 input,.mdc2 textarea{font:inherit;color:inherit}
  .mdc2-head{display:flex;gap:10px;padding:16px 18px 10px;border-bottom:1px solid var(--line)}
  .mdc2-head h3{margin:0;font:600 20px "Iowan Old Style",Palatino,Georgia,serif}.mdc2-head p{margin:2px 0 0;color:var(--muted);font-size:12.5px}
  .mdc2-x{margin-left:auto;width:32px;height:32px;border-radius:10px;border:1px solid var(--line);background:var(--glass);cursor:pointer;flex-shrink:0}
  .mdc2-body{overflow:auto;padding:14px 18px 18px;display:grid;gap:12px;align-content:start;flex:1}
  .mdc2-menu{display:grid;gap:8px}
  .mdc2-menu button{display:grid;grid-template-columns:34px 1fr;grid-template-rows:auto auto;column-gap:10px;text-align:left;padding:11px 13px;border-radius:14px;border:1px solid var(--line);background:var(--glass);cursor:pointer}
  .mdc2-menu button:hover{border-color:var(--a)}.mdc2-menu span{grid-row:1/3;font-size:24px;align-self:center}.mdc2-menu small{color:var(--muted)}
  .mdc2-drop{display:grid;place-items:center;gap:4px;padding:26px;border:2px dashed var(--line);border-radius:16px;cursor:pointer;text-align:center}
  .mdc2-drop:hover{border-color:var(--a)}.mdc2-drop small,.mdc2-dim{color:var(--muted);font-size:12.5px;margin:0}
  .mdc2-warn{color:#C9A227;margin:0}
  .mdc2-hero h2{margin:0;font:600 24px "Iowan Old Style",Palatino,Georgia,serif}.mdc2-hero h2 span{color:var(--muted);font-size:17px}.mdc2-hero small{color:var(--a);font-weight:700}
  .mdc2-hero p{margin:4px 0 0}
  .mdc2-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}
  .mdc2-grid>div{border:1px solid var(--line);background:var(--glass);border-radius:12px;padding:9px 11px}
  .mdc2-grid small{display:block;color:var(--faint);font-size:11px}.mdc2-grid b{display:block;font-size:19px}.mdc2-grid span{color:var(--muted);font-size:11.5px}
  .mdc2-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .mdc2-pri{border:0;border-radius:10px;padding:8px 14px;font-weight:700;color:#fff;background:var(--a);cursor:pointer}
  .mdc2-sec{border:1px solid var(--line);background:transparent;border-radius:9px;padding:6px 11px;color:var(--muted);cursor:pointer}
  .mdc2-script{font:17px/1.6 "Iowan Old Style",Palatino,Georgia,serif;margin:0}
  .mdc2-board{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
  .mdc2-bid{border-radius:18px;padding:16px;border:1px solid var(--line);background:var(--glass)}
  .mdc2-bid small{color:var(--muted)}.mdc2-bid b{display:block;font-size:17px;margin:4px 0 8px}
  .mdc2-bid .clock{font:300 46px ui-sans-serif,-apple-system,sans-serif;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
  .mdc2-bid.ok .clock{color:var(--a)}.mdc2-bid.amber{border-color:#F5C542}.mdc2-bid.amber .clock{color:#F5C542}
  .mdc2-bid.red{border-color:#F2545B;animation:mdc2-pulse 1s infinite}.mdc2-bid.red .clock{color:#F2545B}.mdc2-bid.gone{opacity:.45}
  @keyframes mdc2-pulse{50%{box-shadow:0 0 0 6px rgba(242,84,91,.2)}}
  .mdc2-check input,.mdc2-in{width:100%;border:1px solid var(--line);background:var(--glass);border-radius:12px;padding:10px 12px;outline:none}
  .mdc2-in{width:auto;flex:1}
  .mdc2-res>div,.mdc2-list>div,.mdc2-alerts>div{display:flex;gap:12px;align-items:center;padding:8px 2px;border-bottom:1px solid var(--line)}
  .mdc2-res b:first-child,.mdc2-list b,.mdc2-alerts b{flex:1}.mdc2-res span,.mdc2-list span{color:var(--muted);min-width:120px}
  .mdc2-alerts{border:1px solid rgba(245,197,66,.5);border-radius:12px;padding:4px 12px;background:rgba(245,197,66,.06)}.mdc2-alerts span{color:var(--ink);flex:2}
  .mdc2-steps{margin:0;padding-left:20px;color:var(--muted)}.mdc2-steps b{color:var(--ink)}
  .mdc2-code{width:100%;min-height:150px;font:11.5px ui-monospace,Menlo,monospace;border:1px solid var(--line);background:var(--glass);border-radius:10px;padding:10px}
  `;
  function boot() {
    const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && win) close(); });
    // Once a day, a gentle nudge if a watched model has alerts.
    setTimeout(async () => {
      const c = ctx(); if (!c || !watched().length) return;
      try { const r = await fetch("/api/tradein", { credentials: "same-origin" }); if (r.ok) tradeCache = await r.json(); } catch (e) {}
      const n = alerts().length, k = "myday_watch_nudge";
      if (n && localStorage.getItem(k) !== c.today) { try { localStorage.setItem(k, c.today); } catch (e) {} c.setToast && c.setToast(`👁 ${n} price alert${n === 1 ? "" : "s"} on models you watch — ✨ → Price watch`); }
    }, 6000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  window.MYDAYCool = { menu, snap, brief, board, watch, watchPanel, widget, alerts };
})();
