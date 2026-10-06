/* Model names, the way your Setup has them.
 *
 * Invoices describe a phone as "APPLE IPHONE 13 PRO 256 ALPINE GREEN VZ
 * MLR83LL/A". The Auction table wants the model: "iPhone 13 Pro". clean()
 * takes off storage, carrier, part numbers and — from the end — colours
 * (including Apple's own names like Alpine Green, Sierra Blue, Midnight),
 * then matches what's left to the models in Setup for that make. The colour
 * is handed back separately so it can go in the entry's notes.
 *
 * tidy() finds entries and Setup models that already have a colour in the
 * name, shows exactly what it would change, and fixes them when you say so.
 */
(function () {
  "use strict";
  const ctx = () => window.__myday || null;

  const COLOURS = [
    // Apple
    "alpine green", "sierra blue", "pacific blue", "midnight green", "deep purple", "space black", "space gray", "space grey",
    "black titanium", "white titanium", "natural titanium", "blue titanium", "desert titanium", "product red", "(product)red",
    "productred", "rose gold", "jet black", "graphite", "midnight", "starlight", "ultramarine", "teal", "coral",
    // Samsung / Google / Motorola and common
    "phantom black", "phantom white", "phantom silver", "phantom gray", "phantom grey", "phantom green", "phantom violet",
    "titanium gray", "titanium grey", "titanium black", "titanium violet", "titanium yellow", "titanium blue", "titanium green",
    "bora purple", "cream", "lavender", "mint", "graphite", "burgundy", "obsidian", "porcelain", "hazel", "bay", "sage", "snow",
    "charcoal", "lemongrass", "aloe", "peony", "rose", "iris", "jade", "sorta seafoam", "stormy black", "cloudy white",
    "just black", "clearly white", "oh so orange", "chalk", "sea", "winter green", "luxe gray", "forest green",
    "black", "white", "red", "blue", "green", "gold", "silver", "gray", "grey", "pink", "purple", "yellow", "orange", "violet",
    "navy", "bronze", "beige", "brown", "copper", "champagne", "titanium",
  ].sort((a, b) => b.length - a.length);
  const CARRIER = /\b(vz|vzw|verizon|t-?mobile|tmo|at&?t|att|sprint|unlocked|unlock|locked|carrier unlocked|us cellular|cricket|metro|boost|tracfone|xfinity|visible)\b/gi;
  const STORAGE = /\b\d{2,4}\s?(gb|tb|g)\b|\b(64|128|256|512|1024)\b(?!\s*(mah|hz|mp))/gi;
  const PARTNO = /\b[a-z]{1,4}\d[a-z0-9]{2,8}(ll|ch|zp|b|j)?\/[a-z]\b|\b[A-Z0-9]{5,}\/[A-Z]\b/gi;
  const JUNK = /\b(grade|grd|cond(ition)?|used|refurb(ished)?|sealed|cpo|smartphone|cell ?phone|lte|dual sim)\b/gi;

  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9+]/g, "");
  const tidyCase = (s) => String(s || "").replace(/\s+/g, " ").trim();

  function stripColour(text) {
    let t = tidyCase(text), colour = "";
    for (let again = true; again;) {
      again = false;
      for (const c of COLOURS) {
        const re = new RegExp(`[\\s,/-]+${c.replace(/[()]/g, "\\$&")}$`, "i");
        if (re.test(t)) { colour = (t.match(re)[0].replace(/^[\s,/-]+/, "") + (colour ? " " + colour : "")).trim(); t = t.replace(re, "").trim(); again = true; break; }
      }
    }
    return { text: t, colour };
  }

  function modelsFor(oem) {
    const c = ctx(); const cat = (c && c.state && c.state.catalog) || {};
    const o = (cat.oems || []).find((x) => x.name.toLowerCase() === String(oem || "").toLowerCase());
    return o ? (o.models || []).map((m) => m.name) : [];
  }

  /* → { model, colour, how } */
  function clean(oem, model, opts) {
    const known = (opts && opts.known) || modelsFor(oem);
    const original = tidyCase(model);
    let t = original;
    // Drop the make if it's repeated ("Apple iPhone 13" → "iPhone 13")
    if (oem) t = t.replace(new RegExp(`^${String(oem).replace(/[^a-z0-9]/gi, ".?")}\\s+`, "i"), "");
    t = t.replace(PARTNO, " ").replace(STORAGE, " ").replace(CARRIER, " ").replace(JUNK, " ").replace(/[—–|]+/g, " ");
    t = tidyCase(t.replace(/\s[-,/]\s/g, " "));
    const sc = stripColour(t);
    t = sc.text;
    let colour = sc.colour;
    // Match Setup's own spelling: exact, or the longest Setup model this starts with
    // when what's left over is only colour.
    const exact = known.find((k) => norm(k) === norm(t));
    if (exact) t = exact;
    else {
      const prefix = known.filter((k) => norm(t).startsWith(norm(k)) && norm(k).length >= 4).sort((a, b) => b.length - a.length)[0];
      if (prefix) {
        const rest = stripColour("x " + t.slice(t.toLowerCase().indexOf(prefix.toLowerCase()) + prefix.length));
        if (rest.text.trim() === "x") { colour = [rest.colour, colour].filter(Boolean).join(" "); t = prefix; }
      }
    }
    // Title-case shouting from invoices, but keep "iPhone", "Pro Max", "S23" etc.
    if (t === t.toUpperCase()) t = t.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()).replace(/\bIphone\b/g, "iPhone").replace(/\bIpad\b/g, "iPad");
    t = tidyCase(t) || original;
    const how = t !== original ? [colour ? `colour "${colour}" moved to notes` : null, known.includes(t) ? `matches "${t}" in Setup` : null].filter(Boolean).join(" · ") : "";
    const nice = colour ? colour.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()).replace(/\(product\)red|productred|product red/i, "(PRODUCT)RED") : "";
    return { model: t, colour: nice, how: how.replace(colour, nice), known: known.includes(t) };
  }

  /* ---------- fixing what's already in ---------- */
  function plan() {
    const c = ctx(); if (!c) return { entries: [], models: [] };
    const st = c.state;
    const entries = [];
    for (const e of st.entries || []) {
      const r = clean(e.oem, e.model);
      if (r.model && r.model !== e.model && (r.colour || r.known)) entries.push({ id: e.id, from: e.model, to: r.model, colour: r.colour, oem: e.oem, notes: e.notes || "" });
    }
    const models = [];
    for (const o of (st.catalog && st.catalog.oems) || []) {
      for (const m of o.models || []) {
        const r = clean(o.name, m.name, { known: (o.models || []).map((x) => x.name).filter((x) => x !== m.name) });
        if (r.model !== m.name && r.colour) models.push({ oem: o.name, from: m.name, to: r.model, sizes: m.sizes || [] });
      }
    }
    return { entries, models };
  }
  function apply(p) {
    const c = ctx(); if (!c) return;
    for (const e of p.entries) {
      const note = e.colour && !new RegExp(`\\b${e.colour}\\b`, "i").test(e.notes) ? [e.colour, e.notes].filter(Boolean).join(" · ") : e.notes;
      c.patchEntry(e.id, { model: e.to, notes: note });
    }
    if (p.models.length) {
      c.setCatalog((cat) => ({
        ...cat,
        oems: (cat.oems || []).map((o) => {
          const fixes = p.models.filter((m) => m.oem === o.name);
          if (!fixes.length) return o;
          let models = (o.models || []).map((m) => ({ ...m, sizes: [...(m.sizes || [])] }));
          for (const f of fixes) {
            const bad = models.find((m) => m.name === f.from);
            if (!bad) continue;
            let good = models.find((m) => m.name.toLowerCase() === f.to.toLowerCase());
            if (!good) { bad.name = f.to; continue; }                         // just rename
            for (const s of bad.sizes) if (good.sizes.indexOf(s) < 0) good.sizes.push(s);   // merge into the clean one
            models = models.filter((m) => m !== bad);
          }
          return { ...o, models };
        }),
      }));
    }
  }

  /* The cleanup window. */
  const CSS = `
  .mdm-back{position:fixed;inset:0;z-index:2147483100;background:rgba(5,8,12,.5);display:flex;align-items:center;justify-content:center;padding:16px}
  .mdm{width:min(640px,100%);max-height:calc(100vh - 32px);display:flex;flex-direction:column;border-radius:18px;overflow:hidden;
    font:13.5px/1.45 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg);border:1px solid var(--line);box-shadow:0 40px 100px -30px rgba(0,0,0,.7)}
  .mdm.dark{--bg:rgba(16,20,26,.97);--ink:#E9EDF3;--muted:#8C97A8;--faint:#5E6878;--line:rgba(255,255,255,.1);--glass:rgba(255,255,255,.06)}
  .mdm.light{--bg:rgba(250,251,252,.98);--ink:#141A21;--muted:#5F6B79;--faint:#8D98A6;--line:rgba(20,30,40,.1);--glass:rgba(255,255,255,.85)}
  .mdm h3{margin:0;padding:16px 18px 4px;font:600 18px "Iowan Old Style",Palatino,Georgia,serif}
  .mdm p{margin:0;padding:0 18px 10px;color:var(--muted);font-size:12.5px}
  .mdm-list{overflow:auto;padding:0 18px 12px;display:grid;gap:5px}
  .mdm-row{display:flex;gap:8px;align-items:center;padding:7px 10px;border:1px solid var(--line);border-radius:10px;background:var(--glass)}
  .mdm-row s{color:var(--faint)} .mdm-row b{color:var(--a)} .mdm-row small{margin-left:auto;color:var(--faint)}
  .mdm-foot{display:flex;gap:8px;justify-content:flex-end;padding:12px 18px;border-top:1px solid var(--line)}
  .mdm button{font:inherit;cursor:pointer;border-radius:10px;padding:8px 14px}
  .mdm .pri{border:0;color:#fff;font-weight:700;background:var(--a)} .mdm .sec{border:1px solid var(--line);background:var(--glass);color:var(--muted)}
  `;
  function tidyWindow() {
    const c = ctx(); if (!c) return;
    if (!document.getElementById("mdm-css")) { const st = document.createElement("style"); st.id = "mdm-css"; st.textContent = CSS; document.head.appendChild(st); }
    const p = plan();
    const groups = {};
    for (const e of p.entries) { const k = e.from + "→" + e.to; (groups[k] = groups[k] || { ...e, n: 0 }).n++; }
    const back = document.createElement("div"); back.className = "mdm-back";
    const box = document.createElement("div"); box.className = "mdm " + (c.isDark === false ? "light" : "dark");
    box.style.setProperty("--a", c.accent || "#2FBF87");
    const rows = Object.values(groups).map((g) => `<div class="mdm-row"><s>${esc(g.from)}</s> → <b>${esc(g.to)}</b>${g.colour ? ` <span style="color:var(--muted)">(${esc(g.colour)} to notes)</span>` : ""}<small>${g.n} entr${g.n === 1 ? "y" : "ies"}</small></div>`)
      .concat(p.models.map((m) => `<div class="mdm-row"><s>${esc(m.from)}</s> → <b>${esc(m.to)}</b><small>Setup model</small></div>`));
    box.innerHTML = `<h3>Tidy model names</h3><p>${rows.length ? "These have a colour in the model name. Fixing moves the colour into the entry's notes and merges the Setup models. Prices, grades and quantities don't change." : "Nothing to tidy — every model name already matches your Setup."}</p>
      <div class="mdm-list">${rows.join("")}</div>
      <div class="mdm-foot"><button class="sec" data-x>Close</button>${rows.length ? `<button class="pri" data-go>Fix ${p.entries.length} entr${p.entries.length === 1 ? "y" : "ies"}${p.models.length ? ` and ${p.models.length} Setup model${p.models.length === 1 ? "" : "s"}` : ""}</button>` : ""}</div>`;
    back.appendChild(box); document.body.appendChild(back);
    const close = () => back.remove();
    back.addEventListener("click", (e) => { if (e.target === back || e.target.hasAttribute("data-x")) close(); });
    const go = box.querySelector("[data-go]");
    if (go) go.addEventListener("click", () => {
      apply(p); close();
      c.setToast && c.setToast(`Tidied ${p.entries.length} entries${p.models.length ? ` and ${p.models.length} Setup models` : ""}`);
      setTimeout(() => { try { window.dispatchEvent(new Event("myday-tidied")); } catch (e) {} }, 150);
    });
  }
  const esc = (s) => String(s || "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

  window.MYDAYModels = { clean, plan, apply, tidyWindow, count: () => plan().entries.length };
})();
