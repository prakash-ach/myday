/* Scan Boxes — the screen. Photo → one row per box → review → saved to the
   shared table (who + when). People see their own rows; the owner sees all. */
(function () {
  "use strict";
  const ctx = () => window.__myday || null;
  const S = { host: null, data: null, review: null, busy: "", f: { q: "", from: "", to: "", who: "", status: "" }, edit: null, pick: new Set(), showRemoved: false,
    rapid: true, Q: { items: [], running: 0, saved: 0, dups: 0, fixed: 0 } };
  const WORKERS = 4;

  /* ---------- rapid mode: check on the phone, queue, read 4 at a time, save straight in ---------- */
  /* Is this photo usable? Checked on the phone, before anything is uploaded. */
  function quality(img) {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (Math.max(w, h) < 1000) return "too small — move closer or use the full camera";
    const k = 640 / Math.max(w, h), cw = Math.round(w * k), ch = Math.round(h * k), cv = document.createElement("canvas");
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
    if (varLap < 40) return "too blurry — hold still and tap to focus";
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
      const it = { key: Math.random().toString(36).slice(2), file, name: file.name, status: "checking", msg: "" };
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
      S.Q.running++; it.status = "reading"; draw();
      work(it).finally(() => { S.Q.running--; it.img = it.status === "retake" ? it.img : null; draw(); refreshSoon(); pump(); });
    }
  }
  async function work(it) {
    const { ok, j } = await post("/api/scanbox/read", { image: jpeg(it.img, 2400), mime: "image/jpeg", auto: true });
    if (!ok) { it.status = "error"; it.msg = j.error; return; }
    if (j.retake) { it.status = "retake"; it.msg = j.retake + " (photo not kept)"; return; }
    it.status = "done"; it.saved = j.saved; it.dups = j.duplicates; S.Q.saved += j.saved; S.Q.dups += j.duplicates;
    it.msg = `${j.saved} saved${j.duplicates ? ` · ${j.duplicates} duplicate${j.duplicates === 1 ? "" : "s"} skipped` : ""}`;
    // Close-up re-read for boxes whose IMEI is missing or fails its check digit.
    const W = it.img.naturalWidth, H = it.img.naturalHeight;
    // Close-up when an IMEI is missing/fails its check, the serial is missing, or a turned box wasn't read with confidence.
    const needs = (j.boxes || []).filter((b) => b.rowId && b.box && (!luhn(digits(b.imei1)) || (b.imei2 && !luhn(digits(b.imei2))) || !b.serial || (b.rotation && (b.confidence || 0) < 0.8)));
    if (needs.length) { it.msg += ` · re-reading ${needs.length} up close…`; draw(); }
    let fixed = 0;
    await Promise.all(needs.map(async (b) => {
      const [x, y, w, h] = b.box, pad = 0.04;
      const sx = Math.max(0, (x - pad) * W), sy = Math.max(0, (y - pad) * H), sw = Math.min(W - sx, (w + 2 * pad) * W), sh = Math.min(H - sy, (h + 2 * pad) * H);
      if (sw < 50 || sh < 50) return;
      const r = await post("/api/scanbox/reread", { id: b.rowId, image: jpeg(it.img, 1800, [sx, sy, sw, sh], b.rotation) });
      if (r.ok && r.j.duplicate) { it.saved--; S.Q.saved--; it.dups++; S.Q.dups++; }
      else if (r.ok && r.j.changed) fixed++;
    }));
    if (needs.length) { it.msg = `${it.saved} saved${it.dups ? ` · ${it.dups} duplicate${it.dups === 1 ? "" : "s"} skipped` : ""} · ${fixed} of ${needs.length} fixed up close`; S.Q.fixed += fixed; }
  }
  let refreshT = null;
  const refreshSoon = () => { clearTimeout(refreshT); refreshT = setTimeout(load, 800); };
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
      <div class="sb-strip">${Q.items.filter((x) => x.status !== "retake" && x.status !== "error").slice(0, 24).map((x) => `<span class="sb-chip ${x.status}" title="${esc(x.msg)}">${x.status === "done" ? "✓" : x.status === "reading" ? "⟳" : "…"} ${esc(x.status === "done" ? x.msg.split(" · ")[0] : x.status)}</span>`).join("")}</div></div>`;
  }
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const digits = (s) => String(s || "").replace(/\D/g, "");
  function luhn(s) { if (!/^\d{15}$/.test(s)) return false; let t = 0; for (let i = 0; i < 15; i++) { let d = +s[i]; if (i % 2) { d *= 2; if (d > 9) d -= 9; } t += d; } return t % 10 === 0; }
  const imeiState = (v, how) => (!digits(v) ? "missing" : !luhn(digits(v)) ? "bad" : how === "barcode" ? "barcode" : "valid");
  const MARK = { barcode: ["✓", "exact from barcode", "ok"], valid: ["✓", "check digit OK", "ok"], typed: ["✎", "typed by hand", "dim"], read: ["·", "read from label", "dim"], bad: ["⚠", "fails the IMEI check digit — check it", "bad"], missing: ["—", "not read", "dim"] };
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
      const { ok, j } = await post("/api/scanbox/save", { photoId, rows });
      if (ok) { saved += j.saved.length; skipped = skipped.concat(j.skipped); } else skipped.push({ reason: j.error });
    }
    S.busy = ""; S.review = skipped.length ? { ...R, boxes: [], error: `Saved ${saved}. Skipped ${skipped.length}: ${skipped.map((x) => x.reason).join(" · ")}` } : null;
    const c = ctx(); c && c.setToast && c.setToast(`Saved ${saved} box${saved === 1 ? "" : "es"} to Scanned Boxes`);
    await load();
  }

  /* ---------- the table ---------- */
  async function load() {
    try { const r = await fetch("/api/scanbox/list" + (S.showRemoved ? "?removed=1" : ""), { credentials: "same-origin" }); const j = await r.json(); if (r.ok) S.data = j; else S.err = j.error; } catch (e) { S.err = "Couldn't reach the server"; }
    draw();
  }
  function rows() {
    if (!S.data) return [];
    const f = S.f, q = f.q.trim().toLowerCase();
    return S.data.rows.filter((r) => (!f.from || r.at.slice(0, 10) >= f.from) && (!f.to || r.at.slice(0, 10) <= f.to) && (!f.who || (r.byName || r.by) === f.who)
      && (!f.status || (f.status === "check" ? [r.checks.imei1, r.checks.imei2].includes("bad") || (!r.imei1 && !r.serial) : r.checks.imei1 === "barcode" || r.checks.imei1 === "valid"))
      && (!q || [r.brand, r.model, r.colour, r.imei1, r.imei2, r.serial, r.productModel, r.byName].some((x) => String(x || "").toLowerCase().includes(q))));
  }
  async function exportXlsx() {
    const list = rows();
    const r = await fetch("/api/scanbox/export", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: list.map((x) => x.id), filters: { search: S.f.q, from: S.f.from, to: S.f.to, by: S.f.who, status: S.f.status } }) });
    if (!r.ok) return alert("Export failed");
    const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = `scanned-boxes-${new Date().toISOString().slice(0, 10)}.xlsx`; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 1000);
  }

  /* ---------- drawing ---------- */
  const F_EDIT = [["brand", "Brand"], ["model", "Model"], ["colour", "Colour"], ["ram", "RAM"], ["storage", "Storage"], ["imei1", "IMEI 1"], ["imei2", "IMEI 2"], ["serial", "Serial"], ["productModel", "Product model"]];
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
      <label>From <input type="date" data-f="from" value="${esc(S.f.from)}"></label><label>To <input type="date" data-f="to" value="${esc(S.f.to)}"></label>
      ${D.owner ? `<label>Scanned by <select data-f="who"><option value="">Everyone</option>${people.map((p) => `<option ${S.f.who === p ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></label>` : ""}
      <label>Status <select data-f="status"><option value="">All</option><option value="check" ${S.f.status === "check" ? "selected" : ""}>⚠ Needs checking</option><option value="ok" ${S.f.status === "ok" ? "selected" : ""}>✓ IMEI verified</option></select></label>
      <span class="sb-dim" style="margin-left:auto">${list.length} of ${D.rows.length}${D.owner ? " · you see everyone's scans" : " · your scans"}</span>
      <button class="sb-sec" data-export ${list.length ? "" : "disabled"}>⬇ Excel</button>
      ${D.owner ? `<label class="sb-tog" style="margin:0"><input type="checkbox" data-showremoved ${S.showRemoved ? "checked" : ""}> Show removed${D.removed ? ` (${D.removed})` : ""}</label>` : ""}
      ${(() => { const sel = D.rows.filter((r) => S.pick.has(r.id)), live = sel.filter((r) => !r.hidden).length, gone = sel.filter((r) => r.hidden).length;
        return `${live ? `<button class="sb-sec warn" data-hide>Remove ${live}</button>` : ""}${gone && D.owner ? `<button class="sb-sec" data-restore>Restore ${gone}</button><button class="sb-sec danger" data-purge>Delete ${gone} permanently</button>` : ""}`; })()}</div>
      <div class="sb-wrap"><table class="sb-table"><thead><tr><th><input type="checkbox" data-all aria-label="Select all"></th><th>Scanned</th><th>By</th><th>Brand</th><th>Model</th><th>Colour</th><th>RAM</th><th>Storage</th><th>IMEI 1</th><th>IMEI 2</th><th>Serial</th><th>Product model</th><th></th></tr></thead><tbody>
      ${list.slice(0, 500).map((r) => S.edit === r.id ? `<tr class="editing"><td></td><td colspan="13"><div class="sb-fields">${F_EDIT.map(([f, l]) => `<label>${l}<input data-ef="${f}" value="${esc(r[f])}"></label>`).join("")}</div>
          <div class="sb-row"><button class="sb-pri" data-esave="${r.id}">Save changes</button><button class="sb-sec" data-ecancel>Cancel</button>${(r.edits || []).length ? `<span class="sb-dim">${r.edits.length} earlier edit(s): ${esc(r.edits.slice(-3).map((e) => `${e.field} ${e.from || "—"}→${e.to || "—"} by ${e.by}`).join("; "))}</span>` : ""}</div></td></tr>`
        : `<tr class="${r.hidden ? "removed" : ""}"><td><input type="checkbox" data-pick="${r.id}" ${S.pick.has(r.id) ? "checked" : ""}></td><td>${esc(r.at.slice(0, 10))}<small>${esc(r.at.slice(11, 16))}</small>${r.hidden ? `<small class="sb-rm">Removed by ${esc(r.hidden.name || r.hidden.by)} ${esc(String(r.hidden.at).slice(0, 10))}</small>` : ""}</td><td>${esc(r.byName || r.by)}</td>
          <td><b>${esc(r.brand)}</b></td><td>${esc(r.model)}</td><td>${esc(r.colour)}</td><td>${esc(r.ram)}</td><td>${esc(r.storage)}</td>
          <td class="mono">${mark(r.checks.imei1)} ${esc(r.imei1 || "—")}</td><td class="mono">${mark(r.checks.imei2)} ${esc(r.imei2 || "—")}</td><td class="mono">${mark(r.checks.serial)} ${esc(r.serial || "—")}</td>
          <td class="mono">${esc(r.productModel)}</td><td>${r.photoId ? `<button class="sb-link" data-photo="${esc(r.photoId)}">Photo</button>` : ""} <button class="sb-link" data-edit="${r.id}">Edit</button>${(r.edits || []).length ? `<small>edited</small>` : ""}</td></tr>`).join("")
        || `<tr><td colspan="14" class="sb-empty">${D.rows.length ? "Nothing matches these filters." : "No boxes scanned yet. Tap 📷 Scan boxes to start."}</td></tr>`}</tbody></table></div>
      ${list.length > 500 ? `<p class="sb-dim">Showing the newest 500 — use the filters or Excel for the rest.</p>` : ""}`;
  }
  function draw() {
    if (!S.host) return;
    const c = ctx();
    S.host.innerHTML = `<div class="sb ${c && c.isDark === false ? "light" : "dark"}" style="--a:${(c && c.accent) || "#2FBF87"}">
      <div class="sb-top"><div><h1>Scan Boxes</h1><p class="sb-dim">Photo of one box or a whole stack → brand, model, colour, RAM, storage, IMEIs and serial for each. Every scan is saved with who and when.</p></div>
        <label class="sb-pri sb-cam">📷 Scan boxes<input type="file" accept="image/*" capture="environment" multiple hidden data-scan></label>
        <label class="sb-sec sb-cam">Choose photos<input type="file" accept="image/*" multiple hidden data-scan></label></div>
      ${S.busy ? `<p class="sb-note">${esc(S.busy)}</p>` : ""}${S.err ? `<p class="sb-warn">${esc(S.err)}</p>` : ""}
      <label class="sb-tog"><input type="checkbox" data-rapid ${S.rapid ? "checked" : ""}> ⚡ Rapid mode — shoot without waiting; boxes save straight to the table (turn off to review each photo first)</label>
      ${queueHtml()}${reviewHtml()}${tableHtml()}</div>`;
  }
  function onClick(e) {
    const t = e.target, R = S.review;
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
    if (t.hasAttribute("data-scan")) { const files = [...t.files]; t.value = ""; if (files.length) (S.rapid ? enqueue(files) : scan(files)); return; }
    if (t.hasAttribute("data-rapid")) { S.rapid = t.checked; return draw(); }
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
  .sb-tog{display:flex;gap:7px;align-items:center;font-size:12.5px;color:var(--muted);margin:0 0 10px}
  .sb-stat{font-size:12.5px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:3px 10px}.sb-stat b{color:var(--ink)}.sb-stat.ok b{color:#22C55E}.sb-stat.bad{border-color:#F2545B;color:#F2545B}
  .sb-retakes{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px;margin:8px 0}
  .sb-rt{display:flex;gap:8px;align-items:center;border:1px solid rgba(242,84,91,.5);border-radius:12px;padding:7px;background:rgba(242,84,91,.06)}
  .sb-rt img{width:54px;height:54px;object-fit:cover;border-radius:8px}.sb-rt small{display:block;color:var(--muted);font-size:11.5px}.sb-rt .sb-link{margin-right:8px}
  .sb-strip{display:flex;gap:5px;flex-wrap:wrap}.sb-chip{font-size:11.5px;border-radius:999px;padding:2px 9px;background:var(--chip);color:var(--muted)}.sb-chip.done{color:#22C55E}.sb-chip.reading{color:var(--a)}
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
    S.host = host; host.addEventListener("click", onClick); host.addEventListener("change", onChange); host.addEventListener("input", onInput);
    draw(); load();
  }
  function unmount() { S.host = null; }
  window.MYDAYScanBox = { mount, unmount, _useBarcodes: useBarcodes, _luhn: luhn, _rotCanvas: rotCanvas };
})();
