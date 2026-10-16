/* Page addresses: every MYDAY page has its own URL (e.g. /scan-boxes), so a
   refresh stays on the page, Back/Forward work, and links can be shared. */
(function () {
  "use strict";
  const SLUG = { dashboard: "", today: "today", tasks: "tasks", calendar: "calendar", projects: "projects", auctions: "auctions",
    captured: "captured-invoices", repair: "repair-devices", scanbox: "scan-boxes", development: "development", automation: "automation",
    "automation-classic": "automation/classic", news: "phone-news", tradein: "apple-trade-in", notes: "notes", goals: "goals", habits: "habits", settings: "settings" };
  const NAME = { dashboard: "Dashboard", today: "Today", tasks: "All tasks", calendar: "Calendar", projects: "Projects", auctions: "Auctions",
    captured: "Captured Invoices", repair: "Repair Devices", scanbox: "Scan Boxes", development: "Development", automation: "Automation",
    "automation-classic": "Automation", news: "Phone Industry News", tradein: "Apple Trade-In", notes: "Notes", goals: "Goals", habits: "Habits", settings: "Settings" };
  const urlOf = (v) => "/" + (v in SLUG ? SLUG[v] : encodeURIComponent(v));
  function viewOf(pathname) {
    const p = decodeURIComponent(String(pathname || "/")).replace(/^\/+|\/+$/g, "");
    if (!p) return "dashboard";
    const hit = Object.keys(SLUG).find((k) => SLUG[k] === p);
    return hit || (/^[a-z-]+$/.test(p) ? p : null);
  }
  const ctx = () => window.__myday || null;
  let last = null, wanted = viewOf(location.pathname), fromHistory = false;
  function tick() {
    const c = ctx(); if (!c || !c.setView) return;          // not signed in yet: keep the address for later
    if (wanted) { const w = wanted; wanted = null; if (w !== c.view) { last = w; c.setView(w); document.title = (NAME[w] || "MYDAY") + " · MYDAY"; return; } }
    const v = c.view;
    if (v === last) { if (!/· MYDAY$/.test(document.title)) document.title = (NAME[v] || "MYDAY") + " · MYDAY"; return; }
    last = v;
    const url = urlOf(v);
    if (location.pathname !== url) (fromHistory ? history.replaceState : history.pushState).call(history, { view: v }, "", url + location.hash);
    fromHistory = false;
    document.title = (NAME[v] || "MYDAY") + " · MYDAY";
  }
  window.addEventListener("popstate", () => {
    const v = viewOf(location.pathname) || "dashboard", c = ctx();
    fromHistory = true;
    if (c && c.setView && v !== c.view) { last = null; c.setView(v); } else fromHistory = false;
  });
  setInterval(tick, 250);
  window.MYDAYRouter = { urlOf, viewOf };
})();
