"use strict";
/* Streams a .zip of PDFs (one per 500 rows) with each row's photo — built photo by photo, never all in memory.
   Dependency-free: stored (uncompressed) zip entries with data descriptors; PDFs embed the JPEGs as-is. */
const fs = require("node:fs");
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (c, b) => { c = ~c >>> 0; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return ~c >>> 0; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }, u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
function jpegSize(b) { for (let i = 2; i < b.length - 9;) { if (b[i] !== 0xff) { i++; continue; } const m = b[i + 1]; if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }; i += 2 + b.readUInt16BE(i + 2); } return null; }
const txt = (s) => String(s == null ? "" : s).replace(/[^\x20-\x7e]/g, "?").replace(/([()\\])/g, "\\$1");

async function stream(res, { name, rows, photoPath, per = 500 }) {
  let off = 0; const central = [];
  const out = (b) => new Promise((ok) => { off += b.length; res.write(b) ? ok() : res.once("drain", ok); });
  for (let start = 0; start < rows.length; start += per) {
    const part = rows.slice(start, start + per), fname = Buffer.from(`${name} ${start + 1}-${start + part.length}.pdf`.replace(/[\\/:*?"<>|]+/g, "-"));
    const lho = off; let c = 0, size = 0;
    await out(Buffer.concat([u32(0x04034b50), u16(20), u16(0x0808), u16(0), u16(0), u16(0), u32(0), u32(0), u32(0), u16(fname.length), u16(0), fname]));
    let pos = 0; const xref = [];
    const w = async (b) => { b = Buffer.isBuffer(b) ? b : Buffer.from(b, "latin1"); c = crc(c, b); size += b.length; pos += b.length; await out(b); };
    const obj = async (id, body) => { xref[id] = pos; await w(`${id} 0 obj\n`); for (const x of [].concat(body)) await w(x); await w("\nendobj\n"); };
    await w("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
    await obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    let id = 4; const kids = [], imgs = new Map();
    for (let p = 0; p < part.length; p += 4) {
      const items = part.slice(p, p + 4); let content = `BT /F1 10 Tf 36 812 Td (${txt(`${name} - rows ${start + p + 1}-${start + p + items.length} of ${rows.length}`)}) Tj ET\n`; const xo = [];
      for (let k = 0; k < items.length; k++) {
        const r = items[k], top = 790 - k * 188;
        let ref = r.photoId && imgs.get(r.photoId);
        if (r.photoId && !ref) {
          let jpg = null; try { jpg = fs.readFileSync(photoPath(r.photoId)); } catch (e) {}
          const d = jpg && jpegSize(jpg);
          if (d) { ref = { id: id++, ...d }; imgs.set(r.photoId, ref); await obj(ref.id, [`<< /Type /XObject /Subtype /Image /Width ${d.w} /Height ${d.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`, jpg, "\nendstream"]); }
        }
        if (ref) { const s = Math.min(220 / ref.w, 165 / ref.h), iw = ref.w * s, ih = ref.h * s; content += `q ${iw.toFixed(1)} 0 0 ${ih.toFixed(1)} 36 ${(top - ih).toFixed(1)} cm /Im${ref.id} Do Q\n`; xo.push(ref.id); }
        else content += `BT /F1 9 Tf 90 ${top - 85} Td (no photo) Tj ET\n`;
        const lines = [[`${r.brand || ""} ${r.model || ""} ${r.productModel || ""}`, 11], [`Colour ${r.colour || "-"}   RAM ${r.ram || "-"}   Storage ${r.storage || "-"}`], [`IMEI 1: ${r.imei1 || "-"}`], [`IMEI 2: ${r.imei2 || "-"}`], [`Serial: ${r.serial || "-"}`],
          ...(r.sscc ? [[`Carton SSCC ${r.sscc}  GTIN ${r.gtin || "-"}  count ${r.cartonCount || "-"}`]] : []), ...(r.source ? [[`Source: ${r.source}`]] : []), [`Scanned ${String(r.at || "").slice(0, 16).replace("T", " ")} by ${r.byName || r.by || ""}`]];
        let y = top - 12; for (const [t, sz] of lines) { content += `BT /F1 ${sz || 9} Tf 270 ${y} Td (${txt(t)}) Tj ET\n`; y -= sz ? 16 : 13; }
        content += `0.85 G 36 ${top - 176} m 559 ${top - 176} l S\n`;
      }
      const cid = id++, pid = id++;
      await obj(cid, [`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n`, content, "endstream"]);
      await obj(pid, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> /XObject << ${[...new Set(xo)].map((i) => `/Im${i} ${i} 0 R`).join(" ")} >> >> /Contents ${cid} 0 R >>`);
      kids.push(pid);
      if (imgs.size > 200) imgs.clear();                       // keep memory small; photos rarely repeat across far pages
    }
    await obj(2, `<< /Type /Pages /Kids [${kids.map((k) => k + " 0 R").join(" ")}] /Count ${kids.length} >>`);
    await obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    const xpos = pos; let x = `xref\n0 ${id}\n0000000000 65535 f \n`;
    for (let i = 1; i < id; i++) x += (xref[i] != null ? String(xref[i]).padStart(10, "0") + " 00000 n " : "0000000000 65535 f ") + "\n";
    await w(x + `trailer\n<< /Size ${id} /Root 1 0 R >>\nstartxref\n${xpos}\n%%EOF\n`);
    await out(Buffer.concat([u32(0x08074b50), u32(c), u32(size), u32(size)]));
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x0808), u16(0), u16(0), u16(0), u32(c), u32(size), u32(size), u16(fname.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(lho), fname]));
  }
  const cd = off, cdb = Buffer.concat(central);
  await out(cdb); await out(Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(cdb.length), u32(cd), u16(0)]));
  res.end();
}
module.exports = { stream, jpegSize };
