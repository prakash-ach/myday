/* Keeping devices in step. Every 15 seconds (and when you come back to the
   tab) it asks the server whether another device has saved. If so, it saves
   this one's current state against what it last had; the server merges the
   two and this tab takes the combined result. With nothing changed here,
   that simply pulls in the other device's changes. */
(function () {
  "use strict";
  const KEY = "myday_proto_v1";
  let busy = false;
  async function check() {
    const c = window.__myday;
    if (busy || !c || !c.state || !window.storage || document.hidden) return;
    const mine = (window.__mydayRev || {})[KEY];
    if (mine == null) return;
    busy = true;
    try {
      const r = await fetch("/api/state-rev/" + KEY, { credentials: "same-origin" });
      if (!r.ok) return;
      const { rev } = await r.json();
      if (rev !== mine) await window.storage.set(KEY, JSON.stringify(c.state), false);
    } catch (e) {
    } finally { busy = false; }
  }
  setInterval(check, 15000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) setTimeout(check, 300); });
  window.addEventListener("focus", () => setTimeout(check, 300));
  window.MYDAYSync = { check };
})();
