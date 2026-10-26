/* Scan Boxes — the screen. Photo → one row per box → review → saved to the
   shared table (who + when). People see their own rows; the owner sees all. */
(function () {
  "use strict";
  const ctx = () => window.__myday || null;
  const S = { host: null, data: null, review: null, busy: "", f: { q: "", from: "", to: "", who: "", status: "" }, edit: null, pick: new Set(), showRemoved: false,
    rapid: true, Q: { items: [], running: 0, saved: 0, dups: 0, fixed: 0 }, projects: null, project: null };
  const lastProject = () => { try { return localStorage.getItem("myday_scan_project") || ""; } catch (e) { return ""; } };
  const rememberProject = (id) => { try { id ? localStorage.setItem("myday_scan_project", id) : localStorage.removeItem("myday_scan_project"); } catch (e) {} };
  /* The owner locked the project mid-scan: back to the list, with the reason. */
  function projectLocked() {
    if (!S.project) return;
    const name = S.project.name; S.project = null; rememberProject("");
    S.projErr = `"${name}" was locked for scanning by the owner — pick another project.`;
    loadProjects().then(draw);
  }
  async function loadProjects() {
    try { const r = await fetch("/api/scanbox/projects", { credentials: "same-origin" }); const j = await r.json(); if (r.ok) { S.projects = j.projects; S.isOwner = j.owner; } } catch (e) {}
    if (!S.project) { const last = lastProject(); const hit = (S.projects || []).find((p) => p.id === last && !p.archived && !p.locked); if (hit) S.project = hit; }
  }
  function projectsHtml() {
    const P = S.projects; if (!P) return `<p class="sb-dim">Loading projects…</p>`;
    const live = P.filter((p) => !p.archived), arch = P.filter((p) => p.archived);
    const card = (p) => `<div class="sb-proj${S.combine && S.combine.has(p.id) ? " picked" : ""} ${p.archived ? "arch" : ""} ${p.locked ? "locked" : ""}">${S.isOwner ? `<label class="sb-pick"><input type="checkbox" data-combine="${esc(p.id)}" ${S.combine && S.combine.has(p.id) ? "checked" : ""}> combine</label>` : ""}<button class="sb-proj-open" data-proj="${esc(p.id)}"><b>${p.locked ? "🔒 " : ""}${esc(p.name)}</b>
        <span>${p.rows} box${p.rows === 1 ? "" : "es"}${S.isOwner ? "" : " scanned by you"}${p.createdAt ? ` · started ${esc(p.createdAt.slice(0, 10))}` : ""}${p.locked ? " · locked for scanning" : ""}${p.archived ? " · archived" : ""}</span></button>
      ${!p.legacy ? `<div class="sb-proj-type">${S.isOwner ? `Scan type <select data-scantype="${esc(p.id)}"><option value="box" ${p.scanType !== "carton" ? "selected" : ""}>📦 Device box (one label per box)</option><option value="carton" ${p.scanType === "carton" ? "selected" : ""}>🗃 Bulk carton (many serials/IMEIs)</option></select>` : p.scanType === "carton" ? "🗃 Bulk carton" : "📦 Device box"}</div>` : ""}
      ${S.isOwner && p.legacy ? `<div class="sb-proj-act"><button class="sb-link" data-namelegacy>Name these scans → new project</button></div>` : ""}
      ${S.isOwner && !p.legacy ? `<div class="sb-proj-act"><button class="sb-lock ${p.locked ? "on" : ""}" data-lock="${esc(p.id)}">${p.locked ? "🔓 Unlock scanning" : "🔒 Lock scanning"}</button><button class="sb-link" data-rename="${esc(p.id)}">Rename</button><button class="sb-link" data-archive="${esc(p.id)}">${p.archived ? "Unarchive" : "Archive"}</button></div>` : ""}</div>`;
    return `<div class="sb-top"><div><h1>Scan Boxes</h1><p class="sb-dim">Choose a project to scan into. Each project has its own table and its own Excel export.</p></div></div>
      ${S.isOwner ? `<div class="sb-panel"><div class="sb-row"><input class="sb-newproj" placeholder="New project name, e.g. October POCO lot" maxlength="80"><button class="sb-pri" data-newproj>+ Create project</button></div>${S.projErr ? `<p class="sb-warn">${esc(S.projErr)}</p>` : ""}</div>` : ""}
      ${!S.isOwner && S.projErr ? `<p class="sb-warn sb-panel">${esc(S.projErr)}</p>` : ""}
      ${S.isOwner && S.combine && S.combine.size >= 2 ? `<div class="sb-panel sb-row"><b>${S.combine.size} projects selected</b><input class="sb-newproj" data-combname placeholder="Name for the combined project"><button class="sb-pri" data-docombine>Combine into new project</button><span class="sb-dim">Copies every row, with a Source column. The originals stay as they are.</span></div>` : ""}
      ${live.length ? `<div class="sb-projs">${live.map(card).join("")}</div>` : `<div class="sb-panel"><p class="sb-dim">${S.isOwner ? "No projects yet — create one above." : "No projects yet. Ask the owner to create one, then it appears here."}</p></div>`}
      ${arch.length ? `<details class="sb-arch"><summary>Archived (${arch.length})</summary><div class="sb-projs">${arch.map(card).join("")}</div></details>` : ""}`;
  }
  const WORKERS = 4;

  /* ---------- rapid mode: check on the phone, queue, read 4 at a time, save straight in ---------- */
  /* Is this photo usable? Checked on the phone, before anything is uploaded. */
  function quality(img, minSide, blurMin, judgeAt) {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (Math.max(w, h) < (minSide || 1000)) return "too small — move closer or use the full camera";
    const k = (judgeAt || 640) / Math.max(w, h), cw = Math.round(w * k), ch = Math.round(h * k), cv = document.createElement("canvas");
    cv.width = cw; cv.height = ch; const g = cv.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, cw, ch);
    const px = g.getImageData(0, 0, cw, ch).data, gray = new Float32Array(cw * ch);
    let sum = 0; for (let i = 0, j = 0; i < px.length; i += 4, j++) { gray[j] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; sum += gray[j]; }
    const mean = sum / gray.length;
    if (mean < 45) return "too dark — add light";
    if (mean > 238) return "washed out — too much glare";
    // Sharpness: variance of the Laplacian. Blurry photos have little edge detail.
    let n = 0, s1 = 0, s2 = 0;
    for (let y = 1; y < ch - 1; y++) for (let x = 1; x < cw - 1; x++) {
      const i = y * cw + x, v = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - cw] - gray[i + cw]; s1 += v; s2 += v * v; n++;
    }
    const varLap = s2 / n - (s1 / n) ** 2;
    if (varLap < (blurMin || 40)) return "too blurry — hold still and tap to focus";
    return "";
  }
  const loadImg = (file) => new Promise((res, rej) => { const img = new Image(), url = URL.createObjectURL(file); img.onload = () => res({ img, url }); img.onerror = () => rej(new Error("not a photo")); img.src = url; });
  /* A JPEG of the photo (or a crop of it), turned `rot` degrees clockwise so
     its text reads upright. Browsers already apply the photo's own EXIF
     orientation when drawing it. */
  function jpeg(img, max, crop, rot) {
    const cv = rotCanvas(img, max, crop, rot);
    return cv.toDataURL("image/jpeg", 0.88).split(",")[1];
  }
  function rotCanvas(img, max, crop, rot) {
    const [sx, sy, sw, sh] = crop || [0, 0, img.naturalWidth || img.width, img.naturalHeight || img.height];
    const r = ((Number(rot) || 0) % 360 + 360) % 360, side = r === 90 || r === 270;
    const k = Math.min(1, max / Math.max(sw, sh)), w = Math.round(sw * k), h = Math.round(sh * k);
    const cv = document.createElement("canvas"); cv.width = side ? h : w; cv.height = side ? w : h;
    const g = cv.getContext("2d");
    g.translate(cv.width / 2, cv.height / 2); g.rotate((r * Math.PI) / 180);
    g.drawImage(img, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
    return cv;
  }
  async function enqueue(files, force) {
    for (const file of files) {
      const it = { key: Math.random().toString(36).slice(2), file, name: file.name, status: "checking", msg: "", projectId: S.project && S.project.id !== "none" ? S.project.id : null };
      S.Q.items.unshift(it); draw();
      try {
        const { img, url } = await loadImg(file); it.thumb = url; it.img = img;
        const bad = force ? "" : quality(img);
        if (bad) { it.status = "retake"; it.msg = bad + " (not uploaded)"; it.local = true; }
        else it.status = "waiting";
      } catch (e) { it.status = "error"; it.msg = "Couldn't open this file"; }
      draw();
    }
    pump();
  }
  function pump() {
    while (S.Q.running < WORKERS) {
      const it = S.Q.items.slice().reverse().find((x) => x.status === "waiting");
      if (!it) break;
      S.Q.running++; it.status = "reading"; draw(); camCount();
      work(it).finally(() => { S.Q.running--; it.img = it.status === "retake" ? it.img : null; it.blob = it.status === "retake" ? it.blob : null; draw(); refreshSoon(); pump(); });
    }
  }
  /* ---------- reliable requests: retry until it gets through ---------- */
  const wake = new Set();
  const nap = (ms) => new Promise((res) => { const t = setTimeout(done, ms); function done() { clearTimeout(t); wake.delete(done); res(); } wake.add(done); });
  const wakeAll = () => [...wake].forEach((f) => f());
  window.addEventListener("online", wakeAll);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) wakeAll(); });
  /* One request, tried until it works: network drops, the phone pausing the page
     (camera open), server restarts or busy web server (502/503/504) just wait and
     try again. Real answers (2xx/4xx) come back. */
  async function steady(url, body, it) {
    for (let n = 0; ; n++) {
      if (it && it.cancel) throw new Error("cancelled");
      try {
        const r = await fetch(url, body ? { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { credentials: "same-origin" });
        if (r.status === 401) { location.reload(); throw new Error("signed out"); }
        if (r.status === 429) { if (it) { it.waiting = true; it.msg = "server queue full — will send when there's room"; draw(); } await nap(4000); continue; }
        if (r.status < 500 && r.status !== 408) { const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) { j = { error: `HTTP ${r.status}` }; } return { ok: r.ok, status: r.status, j }; }
      } catch (e) { if (e.message === "signed out") throw e; }
      if (it) { it.waiting = true; it.msg = navigator.onLine === false ? "offline — will send when the connection is back" : "waiting for the connection — retrying"; draw(); }
      await nap(Math.min(30000, 1500 * 2 ** Math.min(n, 5)));
      if (it) { it.waiting = false; }
    }
  }
  async function work(it) {
    if (!it.img && it.blob) it.img = (await loadImg(it.blob)).img;
    try { await workInner(it); } finally {
      if (it.kept && ["done", "retake"].includes(it.status)) { dropKept(it.key); it.kept = false; }   // read by the server: no longer needed on the phone
      camCount();
    }
  }
  async function workInner(it) {
    // 1) upload (quick) → a ticket. Retried uploads of the same photo get the same ticket.
    const image = it.payload || (it.payload = jpeg(it.img, 2400));
    const projectId = it.projectId;
    let up = await steady("/api/scanbox/upload", { uploadId: it.key, image, mime: "image/jpeg", auto: true, projectId }, it);
    if (!up.ok) {
      it.status = "error"; it.msg = up.j.error || "Upload refused";
      if (up.j.locked) { it.msg = "This project was locked for scanning — photo not saved"; projectLocked(); }
      return;
    }
    it.msg = up.j.ahead ? `uploaded — ${up.j.ahead} ahead in the queue` : "uploaded — reading…"; draw();
    // 2) check the ticket until the server has read it (works across pauses and restarts).
    let j;
    for (;;) {
      await nap(2000);
      const r = await steady("/api/scanbox/job?id=" + encodeURIComponent(it.key), null, it);
      if (r.status === 404 && r.j.unknown) { up = await steady("/api/scanbox/upload", { uploadId: it.key, image, mime: "image/jpeg", auto: true, projectId }, it); continue; }
      if (!r.ok) { it.status = "error"; it.msg = r.j.error || "Couldn't read this photo"; return; }
      if (r.j.status === "error") { it.status = "error"; it.msg = r.j.error || "Couldn't read this photo"; return; }
      if (r.j.status === "done") { j = r.j.result; break; }
      it.msg = r.j.status === "queued" && r.j.ahead ? `in the queue — ${r.j.ahead} ahead` : "reading…"; draw();
    }
    it.payload = null;
    if (j.retake) { it.status = "retake"; it.msg = j.retake + " (photo not kept)"; return; }
    it.status = "done"; it.saved = j.saved; it.dups = j.duplicates; S.Q.saved += j.saved; S.Q.dups += j.duplicates;
    if (j.carton) { it.msg = `🗃 ${j.note} · ${j.saved} saved${j.duplicates ? ` · ${j.duplicates} already scanned` : ""}`; if (/check the label/.test(j.note)) { it.status = "retake"; it.msg += " (rows kept)"; } return; }
    it.msg = `${j.saved} saved${j.duplicates ? ` · ${j.duplicates} duplicate${j.duplicates === 1 ? "" : "s"} skipped` : ""}`;
    // 3) close-up re-reads, each retried the same way.
    const W = it.img.naturalWidth, H = it.img.naturalHeight;
    const name = (b) => `${[b.brand, b.model, b.colour].filter(Boolean).join(" ") || "a box"}${b.position ? " (" + b.position + ")" : ""}`;
    const retakeBoxes = [];
    // A box that needs a close-up but has no position can't be cut out: ask for a close-up photo of it — never drop it.
    for (const b of (j.boxes || [])) if (b.pending && !b.box) retakeBoxes.push(name(b));
    const needs = (j.boxes || []).filter((b) => b.box && (b.pending || (b.rowId && (!luhn(digits(b.imei1)) || (b.imei2 && !luhn(digits(b.imei2))) || !b.serial || (b.rotation && (b.confidence || 0) < 0.8)))));
    if (needs.length) { it.msg += ` · re-reading ${needs.length} up close…`; draw(); }
    let fixed = 0;
    await Promise.all(needs.map(async (b) => {
      const [x, y, w, h] = b.box, pad = 0.04;
      const sx = Math.max(0, (x - pad) * W), sy = Math.max(0, (y - pad) * H), sw = Math.min(W - sx, (w + 2 * pad) * W), sh = Math.min(H - sy, (h + 2 * pad) * H);
      if (sw < 50 || sh < 50) return;
      const image = jpeg(it.img, 1800, [sx, sy, sw, sh], b.rotation);
      if (b.pending) {
        const { pending, rowId, box, ...data } = b;
        const r = await steady("/api/scanbox/reread", { photoId: j.photoId, box: data, image, projectId }, null);
        if (r.ok && r.j.saved) { it.saved++; S.Q.saved++; fixed++; }
        else if (r.ok && r.j.duplicate) { it.dups++; S.Q.dups++; }
        else retakeBoxes.push(name(b));
        return;
      }
      const r = await steady("/api/scanbox/reread", { id: b.rowId, image }, null);
      if (r.ok && r.j.duplicate) { it.saved--; S.Q.saved--; it.dups++; S.Q.dups++; }
      else if (r.ok && r.j.changed) fixed++;
    }));
    if (needs.length) { it.msg = `${it.saved} saved${it.dups ? ` · ${it.dups} duplicate${it.dups === 1 ? "" : "s"} skipped` : ""} · ${fixed} of ${needs.length} fixed up close`; S.Q.fixed += fixed; }
    // The whole photo, accounted for: found = saved + duplicates + close-up needed.
    const found = (j.boxes || []).length;
    it.msg = `${found} box${found === 1 ? "" : "es"} found · ${it.saved} saved${it.dups ? ` · ${it.dups} duplicate${it.dups === 1 ? "" : "s"}` : ""}${retakeBoxes.length ? ` · ${retakeBoxes.length} need a close-up` : ""}${fixed ? ` · ${fixed} fixed up close` : ""}`;
    // Boxes still without an IMEI or serial: ask for a close-up photo of just that box.
    if (retakeBoxes.length) S.Q.items.unshift({ key: it.key + "-rt", status: "retake", thumb: it.thumb, msg: `Take a close-up of ${retakeBoxes.join(", ")} — ${retakeBoxes.length === 1 ? "its IMEI/serial" : "their IMEIs/serials"} couldn't be read (not saved yet)` });
  }
  /* The buttons live on <body>, so "fixed" means the screen, not the page content. */
  let fabHost = null;
  function drawFab() {
    if (!S.host || !S.project || S.project.legacy || S.project.locked) { if (fabHost) { fabHost.remove(); fabHost = null; } return; }
    if (!fabHost) {
      fabHost = document.createElement("div"); document.body.appendChild(fabHost);
      fabHost.addEventListener("change", (e) => onChange(e));
      fabHost.addEventListener("click", (e) => { if (e.target.closest("[data-opencam]")) openCamera(); });
    }
    const c = ctx();
    fabHost.className = "sb " + (c && c.isDark === false ? "light" : "dark");
    fabHost.style.cssText = `--a:${(c && c.accent) || "#2FBF87"};padding:0;margin:0`;
    fabHost.innerHTML = actionBar();
  }
  /* ---------- photos kept on the phone until the server has read them ---------- */
  const DB = { db: null };
  function idb() {
    if (DB.db) return Promise.resolve(DB.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open("myday-scan", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("photos", { keyPath: "key" });
      r.onsuccess = () => { DB.db = r.result; res(DB.db); }; r.onerror = () => rej(r.error);
    });
  }
  const tx = (mode, fn) => idb().then((db) => new Promise((res, rej) => { const t = db.transaction("photos", mode), st = t.objectStore("photos"); const q = fn(st); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }));
  const keepPhoto = (rec) => tx("readwrite", (st) => st.put(rec)).catch(() => {});
  const dropKept = (key) => tx("readwrite", (st) => st.delete(key)).catch(() => {});
  const allKept = () => tx("readonly", (st) => st.getAll()).catch(() => []);
  /* Opening a project picks up anything still on the phone from before (closed app, lost signal…). */
  async function resumeKept() {
    const c = ctx(), me = c && c.me ? c.me.username : (S.data && S.data.me) || "";
    const recs = (await allKept()) || [];
    for (const r of recs) {
      if (S.Q.items.some((x) => x.key === r.key)) continue;
      if (r.user && me && r.user !== me) continue;
      S.Q.items.unshift({ key: r.key, blob: r.blob, thumb: URL.createObjectURL(r.blob), status: "waiting", msg: "resumed from the phone", projectId: r.projectId, kept: true });
    }
    if (recs.length) { draw(); pump(); }
  }

  /* ---------- the MYDAY camera: live view, square guide, tap tap tap ---------- */
  const CAM = { el: null, stream: null, video: null, taken: 0, torch: false, auto: true };
  /* ---------- auto-capture: label in the frame, steady, sharp → take it; then wait for the next box ---------- */
  const AUTO = { cv: null, prev: null, last: null, steady: 0, armed: true, t: null };
  const SW = 192, SH = 120;
  function sampleFrame() {
    const v = CAM.video; if (!v || !v.videoWidth) return null;
    const box = cropBox(v); if (!box) return null;
    if (!AUTO.cv) { AUTO.cv = document.createElement("canvas"); AUTO.cv.width = SW; AUTO.cv.height = SH; }
    const g = AUTO.cv.getContext("2d", { willReadFrequently: true });
    g.drawImage(v, box[0], box[1], box[2], box[3], 0, 0, SW, SH);
    const px = g.getImageData(0, 0, SW, SH).data, gray = new Float32Array(SW * SH);
    let sum = 0; for (let i = 0, j = 0; i < px.length; i += 4, j++) { gray[j] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; sum += gray[j]; }
    let edges = 0, n = 0, s1 = 0, s2 = 0;
    for (let y = 1; y < SH - 1; y++) for (let x = 1; x < SW - 1; x++) {
      const i = y * SW + x, gx = gray[i + 1] - gray[i - 1], gy = gray[i + SW] - gray[i - SW];
      if (Math.abs(gx) + Math.abs(gy) > 40) edges++;
      const l = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - SW] - gray[i + SW]; s1 += l; s2 += l * l; n++;
    }
    // 24×15 block averages, brightness-normalised: judges the overall picture, not pixel jitter.
    const BW = 8, cols = SW / BW, rows = SH / BW, grid = new Float32Array(cols * rows), mean = sum / gray.length;
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) grid[((y / BW) | 0) * cols + ((x / BW) | 0)] += gray[y * SW + x];
    for (let i = 0; i < grid.length; i++) grid[i] = grid[i] / (BW * BW) - mean;
    // Ring along the frame's edges: must be quiet — the whole label (4 corners) inside, no hand or object crossing in.
    const R = 7; let ringE = 0, ringN = 0;
    for (let y = 1; y < SH - 1; y++) for (let x = 1; x < SW - 1; x++) {
      if (x > R && x < SW - 1 - R && y > R && y < SH - 1 - R) continue;
      const i = y * SW + x; if (Math.abs(gray[i + 1] - gray[i - 1]) + Math.abs(gray[i + SW] - gray[i - SW]) > 40) ringE++; ringN++;
    }
    // Barcode: a run of many sharp, alternating light/dark bars along a row (or a column, for a turned box).
    const bars = (len, at) => { let best = 0;
      for (let a = 8; a < (len === SW ? SH : SW) - 8; a += 3) {
        let flips = 0, last = 0, runStart = 0, runFlips = 0;
        for (let b = 1; b < len; b++) {
          const d = at(a, b) - at(a, b - 1); const sgn = d > 28 ? 1 : d < -28 ? -1 : 0;
          if (sgn && sgn !== last) { if (b - runStart > 46) { runStart = b; runFlips = 0; } runFlips++; last = sgn; if (runFlips > best) best = runFlips; }
        }
      }
      return best; };
    const barH = bars(SW, (y, x) => gray[y * SW + x]), barV = bars(SH, (x, y) => gray[y * SW + x]);
    return { gray, grid, mean, edges: edges / n, sharp: s2 / n - (s1 / n) ** 2, ring: ringE / ringN, bars: Math.max(barH, barV) };
  }
  const diffOf = (a, b) => { if (!a || !b || a.length !== b.length) return 255; let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); return d / a.length; };
  function autoTick() {
    if (!CAM.el) return;
    if (!CAM.auto) return setAuto("Auto is off — tap the shutter", 0);
    if (!CAM.ready || CAM.busy) return;
    const f = sampleFrame(); if (!f) return;
    const moving = diffOf(f.grid, AUTO.prev && AUTO.prev.grid); AUTO.prev = f; AUTO.lastInfo = { ...f, moving };
    // Frame edges must look like the bare surface (its own texture allowed) — a cut-off label or a hand is much busier.
    const ringMax = Math.max(0.06, (AUTO.bg || 0) + 0.04);
    const isLabel = (f.bars >= 12 || f.edges > 0.13) && f.ring < ringMax && f.mean > 25 && f.mean < 250;   // barcode, or lots of print (glare can hide the bars)
    AUTO.lastInfo.isLabel = isLabel;
    // One shot per box: after a shot, wait until that label has LEFT the frame before arming again.
    if (!AUTO.armed) { if (!isLabel && f.edges < (AUTO.need || 0.08)) AUTO.armed = true; else return setAuto(`✓ ${CAM.taken} — next box`, 0); }
    // The empty surface (wood, mat…) is learned: the quietest view seen lately, creeping up slowly.
    // Only quiet views can be "the surface" — a label in view never becomes the background.
    if (f.edges < 0.08) AUTO.bg = AUTO.bg == null ? f.edges : Math.min(AUTO.bg + 0.0004, f.edges);
    const need = AUTO.bg == null ? 0.08 : Math.max(0.08, AUTO.bg + 0.03);
    AUTO.need = need;
    if (!(f.edges > need && isLabel)) {
      AUTO.steady = 0; AUTO.seen = 0;
      return setAuto(f.edges > need && f.ring >= ringMax ? "Fit all 4 corners inside — nothing crossing the frame" : f.edges > need ? "Looking for the barcode…" : "Place a box label in the frame", 0);
    }
    // A whole label is in the frame: it must stay still for 1 full second (7 samples). Any movement starts the count again.
    if (moving <= 10) AUTO.steady++; else AUTO.steady = 0;
    const NEED = 7;
    if (AUTO.steady < NEED) return setAuto(AUTO.steady ? "Hold still…" : "Label found — hold still", AUTO.steady / NEED);
    AUTO.steady = 0; AUTO.seen = 0; AUTO.armed = false; AUTO.last = f.grid;
    setAuto("Capturing — keep still", 1);
    shoot(true).then((ok) => { if (!ok) { AUTO.armed = true; AUTO.last = null; } });     // a rejected shot: try again, don't wait for a "next box"
  }
  function setAuto(text, progress) {
    if (!CAM.el) return;
    const st = CAM.el.querySelector(".sb-auto-msg"); if (st && st.textContent !== text) st.textContent = text;
    const b = CAM.el.querySelector("[data-shoot]"); if (b) b.style.setProperty("--p", String(Math.max(0, Math.min(1, progress || 0))));
  }
  async function startStream() {
    CAM.ready = false; setShutter();
    if (CAM.stream) CAM.stream.getTracks().forEach((t) => t.stop());
    CAM.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 4096 }, height: { ideal: 3072 } } });
    if (!CAM.video) return;
    CAM.video.srcObject = CAM.stream;
    await new Promise((res) => { if (CAM.video.readyState >= 2 && CAM.video.videoWidth) return res(); CAM.video.onloadedmetadata = () => res(); setTimeout(res, 4000); });
    try { await CAM.video.play(); } catch (e) {}
    const track = CAM.stream.getVideoTracks()[0];
    track.onended = () => { if (CAM.el && !document.hidden) startStream().catch(() => flash("Camera stopped — tap ✕ and open it again", true)); };   // dropped out: reconnect
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    const tb = CAM.el && CAM.el.querySelector("[data-torch]"); if (tb) tb.hidden = !caps.torch;
    CAM.track = track; CAM.ready = !!CAM.video.videoWidth; setShutter();
  }
  function setShutter() { const b = CAM.el && CAM.el.querySelector("[data-shoot]"); if (b) { b.disabled = !CAM.ready || CAM.busy; b.classList.toggle("wait", !CAM.ready); } }
  function camVisibility() {          // switching apps / locking the phone: stop the camera, restart on return
    if (!CAM.el) return;
    if (document.hidden) { if (CAM.stream) CAM.stream.getTracks().forEach((t) => t.stop()); CAM.stream = null; CAM.ready = false; setShutter(); }
    else startStream().catch(() => flash("Couldn't restart the camera — tap ✕ and open it again", true));
  }
  async function openCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { alert("This browser can't open a live camera here — use 📷 Next photo instead."); return; }
    if (CAM.el) return;
    unlockBeep();
    CAM.taken = 0;
    CAM.el = document.createElement("div"); CAM.el.className = "sb-cam-full";
    CAM.el.innerHTML = `<video playsinline autoplay muted></video><div class="sb-cam-guide"><span>${S.project && S.project.scanType === "carton" ? "Fit the whole carton label inside — all serials" : "Fit the whole label inside — all 4 corners"}</span></div>
      <div class="sb-cam-top"><button data-camclose aria-label="Close camera">✕</button><span class="sb-cam-count"></span><small class="sb-cam-ver">v${esc(window.MYDAY_BUILD || "?")}</small><button data-torch aria-label="Torch" hidden>🔦</button></div>
      <div class="sb-cam-flash"></div><div class="sb-auto-msg" aria-live="polite"></div>
      <div class="sb-cam-bottom"><button class="sb-autotog ${CAM.auto ? "on" : ""}" data-auto>Auto ${CAM.auto ? "on" : "off"}</button><button class="sb-shutter" data-shoot aria-label="Take photo"></button><span style="width:74px"></span></div>`;
    document.body.appendChild(CAM.el);
    CAM.video = CAM.el.querySelector("video");
    CAM.el.addEventListener("click", async (e) => {
      const t = e.target;
      if (t.hasAttribute("data-camclose")) return closeCamera();
      if (t.hasAttribute("data-torch")) { CAM.torch = !CAM.torch; try { await CAM.track.applyConstraints({ advanced: [{ torch: CAM.torch }] }); } catch (err) {} return; }
      if (t.closest("[data-shoot]")) return shoot();
      if (t.hasAttribute("data-auto")) { CAM.auto = !CAM.auto; t.classList.toggle("on", CAM.auto); t.textContent = "Auto " + (CAM.auto ? "on" : "off"); AUTO.steady = 0; return; }
    });
    document.addEventListener("visibilitychange", camVisibility);
    camCount();
    clearInterval(AUTO.t); AUTO.prev = null; AUTO.last = null; AUTO.armed = true; AUTO.steady = 0; AUTO.bg = null; AUTO.t = setInterval(autoTick, 150);
    try { await startStream(); }
    catch (e) { closeCamera(); alert("Couldn't open the camera: " + (e.message || e) + ". Allow camera access for this site, or use 📷 Next photo."); }
  }
  function closeCamera() {
    clearInterval(AUTO.t); AUTO.t = null;
    document.removeEventListener("visibilitychange", camVisibility);
    if (CAM.stream) CAM.stream.getTracks().forEach((t) => t.stop()); CAM.stream = null; CAM.ready = false; CAM.video = null;
    if (CAM.el) CAM.el.remove(); CAM.el = null; draw();
  }
  function camCount() {
    if (!CAM.el) return;
    const waiting = S.Q.items.filter((x) => ["checking", "waiting", "reading"].includes(x.status)).length;
    const busyNow = S.Q.items.filter((x) => x.status === "reading").length;
    CAM.el.querySelector(".sb-cam-count").textContent = `${CAM.taken} taken · processing ${busyNow} of ${WORKERS} · ${Math.max(0, waiting - busyNow)} waiting`;
  }
  /* Scanner beep on every capture (sound is unlocked by the tap that opened the camera). */
  let AC = null;
  function unlockBeep() { try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) {}   // iOS: play even with the silent switch on
    try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === "suspended") AC.resume(); } catch (e) {} }
  function beep() {
    try {
      if (AC) { const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
        const o2 = AC.createOscillator(), f2 = AC.createBiquadFilter();       // handheld-scanner style: bright ~2.9 kHz, crisp attack, short tail
        o.type = "square"; o.frequency.setValueAtTime(2900, t); o2.type = "sine"; o2.frequency.setValueAtTime(5800, t);
        f2.type = "bandpass"; f2.frequency.value = 2900; f2.Q.value = 1.4;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.55, t + 0.004); g.gain.setValueAtTime(0.55, t + 0.085); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
        o.connect(f2); o2.connect(f2); f2.connect(g); g.connect(AC.destination); o.start(t); o2.start(t); o.stop(t + 0.15); o2.stop(t + 0.15); }
    } catch (e) {}
    try { navigator.vibrate && navigator.vibrate(40); } catch (e) {}
  }
  function flash(text, bad) { const f = CAM.el && CAM.el.querySelector(".sb-cam-flash"); if (!f) return; f.textContent = text; f.className = "sb-cam-flash show" + (bad ? " bad" : ""); clearTimeout(f.t); f.t = setTimeout(() => (f.className = "sb-cam-flash"), 1100); }
  /* Grab the square from the full-resolution frame (with a little margin), check it, keep it on the phone, queue it. */
  async function shoot(fromAuto) {
    const v = CAM.video; if (!v || !v.videoWidth || !CAM.ready || CAM.busy) return;
    if (fromAuto !== true) { const f = sampleFrame(); if (f) { AUTO.last = f.grid; AUTO.armed = false; } }
    CAM.busy = true; setShutter();
    let ok = false;
    try { ok = await shootInner(v); } catch (e) { flash("Couldn't take that one — try again", true); }
    finally { CAM.busy = false; setShutter(); }
    return ok;
  }
  function cropBox(v) {
    const vw = v.videoWidth, vh = v.videoHeight, r = v.getBoundingClientRect(), gEl = CAM.el && CAM.el.querySelector(".sb-cam-guide");
    if (!gEl || !vw) return null;
    const g = gEl.getBoundingClientRect(), k = Math.max(r.width / vw, r.height / vh), ox = (r.width - vw * k) / 2, oy = (r.height - vh * k) / 2, m = 0.025 * g.width;
    let sx = (g.left - r.left - ox - m) / k, sy = (g.top - r.top - oy - m) / k, sw = (g.width + 2 * m) / k, sh = (g.height + 2 * m) / k;
    sx = Math.max(0, sx); sy = Math.max(0, sy); sw = Math.min(vw - sx, sw); sh = Math.min(vh - sy, sh);
    return [sx, sy, sw, sh];
  }
  /* Sharpness of a canvas, judged at 320 px (variance of the Laplacian). */
  function sharpOf(cv) {
    const k = 320 / Math.max(cv.width, cv.height), w = Math.max(8, Math.round(cv.width * k)), h = Math.max(8, Math.round(cv.height * k));
    const t = document.createElement("canvas"); t.width = w; t.height = h; const g = t.getContext("2d", { willReadFrequently: true }); g.drawImage(cv, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data, gr = new Float32Array(w * h);
    for (let i = 0, j = 0; i < px.length; i += 4, j++) gr[j] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    let n = 0, s1 = 0, s2 = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x, l = 4 * gr[i] - gr[i - 1] - gr[i + 1] - gr[i - w] - gr[i + w]; s1 += l; s2 += l * l; n++; }
    return s2 / n - (s1 / n) ** 2;
  }
  async function shootInner(v) {
    const vw = v.videoWidth, vh = v.videoHeight, r = v.getBoundingClientRect();
    const g = CAM.el.querySelector(".sb-cam-guide").getBoundingClientRect();
    const k = Math.max(r.width / vw, r.height / vh), ox = (r.width - vw * k) / 2, oy = (r.height - vh * k) / 2;   // object-fit: cover
    const m = 0.025 * g.width;            // just a sliver of margin: the photo is what you saw in the frame
    let sx = (g.left - r.left - ox - m) / k, sy = (g.top - r.top - oy - m) / k, sw = (g.width + 2 * m) / k, sh = (g.height + 2 * m) / k;
    sx = Math.max(0, sx); sy = Math.max(0, sy); sw = Math.min(vw - sx, sw); sh = Math.min(vh - sy, sh);
    // Anti-shake: grab 3 frames ~0.1 s apart and keep the sharpest.
    let cv = null, best = -1;
    for (let k = 0; k < 3; k++) {
      if (k) await new Promise((r) => setTimeout(r, 100));
      const c = document.createElement("canvas"); c.width = Math.round(sw); c.height = Math.round(sh);
      c.getContext("2d").drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
      const q = sharpOf(c); if (q > best) { best = q; cv = c; }
    }
    const bad = quality(cv, 400, 8, 320);         // only a truly smeared shot is rejected
    if (bad) { flash("⚠ " + bad.split(" — ")[0] + " — try again", true); return false; }
    const blob = await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.93));
    const key = "cam-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
    const c = ctx(), user = c && c.me ? c.me.username : (S.data && S.data.me) || "";
    const projectId = S.project && S.project.id !== "none" ? S.project.id : null;
    let kept = true;
    try { await tx("readwrite", (st) => st.put({ key, blob, projectId, user, at: Date.now() })); }      // safe on the phone first
    catch (e) { kept = false; flash("⚠ Phone storage full — keep MYDAY open until these upload", true); }
    S.Q.items.unshift({ key, blob, thumb: URL.createObjectURL(blob), status: "waiting", msg: "", projectId, kept });
    CAM.taken++; camCount(); pump();
    await new Promise((r) => setTimeout(r, 500));                 // ✓ and beep half a second after the photo
    beep(); if (kept) flash("✓ " + CAM.taken);
    return true;
  }

  /* How full is the server's queue (all users)? Checked every few seconds while scanning. */
  S.server = { queue: 0, limit: 20 };
  const localPending = () => S.Q.items.filter((x) => ["checking", "waiting"].includes(x.status) || (x.status === "reading" && x.waiting)).length;
  const isFull = () => S.server.queue + localPending() >= S.server.limit;
  let queueT = null;
  async function pollQueue() {
    clearTimeout(queueT);
    if (!S.host || !S.project) return;
    if (document.hidden) { queueT = setTimeout(pollQueue, 5000); return; }        // tab in the background: don't poll
    try { const r = await fetch("/api/scanbox/queue", { credentials: "same-origin" }); if (r.ok) { const j = await r.json(); const was = isFull(); S.server = j; if (was !== isFull()) drawFab(); else updateFabMsg(); } } catch (e) {}
    queueT = setTimeout(pollQueue, isFull() ? 2000 : 4000);
  }
  function updateFabMsg() { if (fabHost && isFull()) drawFab(); }

  /* Big, always-there buttons: next photo, and retake when one is needed. */
  function actionBar() {
    if (!S.rapid) return "";
    const rt = S.Q.items.filter((x) => x.status === "retake" || x.status === "error");
    const last = S.Q.items.find((x) => ["done", "retake", "error"].includes(x.status));
    const busy = S.Q.items.filter((x) => ["checking", "waiting", "reading"].includes(x.status)).length;
    const full = isFull(), total = S.server.queue + localPending();
    const busyNow = S.Q.items.filter((x) => x.status === "reading").length, onPhone = S.Q.items.filter((x) => x.status === "waiting" || x.status === "checking").length;
    const doneN = S.Q.items.filter((x) => x.status === "done").length;
    const line = full ? `⏳ Server busy — ${total} photos in the queue (limit ${S.server.limit}). Wait a moment, the button unlocks by itself.`
      : last ? (last.status === "done" ? `✓ ${esc(last.msg.split(" · ").slice(0, 2).join(" · "))}` : `⚠ ${esc(last.msg)}`) : "Point at the box labels and tap 📷";
    return `<div class="sb-fab">
      <div class="sb-fab-msg ${full ? "busy" : last && last.status !== "done" ? "bad" : ""}">${line}</div>
      ${busyNow || onPhone ? `<div class="sb-slots" aria-label="Processing ${busyNow} of ${WORKERS}">⚙ Processing <b>${busyNow} of ${WORKERS}</b>
        ${Array.from({ length: WORKERS }, (_, i) => `<i class="${i < busyNow ? "on" : ""}"></i>`).join("")}${onPhone ? ` · <b>${onPhone}</b> waiting on the phone` : ""}${doneN ? ` · ${doneN} done` : ""}</div>` : ""}
      <div class="sb-fab-row">
        ${rt.length ? `<label class="sb-fab-btn retake">↻ Retake${rt.length > 1 ? ` (${rt.length})` : ""}<small>${esc((rt[0].msg || "").replace(/\s*\((not uploaded|photo not kept|not saved)\)/, "").slice(0, 46))}</small><input type="file" accept="image/*" capture="environment" hidden data-retake="${rt[0].key}"></label>` : ""}
        <button class="sb-fab-btn cam" data-opencam>📸 Camera<small>square guide · tap tap tap</small></button>
        ${full ? `<div class="sb-fab-btn next off" aria-disabled="true">⏳ Wait — queue full<small>${total} of ${S.server.limit} · unlocks automatically</small></div>`
          : `<label class="sb-fab-btn next">📷 Next photo<input type="file" accept="image/*" capture="environment" hidden data-scan></label>`}
      </div></div>`;
  }

  let refreshT = null;
  const refreshSoon = () => { clearTimeout(refreshT); refreshT = setTimeout(load, 3000); };      // one refresh for a burst of photos
  function queueHtml() {
    const Q = S.Q; if (!Q.items.length) return "";
    const c = (st) => Q.items.filter((x) => x.status === st).length;
    const retakes = Q.items.filter((x) => x.status === "retake" || x.status === "error");
    return `<div class="sb-panel"><div class="sb-row"><h3>⚡ Rapid scan</h3>
      <span class="sb-stat"><b>${c("waiting") + c("reading") + c("checking")}</b> in progress</span><span class="sb-stat ok"><b>${Q.saved}</b> boxes saved</span>
      <span class="sb-stat"><b>${Q.dups}</b> duplicates skipped (not recorded)</span><span class="sb-stat"><b>${Q.fixed}</b> IMEIs fixed up close</span>
      <span class="sb-stat ${retakes.length ? "bad" : ""}"><b>${retakes.length}</b> to retake</span>
      <button class="sb-link" data-qclear>Clear finished</button></div>
      ${retakes.length ? `<div class="sb-retakes">${retakes.slice(0, 12).map((x) => `<div class="sb-rt">${x.thumb ? `<img src="${x.thumb}" alt="">` : ""}<div><b>Take it again</b><small>${esc(x.msg)}</small>
        ${x.local && x.status === "retake" ? `<button class="sb-link" data-force="${x.key}">Use this one anyway</button>` : ""}<button class="sb-link" data-dismiss="${x.key}">Dismiss</button></div></div>`).join("")}</div>` : ""}
      <div class="sb-strip">${Q.items.filter((x) => x.status !== "retake" && x.status !== "error").slice(0, 24).map((x) => `<span class="sb-chip ${x.waiting ? "wait" : x.status}" title="${esc(x.msg)}">${x.status === "done" ? "✓" : x.waiting ? "⏳" : x.status === "reading" ? "⟳" : "…"} ${esc(x.status === "done" ? x.msg.split(" · ")[0] : x.waiting ? "waiting for connection" : x.msg || x.status)}</span>`).join("")}</div></div>`;
  }
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const digits = (s) => String(s || "").replace(/\D/g, "");
  function luhn(s) { if (!/^\d{15}$/.test(s)) return false; let t = 0; for (let i = 0; i < 15; i++) { let d = +s[i]; if (i % 2) { d *= 2; if (d > 9) d -= 9; } t += d; } return t % 10 === 0; }
  const imeiState = (v, how) => (!digits(v) ? "missing" : !luhn(digits(v)) ? "bad" : how === "barcode" ? "barcode" : "valid");
  const MARK = { barcode: ["✓", "exact from barcode", "ok"], valid: ["✓", "check digit OK", "ok"], typed: ["✎", "typed by hand", "dim"], read: ["·", "read from label", "dim"], bad: ["⚠", "fails the IMEI check digit — check it", "bad"], missing: ["—", "not read", "dim"], ignored: ["⊘", "IMEI 2 ignored", "dim"], confirmed: ["✓", "checked by a person", "ok"] };
  const mark = (st) => { const m = MARK[st] || MARK.missing; return `<span class="sb-mk ${m[2]}" title="${esc(m[1])}">${m[0]}</span>`; };
  const post = (u, b) => fetch(u, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(b || {}) })
    .then(async (r) => { const t = await r.text(); try { return { ok: r.ok, j: JSON.parse(t) }; } catch (e) { return { ok: false, j: { error: r.status === 413 ? "The photo is too big for the web server's upload limit." : "Unexpected answer (HTTP " + r.status + ")" } }; } })
    .catch(() => ({ ok: false, j: { error: "Couldn't reach the server" } }));

  /* ---------- reading a photo ---------- */
  function shrink(file, max) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)), cv = document.createElement("canvas");
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k); cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url); res({ b64: cv.toDataURL("image/jpeg", 0.88).split(",")[1], canvas: cv, full: img }); };
      img.onerror = () => rej(new Error("That file isn't a photo MYDAY can open"));
      img.src = url;
    });
  }
  /* Exact barcode values, where the browser can decode them (not Safari). */
  async function barcodes(img) {
    if (!("BarcodeDetector" in window)) return null;
    try { const det = new window.BarcodeDetector(); return (await det.detect(img)).map((b) => String(b.rawValue || "").trim()).filter(Boolean); } catch (e) { return null; }
  }
  const diff = (a, b) => { if (a.length !== b.length) return 99; let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
  /* Swap in barcode values: exact match → confirmed; 1–2 digits off (and a valid IMEI) → corrected. */
  function useBarcodes(box, codes) {
    box.how = {};
    if (!codes) return box;
    const taken = new Set();
    for (const f of ["imei1", "imei2"]) {
      const v = digits(box[f]); if (!v) continue;
      const exact = codes.find((c) => c === v);
      if (exact) { box.how[f] = "barcode"; taken.add(exact); continue; }
      const near = codes.filter((c) => /^\d{15}$/.test(c) && luhn(c) && !taken.has(c) && diff(c, v) <= 2).sort((a, b) => diff(a, v) - diff(b, v))[0];
      if (near) { box.note = [box.note, `${f.toUpperCase()} corrected from barcode (${v} → ${near})`].filter(Boolean).join(" · "); box[f] = near; box.how[f] = "barcode"; taken.add(near); }
    }
    if (box.serial) {
      const s = box.serial.toUpperCase();
      const exact = codes.find((c) => c.toUpperCase() === s), near = !exact && codes.find((c) => c.length === s.length && diff(c.toUpperCase(), s) <= 2 && !/^\d{15}$/.test(c));
      if (exact) box.how.serial = "barcode"; else if (near) { box.note = [box.note, `Serial corrected from barcode (${s} → ${near.toUpperCase()})`].filter(Boolean).join(" · "); box.serial = near.toUpperCase(); box.how.serial = "barcode"; }
    }
    return box;
  }
  async function scan(files) {
    S.review = { photos: [], boxes: [] }; S.busy = `Reading ${files.length} photo${files.length === 1 ? "" : "s"}…`; draw();
    for (const file of files) {
      try {
        const { b64, full } = await shrink(file, 2400);
        const codes = await barcodes(full);
        const { ok, j } = await post("/api/scanbox/read", { image: b64, mime: "image/jpeg" });
        if (!ok) { S.review.error = j.error; continue; }
        S.review.photos.push({ id: j.photoId, codes: codes ? codes.length : null });
        for (const b of j.boxes) S.review.boxes.push({ ...useBarcodes(b, codes), photoId: j.photoId, include: !(b.duplicates || []).length, allowDuplicate: false });
      } catch (e) { S.review.error = String(e.message || e); }
    }
    S.busy = ""; draw();
  }

  /* ---------- saving ---------- */
  async function saveReview() {
    const R = S.review, byPhoto = {};
    for (const b of R.boxes.filter((x) => x.include)) (byPhoto[b.photoId] = byPhoto[b.photoId] || []).push({ ...b, allowDuplicate: b.allowDuplicate });
    S.busy = "Saving…"; draw();
    let saved = 0, skipped = [];
    for (const [photoId, rows] of Object.entries(byPhoto)) {
      const { ok, j } = await post("/api/scanbox/save", { photoId, rows, projectId: S.project && S.project.id !== "none" ? S.project.id : null });
      if (ok) { saved += j.saved.length; skipped = skipped.concat(j.skipped); } else skipped.push({ reason: j.error });
    }
    S.busy = ""; S.review = skipped.length ? { ...R, boxes: [], error: `Saved ${saved}. Skipped ${skipped.length}: ${skipped.map((x) => x.reason).join(" · ")}` } : null;
    const c = ctx(); c && c.setToast && c.setToast(`Saved ${saved} box${saved === 1 ? "" : "es"} to Scanned Boxes`);
    await load();
  }

  /* ---------- the table ---------- */
  async function load() {
    if (!S.project) return draw();
    try { const r = await fetch("/api/scanbox/list?project=" + encodeURIComponent(S.project.id) + (S.showRemoved ? "&removed=1" : ""), { credentials: "same-origin" }); const j = await r.json(); if (r.ok) S.data = j; else S.err = j.error; } catch (e) { S.err = "Couldn't reach the server"; }
    draw();
  }
  function rows() {
    if (!S.data) return [];
    const f = S.f, q = f.q.trim().toLowerCase();
    return S.data.rows.filter((r) => (!f.from || r.at.slice(0, 10) >= f.from) && (!f.to || r.at.slice(0, 10) <= f.to) && (!f.who || (r.byName || r.by) === f.who)
      && (!f.status || (f.status === "storage" ? !r.storage : f.status === "ram" ? !r.ram : f.status === "check" ? r.checks.imei1 === "bad" || (!r.imei1 && !r.serial) : f.status === "check2" ? r.checks.imei2 === "bad" : r.checks.imei1 === "barcode" || r.checks.imei1 === "valid" || r.checks.imei1 === "confirmed"))
      && (!q || [r.brand, r.model, r.colour, r.imei1, r.imei2, r.serial, r.productModel, r.byName].some((x) => String(x || "").toLowerCase().includes(q))));
  }
  async function exportXlsx() {
    const list = rows();
    const r = await fetch("/api/scanbox/export", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: S.project && S.project.id, ids: list.map((x) => x.id), filters: { search: S.f.q, from: S.f.from, to: S.f.to, by: S.f.who, status: S.f.status } }) });
    if (!r.ok) return alert("Export failed");
    const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); const cd = (r.headers.get("content-disposition") || "").match(/filename="([^"]+)"/); a.download = cd ? cd[1] : `scanned-boxes-${new Date().toISOString().slice(0, 10)}.xlsx`; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 1000);
  }

  /* ---------- drawing ---------- */
  const F_EDIT = [["brand", "Brand"], ["model", "Model"], ["colour", "Colour"], ["ram", "RAM"], ["storage", "Storage"], ["imei1", "IMEI 1"], ["imei2", "IMEI 2"], ["serial", "Serial"], ["productModel", "Product model"], ["ean", "Barcode no."]];
  function reviewHtml() {
    const R = S.review; if (!R) return "";
    const live = (b, f) => (f === "imei1" || f === "imei2") ? mark(imeiState(b[f], b.how && b.how[f])) : f === "serial" && b.serial ? mark(b.how && b.how.serial === "barcode" ? "barcode" : "read") : "";
    return `<div class="sb-panel sb-review"><div class="sb-row"><h3>Check before saving <small>${R.boxes.length} box${R.boxes.length === 1 ? "" : "es"} found</small></h3>
      <span class="sb-dim">${R.photos.map((p) => p.codes == null ? "This browser can't read barcodes, so IMEIs are checked by their check digit." : `${p.codes} barcode${p.codes === 1 ? "" : "s"} read exactly from the photo.`).join(" ")}</span></div>
      ${R.error ? `<p class="sb-warn">${esc(R.error)}</p>` : ""}
      ${R.boxes.map((b, k) => `<div class="sb-box ${b.include ? "" : "off"}">
        <label class="sb-inc"><input type="checkbox" data-inc="${k}" ${b.include ? "checked" : ""}> Save</label>
        ${R.photos.length ? `<img src="/api/scanbox/photo/${esc(b.photoId)}" alt="photo" class="sb-thumb" data-photo="${esc(b.photoId)}">` : ""}
        <div class="sb-fields">${F_EDIT.map(([f, l]) => `<label>${l} ${live(b, f)}<input data-rf="${k}:${f}" value="${esc(b[f])}" ${/imei/.test(f) ? 'inputmode="numeric"' : ""}></label>`).join("")}</div>
        <div class="sb-meta">${b.position ? `<span>${esc(b.position)}</span>` : ""}<span>AI ${Math.round((b.confidence || 0) * 100)}% sure</span>${b.note ? `<span class="sb-warn">${esc(b.note)}</span>` : ""}
          ${(b.duplicates || []).length ? `<span class="sb-warn">⚠ Already scanned: ${esc(b.duplicates[0].value)} on ${esc(b.duplicates[0].at.slice(0, 10))} by ${esc(b.duplicates[0].by)}</span>
            <label><input type="checkbox" data-dup="${k}" ${b.allowDuplicate ? "checked" : ""}> save anyway</label>` : ""}</div></div>`).join("")}
      <div class="sb-row"><button class="sb-pri" data-save ${R.boxes.some((b) => b.include) ? "" : "disabled"}>Save ${R.boxes.filter((b) => b.include).length} to the table</button><button class="sb-sec" data-cancel>Cancel</button>
        <span class="sb-dim">⚠ means the IMEI fails its check digit — fix it before saving, or rescan that box close up.</span></div></div>`;
  }
  function tableHtml() {
    const D = S.data; if (!D) return `<p class="sb-dim">Loading…</p>`;
    const list = rows();
    const people = D.people || [];
    return `<div class="sb-filters">
      <input type="search" data-f="q" placeholder="Search model, IMEI, serial…" value="${esc(S.f.q)}" aria-label="Search">
      <label>Status <select data-f="status"><option value="">All</option><option value="check" ${S.f.status === "check" ? "selected" : ""}>⚠ Needs checking (IMEI 1)</option><option value="check2" ${S.f.status === "check2" ? "selected" : ""}>IMEI 2 needs checking</option><option value="ok" ${S.f.status === "ok" ? "selected" : ""}>✓ IMEI verified</option><option value="storage" ${S.f.status === "storage" ? "selected" : ""}>Storage missing</option><option value="ram" ${S.f.status === "ram" ? "selected" : ""}>RAM missing</option></select></label>
      <span class="sb-dim" style="margin-left:auto">${list.length} of ${D.rows.length}${D.owner ? " · you see everyone's scans" : " · your scans"}</span>
      <button class="sb-sec" data-export ${list.length ? "" : "disabled"}>⬇ Excel</button><button class="sb-sec" data-pdf ${list.length ? "" : "disabled"} title="Opens a print view — choose Save as PDF">⬇ PDF with photos</button>
      ${D.owner ? `<label class="sb-tog" style="margin:0"><input type="checkbox" data-showremoved ${S.showRemoved ? "checked" : ""}> Show removed${D.removed ? ` (${D.removed})` : ""}</label>` : ""}
      ${(() => { const sel = D.rows.filter((r) => S.pick.has(r.id)), live = sel.filter((r) => !r.hidden).length, gone = sel.filter((r) => r.hidden).length;
        return `${live ? `<button class="sb-sec warn" data-hide>Remove ${live}</button>` : ""}${gone && D.owner ? `<button class="sb-sec" data-restore>Restore ${gone}</button><button class="sb-sec danger" data-purge>Delete ${gone} permanently</button>` : ""}`; })()}</div>
      ${(() => { const by = {}; D.rows.filter((r) => !r.hidden).forEach((r) => { const k = r.byName || r.by; by[k] = (by[k] || 0) + 1; });
        const e = Object.entries(by).sort((a, b) => b[1] - a[1]);
        return e.length > 1 || D.owner ? `<div class="sb-people">${e.map(([k, n]) => `<span><b>${esc(k)}</b> ${n}</span>`).join("")}${D.rows.some((r) => !r.storage && !r.hidden) ? `<span class="sb-miss">${D.rows.filter((r) => !r.storage && !r.hidden).length} missing storage</span>` : ""}</div>` : ""; })()}
      ${S.pick.size ? `<div class="sb-bulk"><b>${S.pick.size} selected</b> · set
        <select data-bulkf><option value="storage">Storage</option><option value="ram">RAM</option><option value="model">Model</option><option value="colour">Colour</option><option value="brand">Brand</option></select>
        to <input data-bulkv placeholder="e.g. 256GB"><button class="sb-pri" data-bulk>Apply to ${S.pick.size}</button>
        <button class="sb-sec" data-bulkok1>✓ Mark IMEI 1 right on ${S.pick.size}</button><button class="sb-sec" data-bulkign2>⊘ Ignore IMEI 2 on ${S.pick.size}</button></div>` : ""}
      ${(() => { const per = window.MYDAYTables ? window.MYDAYTables.rowsPer() : 20, last = Math.max(0, Math.ceil(list.length / per) - 1);
        S.sbPage = Math.min(S.sbPage || 0, last); S.sbPer = per;
        return list.length > per ? `<div class="sb-pager"><button class="sb-sec" data-sbpg="-1" ${S.sbPage ? "" : "disabled"}>‹ Prev</button> page ${S.sbPage + 1} of ${last + 1} · ${list.length} rows <button class="sb-sec" data-sbpg="1" ${S.sbPage < last ? "" : "disabled"}>Next ›</button></div>` : ""; })()}
      ${S.project && S.project.scanType === "carton" ? cartonTable(list) : `
      <div class="sb-wrap"><table class="sb-table" data-own-pager><thead><tr><th><input type="checkbox" data-all aria-label="Select all"></th><th>Scanned</th><th>By</th><th>Brand</th><th>Model</th><th>Colour</th><th>RAM</th><th>Storage</th><th>IMEI 1</th><th>IMEI 2</th><th>Serial</th><th>Product model</th><th></th></tr>
      <tr class="sb-frow"><td></td><td><input type="date" data-f="from" value="${esc(S.f.from)}" aria-label="From date"><input type="date" data-f="to" value="${esc(S.f.to)}" aria-label="To date"></td>
        <td>${D.owner ? `<select data-f="who" aria-label="Scanned by"><option value="">Everyone</option>${people.map((p) => `<option ${S.f.who === p ? "selected" : ""}>${esc(p)}</option>`).join("")}</select>` : ""}</td>
        <td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td>${S.f.from || S.f.to || S.f.who ? `<button class="sb-link" data-fclear>Clear</button>` : ""}</td></tr></thead><tbody>
      ${list.slice((S.sbPage || 0) * (S.sbPer || 20), ((S.sbPage || 0) + 1) * (S.sbPer || 20)).map((r) => S.edit === r.id ? `<tr class="editing"><td></td><td colspan="13"><div class="sb-fields">${F_EDIT.map(([f, l]) => `<label>${l}<input data-ef="${f}" value="${esc(r[f])}"></label>`).join("")}</div>
          <div class="sb-row"><button class="sb-pri" data-esave="${r.id}">Save changes</button><button class="sb-sec" data-ecancel>Cancel</button>${(r.edits || []).length ? `<span class="sb-dim">${r.edits.length} earlier edit(s): ${esc(r.edits.slice(-3).map((e) => `${e.field} ${e.from || "—"}→${e.to || "—"} by ${e.by}`).join("; "))}</span>` : ""}</div></td></tr>`
        : `<tr class="${r.hidden ? "removed" : ""}"><td><input type="checkbox" data-pick="${r.id}" ${S.pick.has(r.id) ? "checked" : ""}></td><td>${esc(r.at.slice(0, 10))}<small>${esc(r.at.slice(11, 16))}</small>${r.hidden ? `<small class="sb-rm">Removed by ${esc(r.hidden.name || r.hidden.by)} ${esc(String(r.hidden.at).slice(0, 10))}</small>` : ""}</td><td>${esc(r.byName || r.by)}</td>
          <td><b>${esc(r.brand)}</b>${r.source ? `<small class="sb-src">from ${esc(r.source)}</small>` : ""}</td><td>${esc(r.model)}</td><td>${esc(r.colour)}</td><td>${esc(r.ram) || '<span class="sb-miss">—</span>'}${r.filled && r.filled.ram ? `<small>${esc(r.filled.ram)}</small>` : ""}</td><td>${esc(r.storage) || '<span class="sb-miss">missing</span>'}${r.filled && r.filled.storage ? `<small>${esc(r.filled.storage)}</small>` : ""}</td>
          <td class="mono">${mark(r.checks.imei1)} ${esc(r.imei1 || "—")}${r.checks.imei1 === "bad" ? ` <button class="sb-link" data-ok1="${r.id}" title="I checked the box — this IMEI is right">✓ It's right</button>` : r.checks.imei1 === "confirmed" ? `<small>checked by ${esc(r.checks.imei1By || "")} · <button class="sb-link" data-unok1="${r.id}">undo</button></small>` : ""}</td><td class="mono">${mark(r.checks.imei2)} ${esc(r.imei2 || "—")}${r.checks.imei2 === "bad" ? ` <button class="sb-link" data-ok2="${r.id}" title="I checked the box — this IMEI is right">✓ It's right</button> <button class="sb-link" data-ign2="${r.id}" title="Set IMEI 2 aside — IMEI 1 is what counts">⊘ Ignore</button>` : r.checks.imei2 === "ignored" || r.checks.imei2 === "confirmed" ? ` <button class="sb-link" data-unign2="${r.id}">undo</button>` : ""}</td><td class="mono">${mark(r.checks.serial)} ${esc(r.serial || "—")}</td>
          <td class="mono">${esc(r.productModel)}</td><td>${r.photoId ? `<button class="sb-link" data-photo="${esc(r.photoId)}">Photo</button>` : ""} <button class="sb-link" data-edit="${r.id}">Edit</button>${(r.edits || []).length ? `<small>edited</small>` : ""}</td></tr>`).join("")
        || `<tr><td colspan="14" class="sb-empty">${D.rows.length ? "Nothing matches these filters." : "No boxes scanned yet. Tap 📷 Scan boxes to start."}</td></tr>`}</tbody></table></div>
      `}`;
  }
  /* Bulk-carton projects: a table made for carton labels (one row per serial). */
  function cartonTable(list) {
    const D = S.data, people = D.people || [], per = S.sbPer || 20, pg = S.sbPage || 0;
    const rows = list.slice(pg * per, (pg + 1) * per);
    return `<div class="sb-wrap"><table class="sb-table" data-own-pager><thead><tr><th><input type="checkbox" data-all aria-label="Select all"></th><th>Scanned</th><th>By</th><th>Brand</th><th>Product</th><th>Model</th><th>Serial</th><th>IMEI</th><th>Carton SSCC</th><th>GTIN</th><th>Count</th><th></th></tr>
      <tr class="sb-frow"><td></td><td><input type="date" data-f="from" value="${esc(S.f.from)}" aria-label="From date"><input type="date" data-f="to" value="${esc(S.f.to)}" aria-label="To date"></td>
        <td>${D.owner ? `<select data-f="who" aria-label="Scanned by"><option value="">Everyone</option>${people.map((p) => `<option ${S.f.who === p ? "selected" : ""}>${esc(p)}</option>`).join("")}</select>` : ""}</td>
        <td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td>${S.f.from || S.f.to || S.f.who ? `<button class="sb-link" data-fclear>Clear</button>` : ""}</td></tr></thead><tbody>
      ${rows.map((r) => `<tr class="${r.hidden ? "removed" : ""}"><td><input type="checkbox" data-pick="${r.id}" ${S.pick.has(r.id) ? "checked" : ""}></td>
        <td>${esc(r.at.slice(0, 10))}<small>${esc(r.at.slice(11, 16))}</small></td><td>${esc(r.byName || r.by)}</td><td><b>${esc(r.brand)}</b></td>
        <td class="mono">${esc(r.productModel || "—")}</td><td>${esc(r.model || "—")}</td><td class="mono"><b>${esc(r.serial || "—")}</b></td>
        <td class="mono">${r.imei1 ? mark(r.checks.imei1) + " " + esc(r.imei1) : "—"}</td><td class="mono">${esc(r.sscc || "—")}</td><td class="mono">${esc(r.gtin || "—")}</td><td>${esc(r.cartonCount || "—")}</td>
        <td>${r.photoId ? `<button class="sb-link" data-photo="${esc(r.photoId)}">Photo</button>` : ""} <button class="sb-link" data-edit="${r.id}">Edit</button></td></tr>`).join("")
        || `<tr><td colspan="12" class="sb-empty">${D.rows.length ? "Nothing matches these filters." : "No cartons scanned yet. Open 📸 Camera and point it at a carton label."}</td></tr>`}</tbody></table></div>`;
  }
  function draw() {
    if (!S.host) return;
    const c = ctx();
    if (!S.project) {
      S.host.innerHTML = `<div class="sb ${c && c.isDark === false ? "light" : "dark"}" style="--a:${(c && c.accent) || "#2FBF87"}">${projectsHtml()}</div>`;
      drawFab(); return;
    }
    S.host.innerHTML = `<div class="sb ${c && c.isDark === false ? "light" : "dark"}" style="--a:${(c && c.accent) || "#2FBF87"}">
      <div class="sb-projbar"><button class="sb-sec" data-changeproj>← Projects</button><span>Project</span><b>${S.project.locked ? "🔒 " : ""}${esc(S.project.name)}</b><span>${S.project.scanType === "carton" ? "🗃 Bulk carton" : "📦 Device box"}</span>
        ${S.isOwner && !S.project.legacy ? `<span class="sb-defs">If a label has none, use RAM <input data-defram value="${esc((S.project.defaults || {}).ram || "")}" placeholder="—"> Storage <input data-defsto value="${esc((S.project.defaults || {}).storage || "")}" placeholder="—"><button class="sb-link" data-savedefaults>Save</button></span>` : ""}</div>
      ${S.project.locked ? `<div class="sb-panel sb-lockbanner">🔒 Scanning is locked for this project. You can still view and export it. <button class="sb-lock" data-lock="${esc(S.project.id)}">🔓 Unlock scanning</button>
        <button class="sb-sec" data-dropphotos title="Free disk space — keeps all scanned data">🗑 Delete this project's photos (keep the data)</button></div>` : ""}
      <div class="sb-top"><div><h1>Scan Boxes</h1><p class="sb-dim">Photo of one box or a whole stack → brand, model, colour, RAM, storage, IMEIs and serial for each. Every scan is saved with who and when.</p></div>
        <label class="sb-pri sb-cam">📷 Scan boxes<input type="file" accept="image/*" capture="environment" multiple hidden data-scan></label>
        <label class="sb-sec sb-cam">Choose photos<input type="file" accept="image/*" multiple hidden data-scan></label></div>
      ${S.busy ? `<p class="sb-note">${esc(S.busy)}</p>` : ""}${S.err ? `<p class="sb-warn">${esc(S.err)}</p>` : ""}
      <label class="sb-tog"><input type="checkbox" data-rapid ${S.rapid ? "checked" : ""}> ⚡ Rapid mode — shoot without waiting; boxes save straight to the table (turn off to review each photo first)</label>
      ${queueHtml()}${reviewHtml()}${tableHtml()}</div>`;
    drawFab();
  }
  function onClick(e) {
    const t = e.target, R = S.review;
    if (t.closest && t.closest("[data-proj]")) { const id = t.closest("[data-proj]").dataset.proj; S.project = S.projects.find((p) => p.id === id); rememberProject(S.project && !S.project.legacy ? id : ""); S.pick.clear(); S.data = null; draw(); pollQueue(); resumeKept(); return load(); }
    if (t.hasAttribute("data-changeproj")) { S.project = null; rememberProject(""); S.Q = { items: S.Q.items, running: S.Q.running, saved: 0, dups: 0, fixed: 0 }; return loadProjects().then(draw); }
    if (t.hasAttribute("data-newproj")) {
      const name = S.host.querySelector(".sb-newproj").value.trim(); S.projErr = "";
      return post("/api/scanbox/projects", { name }).then(async (x) => { if (!x.ok) { S.projErr = x.j.error; return draw(); } await loadProjects(); draw(); });
    }
    if (t.dataset.rename) { const p = S.projects.find((x) => x.id === t.dataset.rename); const name = prompt("Rename project", p.name); if (!name) return; return post("/api/scanbox/projects", { id: p.id, name }).then(() => loadProjects()).then(draw); }
    if (t.hasAttribute("data-docombine")) {
      const name = (S.host.querySelector("[data-combname]") || {}).value || "";
      if (!name.trim()) return alert("Give the combined project a name.");
      return post("/api/scanbox/combine", { ids: [...S.combine], name }).then(async (x) => { if (!x.ok) return alert(x.j.error); S.combine = new Set(); await loadProjects(); draw(); const c = ctx(); c && c.setToast && c.setToast(`Created "${x.j.project.name}" with ${x.j.rows} rows`); });
    }
    if (t.hasAttribute("data-namelegacy")) {
      const name = prompt("Name for these earlier scans (they become a project):"); if (!name) return;
      return post("/api/scanbox/name-legacy", { name }).then(async (x) => { if (!x.ok) return alert(x.j.error); await loadProjects(); draw(); });
    }
    if (t.hasAttribute("data-pdf")) {
      // Print view of the filtered rows with each photo beside it; the browser's "Save as PDF" makes the file.
      const list = rows().filter((r) => !r.hidden), w = window.open("", "_blank");
      if (!w) return alert("Allow pop-ups for MYDAY to make the PDF.");
      const e = (x) => String(x == null ? "" : x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
      const carton = S.project && S.project.scanType === "carton";
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${e(S.project ? S.project.name : "Scan Boxes")} — scanned boxes</title><style>
        body{font:12px -apple-system,"Segoe UI",Roboto,sans-serif;color:#111;margin:18px}h1{font-size:18px;margin:0 0 4px}p{color:#555;margin:0 0 12px}
        .r{display:flex;gap:12px;border-top:1px solid #ddd;padding:8px 0;page-break-inside:avoid}.r img{width:210px;height:150px;object-fit:contain;background:#f3f3f3;border-radius:6px}
        .n{width:210px;height:150px;display:flex;align-items:center;justify-content:center;background:#f3f3f3;color:#999;border-radius:6px}
        .d{flex:1;display:grid;grid-template-columns:auto 1fr;gap:2px 10px;align-content:start}.d b{color:#555;font-weight:600}.m{font-family:ui-monospace,Menlo,monospace}
        @page{margin:12mm}</style></head><body><h1>${e(S.project ? S.project.name : "Scan Boxes")} — scanned boxes</h1>
        <p>${list.length} rows · exported ${e(new Date().toLocaleString())}</p>
        ${list.map((r) => `<div class="r">${r.photoId ? `<img src="/api/scanbox/photo/${e(r.photoId)}" alt="">` : `<div class="n">no photo</div>`}<div class="d">
          <b>Brand / model</b><span>${e(r.brand)} ${e(r.model)} ${carton ? e(r.productModel) : ""}</span>
          ${carton ? "" : `<b>Colour · RAM · storage</b><span>${e(r.colour)} · ${e(r.ram)} · ${e(r.storage)}</span>`}
          <b>IMEI 1</b><span class="m">${e(r.imei1 || "—")}</span>${carton ? "" : `<b>IMEI 2</b><span class="m">${e(r.imei2 || "—")}</span>`}
          <b>Serial</b><span class="m">${e(r.serial || "—")}</span>${r.source ? `<b>Source</b><span>${e(r.source)}</span>` : ""}${carton ? `<b>Carton</b><span class="m">SSCC ${e(r.sscc)} · GTIN ${e(r.gtin)} · count ${e(r.cartonCount)}</span>` : ""}
          <b>Scanned</b><span>${e(r.at.slice(0, 16).replace("T", " "))} by ${e(r.byName || r.by)}</span></div></div>`).join("")}
        <script>Promise.all([...document.images].map(i=>i.complete?1:new Promise(r=>{i.onload=i.onerror=r}))).then(()=>setTimeout(()=>print(),300))<\/script></body></html>`);
      w.document.close(); return;
    }
    if (t.dataset.sbpg) { S.sbPage = Math.max(0, (S.sbPage || 0) + +t.dataset.sbpg); return draw(); }
    if (t.hasAttribute("data-dropphotos")) {
      if (!confirm(`Delete every photo in "${S.project.name}"? The scanned rows (models, IMEIs, serials…) are all kept — only the pictures go, to free disk space. This can't be undone.`)) return;
      return post("/api/scanbox/drop-photos", { projectId: S.project.id }).then((x) => { const c = ctx(); c && c.setToast && c.setToast(x.ok ? `Deleted ${x.j.photos} photos · freed ${x.j.mb} MB` : x.j.error); load(); });
    }
    if (t.dataset.ok1 || t.dataset.unok1) return post("/api/scanbox/edit", { id: t.dataset.ok1 || t.dataset.unok1, field: "imei1Status", value: t.dataset.ok1 ? "confirmed" : "" }).then(load);
    if (t.dataset.ok2) return post("/api/scanbox/edit", { id: t.dataset.ok2, field: "imei2Status", value: "confirmed" }).then(load);
    if (t.hasAttribute("data-bulkok1")) {
      const ids = S.data.rows.filter((r) => S.pick.has(r.id) && r.checks.imei1 === "bad").map((r) => r.id);
      if (!ids.length) return alert("None of the selected rows has an IMEI 1 flagged.");
      if (!confirm(`Mark IMEI 1 as right on ${ids.length} row(s)? Do this only after checking them against the boxes.`)) return;
      return (async () => { for (const id of ids) await post("/api/scanbox/edit", { id, field: "imei1Status", value: "confirmed" }); S.pick.clear(); const c = ctx(); c && c.setToast && c.setToast(`IMEI 1 marked right on ${ids.length} row(s)`); load(); })();
    }
    if (t.dataset.ign2 || t.dataset.unign2) return post("/api/scanbox/edit", { id: t.dataset.ign2 || t.dataset.unign2, field: "imei2Status", value: t.dataset.ign2 ? "ignored" : "" }).then(load);
    if (t.hasAttribute("data-fclear")) { S.f.from = ""; S.f.to = ""; S.f.who = ""; return draw(); }
    if (t.hasAttribute("data-bulkign2")) {
      const ids = S.data.rows.filter((r) => S.pick.has(r.id) && r.checks.imei2 === "bad").map((r) => r.id);
      if (!ids.length) return alert("None of the selected rows has an IMEI 2 problem.");
      return (async () => { for (const id of ids) await post("/api/scanbox/edit", { id, field: "imei2Status", value: "ignored" }); S.pick.clear(); const c = ctx(); c && c.setToast && c.setToast(`IMEI 2 ignored on ${ids.length} row(s)`); load(); })();
    }
    if (t.hasAttribute("data-bulk")) {
      const field = S.host.querySelector("[data-bulkf]").value, value = S.host.querySelector("[data-bulkv]").value.trim();
      if (!value) return;
      if (!confirm(`Set ${field} to "${value}" on ${S.pick.size} row(s)? Each change is logged.`)) return;
      return post("/api/scanbox/bulk", { ids: [...S.pick], field, value }).then((x) => { S.pick.clear(); const c = ctx(); c && c.setToast && c.setToast(`Updated ${x.j.changed} row(s)`); load(); });
    }
    if (t.hasAttribute("data-savedefaults")) {
      const ram = S.host.querySelector("[data-defram]").value, storage = S.host.querySelector("[data-defsto]").value;
      return post("/api/scanbox/projects", { id: S.project.id, defaults: { ram, storage } }).then(async () => { await loadProjects(); S.project = S.projects.find((x) => x.id === S.project.id) || S.project; const c = ctx(); c && c.setToast && c.setToast("Project defaults saved"); load(); });
    }
    if (t.dataset.lock) {
      const p = S.projects.find((x) => x.id === t.dataset.lock);
      if (!p.locked && !confirm(`Lock "${p.name}" for scanning?\n\nIt disappears from everyone else's list and new photos into it are refused. You can unlock it any time.`)) return;
      return post("/api/scanbox/projects", { id: p.id, locked: !p.locked }).then(async () => { await loadProjects(); if (S.project && S.project.id === p.id) S.project = S.projects.find((x) => x.id === p.id); draw(); });
    }
    if (t.dataset.archive) { const p = S.projects.find((x) => x.id === t.dataset.archive); return post("/api/scanbox/projects", { id: p.id, archived: !p.archived }).then(() => loadProjects()).then(draw); }
    if (t.dataset.photo) { window.open("/api/scanbox/photo/" + t.dataset.photo, "_blank", "noopener"); return; }
    if (t.dataset.force) { const it = S.Q.items.find((x) => x.key === t.dataset.force); if (it && it.img) { it.status = "waiting"; it.msg = ""; it.local = false; draw(); pump(); } return; }
    if (t.dataset.dismiss) { S.Q.items = S.Q.items.filter((x) => x.key !== t.dataset.dismiss); return draw(); }
    if (t.hasAttribute("data-qclear")) { S.Q.items = S.Q.items.filter((x) => !["done", "retake", "error"].includes(x.status)); return draw(); }
    if (t.hasAttribute("data-save")) return saveReview();
    if (t.hasAttribute("data-cancel")) { S.review = null; return draw(); }
    if (t.hasAttribute("data-export")) return exportXlsx();
    if (t.dataset.edit) { S.edit = t.dataset.edit; return draw(); }
    if (t.hasAttribute("data-ecancel")) { S.edit = null; return draw(); }
    if (t.dataset.esave) {
      const id = t.dataset.esave, r = S.data.rows.find((x) => x.id === id);
      const changes = [...S.host.querySelectorAll("[data-ef]")].filter((i) => i.value !== String(r[i.dataset.ef] || ""));
      return (async () => { for (const i of changes) await post("/api/scanbox/edit", { id, field: i.dataset.ef, value: i.value }); S.edit = null; await load(); })();
    }
    const selRows = () => (S.data ? S.data.rows.filter((r) => S.pick.has(r.id)) : []);
    if (t.hasAttribute("data-hide")) {
      const ids = selRows().filter((r) => !r.hidden).map((r) => r.id);
      if (!confirm(`Remove ${ids.length} row(s) from the table? They're hidden, not deleted.`)) return;
      return post("/api/scanbox/hide", { ids }).then(() => { S.pick.clear(); load(); });
    }
    if (t.hasAttribute("data-restore")) {
      const ids = selRows().filter((r) => r.hidden).map((r) => r.id);
      return post("/api/scanbox/restore", { ids }).then((x) => { S.pick.clear(); const c = ctx(); c && c.setToast && c.setToast(`Restored ${x.j.restored}`); load(); });
    }
    if (t.hasAttribute("data-purge")) {
      const ids = selRows().filter((r) => r.hidden).map((r) => r.id);
      if (!confirm(`Delete ${ids.length} removed row(s) PERMANENTLY?\n\nThey and their photos (if no other row uses them) are erased and can't be brought back. A record of the deleted IMEIs/serials is kept.`)) return;
      return post("/api/scanbox/purge", { ids }).then((x) => { S.pick.clear(); const c = ctx(); c && c.setToast && c.setToast(`Deleted ${x.j.deleted} permanently`); load(); });
    }
  }
  function onChange(e) {
    const t = e.target, R = S.review;
    if (t.hasAttribute("data-scan")) {
      let files = [...t.files]; t.value = ""; if (!files.length) return;
      // Choosing many from the gallery: take only what fits in the queue right now.
      const room = Math.max(0, S.server.limit - S.server.queue - localPending());
      if (S.rapid && files.length > room) { alert(`The server queue has room for ${room} more photo${room === 1 ? "" : "s"} right now (limit ${S.server.limit} across everyone). ${room ? `Taking the first ${room}; ` : ""}choose the rest in a moment.`); files = files.slice(0, room); }
      if (files.length) (S.rapid ? enqueue(files) : scan(files)); return;
    }
    if (t.hasAttribute("data-rapid")) { S.rapid = t.checked; return draw(); }
    if (t.dataset.combine) { S.combine = S.combine || new Set(); t.checked ? S.combine.add(t.dataset.combine) : S.combine.delete(t.dataset.combine); return draw(); }
    if (t.dataset.scantype) return post("/api/scanbox/projects", { id: t.dataset.scantype, scanType: t.value }).then(() => loadProjects()).then(draw);
    if (t.dataset.retake) {           // the retake replaces that item
      const files = [...t.files]; t.value = ""; if (!files.length) return;
      S.Q.items = S.Q.items.filter((x) => x.key !== t.dataset.retake);
      return enqueue(files);
    }
    if (t.hasAttribute("data-showremoved")) { S.showRemoved = t.checked; S.pick.clear(); return load(); }
    if (t.dataset.inc != null) { R.boxes[+t.dataset.inc].include = t.checked; return draw(); }
    if (t.dataset.dup != null) { const b = R.boxes[+t.dataset.dup]; b.allowDuplicate = t.checked; if (t.checked) b.include = true; return draw(); }
    if (t.dataset.pick) { t.checked ? S.pick.add(t.dataset.pick) : S.pick.delete(t.dataset.pick); return draw(); }
    if (t.hasAttribute("data-all")) { rows().slice(0, 500).forEach((r) => (t.checked ? S.pick.add(r.id) : S.pick.delete(r.id))); return draw(); }
    if (t.dataset.f && t.tagName !== "INPUT" || (t.dataset.f && t.type === "date")) { S.f[t.dataset.f] = t.value; return draw(); }
  }
  function onInput(e) {
    const t = e.target;
    if (t.dataset.rf) {   // review edits: update live, keep focus
      const [k, f] = t.dataset.rf.split(":"), b = S.review.boxes[+k];
      b[f] = t.value; if (b.how && b.how[f]) delete b.how[f];
      const lab = t.parentElement.querySelector(".sb-mk"); if (lab && (f === "imei1" || f === "imei2")) lab.outerHTML = mark(imeiState(t.value));
      return;
    }
    if (t.dataset.f === "q") { S.f.q = t.value; clearTimeout(S.qt); S.qt = setTimeout(() => { const pos = t.selectionStart; draw(); const i = S.host.querySelector('[data-f="q"]'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }, 200); }
  }
  const CSS = `
  .sb{font:13.5px/1.45 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);padding-bottom:40px}
  .sb.dark{--card:rgba(24,29,38,.62);--bg:rgba(16,20,26,.97);--ink:#E9EDF3;--muted:#8C97A8;--faint:#5E6878;--line:rgba(255,255,255,.08);--chip:rgba(255,255,255,.05)}
  .sb.light{--card:rgba(255,255,255,.72);--bg:rgba(250,251,252,.98);--ink:#141A21;--muted:#5F6B79;--faint:#8D98A6;--line:rgba(20,30,40,.09);--chip:rgba(255,255,255,.8)}
  .sb *{box-sizing:border-box}.sb input,.sb select,.sb button{font:inherit;color:inherit}
  .sb h1{font:600 30px "Iowan Old Style",Palatino,Georgia,serif;letter-spacing:-.02em;margin:22px 0 2px}
  .sb-top{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:12px}.sb-top>div{flex:1;min-width:260px}
  .sb-dim{color:var(--muted);font-size:12.5px;margin:2px 0}.sb-warn{color:#C9A227;font-size:12.5px}.sb-note{color:var(--a);font-weight:600}
  .sb-pri{border:0;border-radius:12px;padding:11px 18px;font-weight:700;color:#fff;background:var(--a);cursor:pointer;font-size:14px}.sb-pri:disabled{opacity:.5}
  .sb-sec{border:1px solid var(--line);background:var(--chip);border-radius:10px;padding:8px 12px;cursor:pointer;color:var(--muted)}.sb-sec.warn{color:#F2545B}
  .sb-cam{display:inline-flex;align-items:center}
  .sb-table tr.removed td{opacity:.55}.sb-table tr.removed td:first-child{opacity:1}.sb-rm{color:#F2545B !important}
  .sb-sec.danger{color:#fff;background:#F2545B;border-color:#F2545B;font-weight:700}
  .sb-fab{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 22px);z-index:45;width:min(560px,calc(100% - 24px));
    display:flex;flex-direction:column;gap:7px;pointer-events:none}
  @media (max-width:860px){.sb-fab{bottom:calc(env(safe-area-inset-bottom,0px) + 84px)}}
  .sb-fab-msg{align-self:center;max-width:100%;pointer-events:auto;font-size:12.5px;font-weight:600;padding:6px 12px;border-radius:999px;background:var(--bg);border:1px solid var(--line);
    color:#22C55E;box-shadow:0 8px 24px -10px rgba(0,0,0,.4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sb-fab-msg.bad{color:#F2545B}.sb-fab-msg span{color:var(--muted);font-weight:400}
  .sb-fab-row{display:flex;gap:8px;pointer-events:auto}
  .sb-fab-btn{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:58px;border-radius:18px;cursor:pointer;font-weight:800;font-size:17px;
    color:#fff;box-shadow:0 14px 34px -12px rgba(0,0,0,.55);user-select:none;-webkit-tap-highlight-color:transparent}
  .sb-fab-btn.next{background:linear-gradient(135deg,var(--a),color-mix(in srgb,var(--a) 70%,#000))}
  .sb-fab-btn.next.off{background:#8C97A8;cursor:not-allowed;box-shadow:none}.sb-fab-msg.busy{color:#C9A227}
  .sb-slots{align-self:center;pointer-events:auto;font-size:12.5px;padding:5px 12px;border-radius:999px;background:var(--bg);border:1px solid var(--line);color:var(--muted);display:flex;gap:5px;align-items:center;box-shadow:0 8px 24px -10px rgba(0,0,0,.4)}
  .sb-slots b{color:var(--ink)}.sb-slots i{width:10px;height:10px;border-radius:3px;background:var(--chip);border:1px solid var(--line);display:inline-block}.sb-slots i.on{background:var(--a);border-color:var(--a);animation:sb-pulse 1s infinite}
  @keyframes sb-pulse{50%{opacity:.45}}
  .sb-fab-btn.cam{background:linear-gradient(135deg,#4C8DF6,#2F62C9);border:0;font:inherit;font-weight:800;font-size:17px}
  .sb-cam-full{position:fixed;inset:0;z-index:2147483600;background:#000}
  .sb-cam-full video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .sb-cam-guide{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);width:min(94vw,120vh);aspect-ratio:16/10;border:3px solid #fff;border-radius:12px;
    box-shadow:0 0 0 100vmax #000;pointer-events:none}
  @media (orientation:landscape){.sb-cam-guide{width:auto;height:min(72vh,56vw)}}
  .sb-cam-guide span{position:absolute;top:-34px;left:0;right:0;text-align:center;color:#fff;font:600 14px ui-sans-serif,-apple-system,sans-serif;text-shadow:0 1px 4px #000}
  .sb-cam-top{position:absolute;top:calc(env(safe-area-inset-top,0px) + 12px);left:12px;right:12px;display:flex;gap:10px;align-items:center;color:#fff;font:600 14px ui-sans-serif,-apple-system,sans-serif}
  .sb-cam-top button{width:44px;height:44px;border-radius:12px;border:0;background:rgba(0,0,0,.5);color:#fff;font-size:18px}.sb-cam-count{flex:1;text-align:center;text-shadow:0 1px 4px #000}.sb-cam-ver{opacity:.6;font-size:11px}
  .sb-cam-bottom{position:absolute;bottom:calc(env(safe-area-inset-bottom,0px) + 26px);left:0;right:0;display:flex;justify-content:center}
  .sb-shutter{width:84px;height:84px;border-radius:50%;border:6px solid #fff;background:rgba(255,255,255,.25);cursor:pointer}.sb-shutter:disabled{opacity:.4}
  .sb-shutter{background:conic-gradient(#22C55E calc(var(--p,0)*360deg),rgba(255,255,255,.25) 0)}
  .sb-cam-bottom{align-items:center;gap:22px}
  .sb-autotog{width:74px;height:40px;border-radius:999px;border:2px solid #fff;background:rgba(0,0,0,.4);color:#fff;font:700 13px ui-sans-serif,-apple-system,sans-serif}.sb-autotog.on{background:#22C55E;border-color:#22C55E}
  .sb-auto-msg{position:absolute;left:0;right:0;bottom:calc(env(safe-area-inset-bottom,0px) + 128px);text-align:center;color:#fff;font:700 16px ui-sans-serif,-apple-system,sans-serif;text-shadow:0 1px 6px #000}.sb-shutter.wait{animation:sb-pulse 1s infinite}.sb-shutter:active{background:#fff;transform:scale(.94)}
  .sb-cam-flash{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);color:#fff;font:800 30px ui-sans-serif,-apple-system,sans-serif;opacity:0;transition:opacity .2s;text-shadow:0 2px 8px #000;pointer-events:none}
  .sb-cam-flash.show{opacity:1}.sb-cam-flash.bad{color:#FFD24A;font-size:20px}
  .sb-fab-btn.retake{background:linear-gradient(135deg,#F2545B,#C7343B)}
  .sb-fab-btn small{font-size:11px;font-weight:600;opacity:.9;max-width:92%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sb-fab-btn:active{transform:scale(.97)}
  .sb{padding-bottom:150px}.sb-fab ~ *{}
  body.sb-on .mda-launch{display:none !important}
  .sb-projbar{display:flex;gap:10px;align-items:center;margin:16px 0 -10px;font-size:13px;color:var(--muted)}.sb-projbar b{color:var(--a);font-size:15px}
  .sb-projs{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;margin-bottom:14px}
  .sb-proj{border:1px solid var(--line);background:var(--card);border-radius:16px;overflow:hidden}.sb-proj.arch{opacity:.6}
  .sb-proj-open{display:flex;flex-direction:column;gap:4px;width:100%;text-align:left;border:0;background:none;padding:16px;cursor:pointer;color:var(--ink)}
  .sb-proj-open b{font-size:17px}.sb-proj-open span{font-size:12.5px;color:var(--muted)}.sb-proj-open:hover{background:var(--chip)}
  .sb-proj-act{display:flex;gap:14px;padding:0 16px 12px}
  .sb-newproj{flex:1;min-width:220px;border:1px solid var(--line);background:var(--chip);border-radius:11px;padding:11px 13px;font-size:15px;color:var(--ink)}
  .sb-proj.locked{border-color:rgba(242,84,91,.45)}
  .sb-lock{border:1px solid var(--line);background:var(--chip);border-radius:9px;padding:5px 10px;font-size:12.5px;font-weight:700;cursor:pointer;color:#F2545B}
  .sb-lock.on{color:#22C55E}.sb-lockbanner{border-color:rgba(242,84,91,.5);display:flex;gap:12px;align-items:center;flex-wrap:wrap;color:var(--ink)}
  .sb-miss{color:#C9A227;font-size:12px;font-weight:600}.sb-table td small{display:block}
  .sb-frow td{padding:4px 6px !important;background:var(--chip)}.sb-frow input,.sb-frow select{display:block;width:100%;min-width:118px;margin:2px 0;border:1px solid var(--line);background:var(--card);border-radius:7px;padding:3px 6px;font-size:12px;color:var(--ink)}
  .sb-pager{display:flex;gap:8px;align-items:center;font-size:12.5px;color:var(--muted);margin:4px 0}
  .sb-proj-type{padding:0 16px 8px;font-size:12px;color:var(--muted)}.sb-proj-type select{border:1px solid var(--line);background:var(--chip);border-radius:8px;padding:4px 6px;color:var(--ink);font-size:12px}
  .sb-pick{display:block;padding:8px 16px 0;font-size:12px;color:var(--muted)}.sb-proj.picked{border-color:var(--a)}.sb-src{display:block;color:var(--a) !important;font-size:11px}
  .sb-people{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 8px}.sb-people span{border:1px solid var(--line);border-radius:999px;padding:3px 10px;font-size:12.5px;color:var(--muted)}.sb-people b{color:var(--ink)}
  .sb-bulk{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:9px 12px;margin-bottom:8px;border:1px solid var(--a);border-radius:12px;background:var(--card);font-size:13px}
  .sb-bulk select,.sb-bulk input{border:1px solid var(--line);background:var(--chip);border-radius:8px;padding:6px 8px;color:var(--ink)}
  .sb-defs{margin-left:auto;display:flex;gap:6px;align-items:center;font-size:12px;flex-wrap:wrap}.sb-defs input{width:70px;border:1px solid var(--line);background:var(--chip);border-radius:8px;padding:4px 7px;color:var(--ink)}
  .sb-arch summary{cursor:pointer;color:var(--muted);margin:6px 0 10px}
  .sb-tog{display:flex;gap:7px;align-items:center;font-size:12.5px;color:var(--muted);margin:0 0 10px}
  .sb-stat{font-size:12.5px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:3px 10px}.sb-stat b{color:var(--ink)}.sb-stat.ok b{color:#22C55E}.sb-stat.bad{border-color:#F2545B;color:#F2545B}
  .sb-retakes{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px;margin:8px 0}
  .sb-rt{display:flex;gap:8px;align-items:center;border:1px solid rgba(242,84,91,.5);border-radius:12px;padding:7px;background:rgba(242,84,91,.06)}
  .sb-rt img{width:54px;height:54px;object-fit:cover;border-radius:8px}.sb-rt small{display:block;color:var(--muted);font-size:11.5px}.sb-rt .sb-link{margin-right:8px}
  .sb-strip{display:flex;gap:5px;flex-wrap:wrap}.sb-chip{font-size:11.5px;border-radius:999px;padding:2px 9px;background:var(--chip);color:var(--muted)}.sb-chip.done{color:#22C55E}.sb-chip.wait{color:#C9A227}.sb-chip.reading{color:var(--a)}
  .sb-link{border:0;background:none;color:var(--a);cursor:pointer;padding:0;text-decoration:underline;font-size:12.5px}
  .sb-panel{border:1px solid var(--line);background:var(--card);border-radius:16px;padding:14px;margin-bottom:14px;-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px)}
  .sb-review{border-color:var(--a)}.sb-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:6px 0}.sb-row h3{margin:0;font-size:15px}.sb-row h3 small{color:var(--faint);font-weight:400}
  .sb-box{display:grid;grid-template-columns:70px 90px 1fr;gap:10px;align-items:start;padding:10px 0;border-top:1px solid var(--line)}.sb-box.off{opacity:.45}
  .sb-inc{font-size:12px;display:flex;gap:5px;align-items:center}.sb-thumb{width:90px;height:90px;object-fit:cover;border-radius:10px;cursor:zoom-in;border:1px solid var(--line)}
  .sb-fields{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px}
  .sb-fields label{display:flex;flex-direction:column;gap:2px;font-size:11px;color:var(--faint)}
  .sb-fields input{border:1px solid var(--line);background:var(--chip);border-radius:8px;padding:6px 8px;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;color:var(--ink)}
  .sb-meta{grid-column:3;display:flex;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--muted)}
  .sb-mk{display:inline-block;min-width:14px;text-align:center;font-weight:800}.sb-mk.ok{color:#22C55E}.sb-mk.bad{color:#F2545B}.sb-mk.dim{color:var(--faint)}
  .sb-filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
  .sb-filters input,.sb-filters select{border:1px solid var(--line);background:var(--chip);border-radius:9px;padding:6px 9px;color:var(--ink)}
  .sb-filters label{font-size:12px;color:var(--faint);display:flex;gap:5px;align-items:center}.sb-filters input[type=search]{min-width:240px}
  .sb-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:14px;background:var(--card)}
  .sb-table{width:100%;border-collapse:collapse;min-width:1050px}.sb-table th{text-align:left;font-size:11px;color:var(--faint);padding:9px 8px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg)}
  .sb-table td{padding:8px;border-bottom:1px solid var(--line);vertical-align:top}.sb-table td small{display:block;color:var(--faint);font-size:11px}
  .sb-table tr.editing td{background:var(--chip)}.mono{font-family:ui-monospace,Menlo,monospace;font-size:12.5px;white-space:nowrap}.sb-empty{text-align:center;color:var(--muted);padding:26px}
  @media (max-width:700px){.sb-box{grid-template-columns:1fr}.sb-meta{grid-column:1}.sb-thumb{width:100%;height:160px}}
  `;
  function mount(host) {
    if (!document.getElementById("sb-css")) { const st = document.createElement("style"); st.id = "sb-css"; st.textContent = CSS; document.head.appendChild(st); }
    document.body.classList.add("sb-on");          // make room for the big buttons
    S.host = host; host.addEventListener("click", onClick); host.addEventListener("change", onChange); host.addEventListener("input", onInput);
    draw(); loadProjects().then(() => (S.project ? load() : draw())).then(pollQueue).then(resumeKept);
  }
  function unmount() { S.host = null; document.body.classList.remove("sb-on"); drawFab(); }
  window.addEventListener("myday-rows", () => { S.sbPage = 0; draw(); });
  window.MYDAYScanBox = { _auto: () => AUTO.lastInfo && { edges: +AUTO.lastInfo.edges.toFixed(3), sharp: Math.round(AUTO.lastInfo.sharp), mean: Math.round(AUTO.lastInfo.mean), moving: +AUTO.lastInfo.moving.toFixed(1), need: AUTO.need && +AUTO.need.toFixed(3), ring: AUTO.lastInfo.ring != null ? +AUTO.lastInfo.ring.toFixed(3) : null, bars: AUTO.lastInfo.bars, isLabel: AUTO.lastInfo.isLabel, bg: AUTO.bg != null ? +AUTO.bg.toFixed(3) : null }, mount, unmount, _useBarcodes: useBarcodes, _luhn: luhn, _rotCanvas: rotCanvas };
})();
