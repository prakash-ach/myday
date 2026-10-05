/* Phone Industry News — the screen.
 *
 * Shows what the server gathered from public feeds: headline (linking to the
 * original), source, real publication date, a short summary in MYDAY's own
 * words (or the feed's own short description, credited, when there's no AI
 * summary), why it may matter, and Official / Confirmed / Rumor. The same
 * story from several sites is one card with "also covered by". Filter by
 * brand, topic and whether to include rumors. Shows when it last refreshed
 * and which sources are working.
 */
(function () {
  "use strict";
  const ctx = () => window.__myday || null;
  const S = { host: null, data: null, brand: "All", topic: "All", rumors: true, busy: false, msg: "", showSources: false };
  const BRANDS = ["All", "Apple", "Google", "Samsung", "Motorola", "OnePlus", "Xiaomi", "Nothing", "Other"];
  const TOPICS = ["All", "Launches", "iOS", "Android", "Security", "Repair & parts", "Resale & trade-in", "Carriers", "Business"];

  const CSS = `
  .mdn{font:13.5px/1.5 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);padding-bottom:30px}
  .mdn.dark{--card:rgba(24,29,38,.58);--ink:#E9EDF3;--muted:#8C97A8;--faint:#5E6878;--line:rgba(255,255,255,.09);--chip:rgba(255,255,255,.05)}
  .mdn.light{--card:rgba(255,255,255,.66);--ink:#141A21;--muted:#5F6B79;--faint:#8D98A6;--line:rgba(20,30,40,.09);--chip:rgba(255,255,255,.7)}
  .mdn *{box-sizing:border-box}
  .mdn h1{font:600 30px "Iowan Old Style",Palatino,Georgia,serif;letter-spacing:-.02em;margin:22px 0 2px}
  .mdn-sub{color:var(--muted);margin:0 0 14px;font-size:13px}
  .mdn-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
  .mdn-fresh{font-size:12px;color:var(--faint)}
  .mdn-btn{border:1px solid var(--line);background:var(--chip);color:var(--muted);border-radius:10px;padding:6px 12px;font:inherit;font-size:12.5px;cursor:pointer}
  .mdn-btn:hover{color:var(--a);border-color:rgba(var(--a-rgb),.5)}
  .mdn-btn:disabled{opacity:.5;cursor:default}
  .mdn-row{display:flex;gap:5px;flex-wrap:wrap;margin:6px 0}
  .mdn-lbl{font-size:11px;color:var(--faint);width:52px;padding-top:6px}
  .mdn-chip{border:1px solid var(--line);background:var(--chip);color:var(--muted);border-radius:999px;padding:4px 11px;font:inherit;font-size:12px;cursor:pointer}
  .mdn-chip.on{border-color:var(--a);color:var(--a);background:rgba(var(--a-rgb),.12);font-weight:700}
  .mdn-warn{margin:10px 0;padding:9px 12px;border-radius:10px;background:rgba(245,197,66,.12);color:#C9A227;font-size:12.5px}
  .mdn-list{display:grid;gap:11px;margin-top:12px}
  .mdn-card{border:1px solid var(--line);background:var(--card);border-radius:16px;padding:14px 16px;
    -webkit-backdrop-filter:blur(20px) saturate(160%);backdrop-filter:blur(20px) saturate(160%);box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
  .mdn-card.rumor{border-style:dashed}
  .mdn-top{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px}
  .mdn-st{font-size:10.5px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;padding:2px 8px;border-radius:999px}
  .mdn-st.official{background:rgba(var(--a-rgb),.18);color:var(--a)}
  .mdn-st.confirmed{background:rgba(76,141,246,.16);color:#4C8DF6}
  .mdn-st.rumor{background:rgba(245,197,66,.16);color:#C9A227}
  .mdn-tag{font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:1px 8px}
  .mdn-card h3{margin:0 0 4px;font-size:15.5px;line-height:1.35}
  .mdn-card h3 a{color:inherit;text-decoration:none}
  .mdn-card h3 a:hover{color:var(--a);text-decoration:underline}
  .mdn-meta{font-size:12px;color:var(--faint);margin-bottom:6px}
  .mdn-sum{margin:0 0 6px;color:var(--ink)}
  .mdn-src{font-size:11px;color:var(--faint)}
  .mdn-why{margin:8px 0 0;padding:8px 10px;border-radius:10px;background:rgba(var(--a-rgb),.08);border:1px solid rgba(var(--a-rgb),.22);font-size:12.5px}
  .mdn-why b{color:var(--a)}
  .mdn-also{margin-top:8px;font-size:12px;color:var(--muted)}
  .mdn-also a{color:var(--muted)}
  .mdn-empty{padding:30px;text-align:center;color:var(--muted)}
  .mdn-srcs{display:grid;gap:4px;margin-top:8px;font-size:12px}
  .mdn-srcs div{display:flex;gap:8px}
  .mdn-dot{width:8px;height:8px;border-radius:999px;margin-top:6px;flex-shrink:0}
  `;
  const esc = (s) => String(s == null ? "" : s);
  const ago = (t) => {
    if (!t) return "";
    const s = Math.round((Date.now() - t) / 1000);
    return s < 90 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " days ago";
  };
  const fmtDate = (t) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : "numeric", hour: "numeric", minute: "2-digit" });

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.appendChild(typeof kid === "string" || typeof kid === "number" ? document.createTextNode(String(kid)) : kid);
    }
    return el;
  }
  const safeLink = (u) => (/^https?:\/\//i.test(u || "") ? u : null);

  function draw() {
    if (!S.host) return;
    const c = ctx(), acc = (c && c.accent) || "#2FBF87", n = parseInt(acc.slice(1), 16);
    const D = S.data;
    const root = h("div", { class: "mdn " + (c && c.isDark === false ? "light" : "dark") });
    root.style.setProperty("--a", acc);
    root.style.setProperty("--a-rgb", `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`);

    const stale = D && D.lastSuccess && Date.now() - D.lastSuccess > 3 * 3600e3;
    root.append(
      h("h1", null, "Phone Industry News"),
      h("p", { class: "mdn-sub" }, "Apple, Google, Samsung, Motorola and more — launches, updates, security, repair and resale. From public feeds; every story links to its original."),
      h("div", { class: "mdn-bar" },
        h("span", { class: "mdn-fresh" }, D ? (D.lastRefresh ? `Last refreshed ${ago(D.lastRefresh)} (${fmtDate(D.lastRefresh)})` : "Not refreshed yet") : "Loading…"),
        h("button", { class: "mdn-btn", disabled: S.busy || null, onclick: refresh }, S.busy ? "Refreshing…" : "↻ Refresh"),
        h("button", { class: "mdn-btn", onclick: () => { S.showSources = !S.showSources; draw(); } }, S.showSources ? "Hide sources" : "Sources"),
        S.msg ? h("span", { class: "mdn-fresh" }, S.msg) : null),
      h("div", { class: "mdn-row" }, h("span", { class: "mdn-lbl" }, "Brand"),
        BRANDS.map((b) => h("button", { class: "mdn-chip" + (S.brand === b ? " on" : ""), onclick: () => { S.brand = b; draw(); } }, b))),
      h("div", { class: "mdn-row" }, h("span", { class: "mdn-lbl" }, "Topic"),
        TOPICS.map((t) => h("button", { class: "mdn-chip" + (S.topic === t ? " on" : ""), onclick: () => { S.topic = t; draw(); } }, t))),
      h("div", { class: "mdn-row" }, h("span", { class: "mdn-lbl" }, "Show"),
        h("button", { class: "mdn-chip" + (S.rumors ? " on" : ""), onclick: () => { S.rumors = true; draw(); } }, "Everything"),
        h("button", { class: "mdn-chip" + (!S.rumors ? " on" : ""), onclick: () => { S.rumors = false; draw(); } }, "Confirmed only")),
    );
    if (stale) root.append(h("div", { class: "mdn-warn" }, `Couldn't reach the news sources since ${fmtDate(D.lastSuccess)}. These are the stories from then — check back later.`));
    if (D && D.aiNote) root.append(h("div", { class: "mdn-warn" }, "Summaries: " + D.aiNote + ". Stories still show the source's own short description."));

    if (S.showSources && D) {
      root.append(h("div", { class: "mdn-card" }, h("b", null, "Sources"),
        h("div", { class: "mdn-srcs" }, D.sources.map((s) => h("div", null,
          h("span", { class: "mdn-dot", style: `background:${s.ok ? "#22C55E" : s.at ? "#F2545B" : "#8C97A8"}` }),
          h("span", null, h("b", null, s.name), s.official ? " · official" : "",
            h("span", { style: "color:var(--faint)" }, s.ok ? ` — ok, ${ago(s.at)}` : s.at ? ` — not reachable (${s.error}), skipped` : " — not tried yet"))))),
        h("p", { class: "mdn-src", style: "margin:8px 0 0" }, `Read from each site's public RSS feed, at most about twice an hour. AI summaries today: ${D.usedToday} of ${D.dailyLimit}.`)));
    }

    const list = h("div", { class: "mdn-list" });
    const groups = (D && D.groups || []).filter((g) =>
      (S.brand === "All" || g.brands.includes(S.brand)) && (S.topic === "All" || g.topics.includes(S.topic)) && (S.rumors || g.status !== "rumor"));
    if (!D) list.append(h("div", { class: "mdn-empty" }, "Loading the news…"));
    else if (!groups.length) list.append(h("div", { class: "mdn-empty" }, D.groups.length ? "Nothing matches those filters." : "No stories yet. The first refresh runs a minute after MYDAY starts, then every hour."));
    for (const g of groups.slice(0, 120)) {
      const when = g.published ? `${fmtDate(g.published)} · ${ago(g.published)}` : `date not given — first seen ${ago(g.firstSeen)}`;
      const st = g.status === "official" ? ["official", "Official"] : g.status === "rumor" ? ["rumor", "Rumor / leak"] : ["confirmed", "Confirmed report"];
      list.append(h("article", { class: "mdn-card" + (g.status === "rumor" ? " rumor" : "") },
        h("div", { class: "mdn-top" },
          h("span", { class: "mdn-st " + st[0], title: g.status === "official" ? "From the company's own newsroom or release notes" : g.status === "rumor" ? "Leak, report from unnamed sources, or prediction — not confirmed" : "Reported as having happened or been announced" }, st[1]),
          g.brands.filter((b) => b !== "Other").map((b) => h("span", { class: "mdn-tag" }, b)),
          g.topics.filter((t) => t !== "General").slice(0, 3).map((t) => h("span", { class: "mdn-tag" }, t))),
        h("h3", null, h("a", { href: safeLink(g.link), target: "_blank", rel: "noopener noreferrer" }, esc(g.title))),
        h("div", { class: "mdn-meta" }, `${g.source} · ${when}`),
        g.summary ? h("p", { class: "mdn-sum" }, g.summary, " ", h("span", { class: "mdn-src" }, "— AI summary of the source's description"))
          : g.snippet ? h("p", { class: "mdn-sum" }, g.snippet + (g.snippet.split(/\s+/).length >= 30 ? "…" : ""), " ", h("span", { class: "mdn-src" }, `— from ${g.source}`)) : null,
        g.why ? h("div", { class: "mdn-why" }, h("b", null, "Why it may matter to you: "), g.why) : null,
        g.also && g.also.length ? h("div", { class: "mdn-also" }, "Also covered by: ",
          g.also.map((a, i) => [i ? ", " : "", h("a", { href: safeLink(a.link), target: "_blank", rel: "noopener noreferrer", title: a.title }, a.source + (a.status === "rumor" ? " (rumor)" : ""))])) : null));
    }
    root.append(list);
    S.host.replaceChildren(root);
  }

  async function load() {
    try {
      const r = await fetch("/api/news", { credentials: "same-origin" });
      const j = await r.json();
      if (r.ok) S.data = j; else S.msg = j.error || "Couldn't load the news";
    } catch (e) { S.msg = "Couldn't reach the server"; }
    draw();
  }
  async function refresh() {
    S.busy = true; S.msg = ""; draw();
    try {
      const r = await fetch("/api/news/refresh", { method: "POST", credentials: "same-origin" });
      const j = await r.json();
      if (r.ok) { S.data = j; S.msg = j.skipped ? "Already fresh — " + j.skipped : (j.summarised ? `${j.summarised} new summaries` : "Up to date"); }
      else S.msg = j.error || "Couldn't refresh";
    } catch (e) { S.msg = "Couldn't reach the server"; }
    S.busy = false; draw();
  }

  let timer = null;
  function mount(host) {
    if (!document.getElementById("mdn-css")) { const st = document.createElement("style"); st.id = "mdn-css"; st.textContent = CSS; document.head.appendChild(st); }
    S.host = host; draw(); load();
    clearInterval(timer); timer = setInterval(() => { if (S.host && !document.hidden) load(); }, 5 * 60e3);
  }
  function unmount() { S.host = null; clearInterval(timer); }
  window.MYDAYNews = { mount, unmount };
})();
