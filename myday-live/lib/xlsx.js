/* A small .xlsx reader.
 *
 * An xlsx file is a zip of XML. Node can inflate, so this opens the zip
 * by hand and reads the two parts that matter: the shared strings table
 * and the first worksheet. No npm package, which keeps the server with
 * zero dependencies.
 */

const zlib = require("node:zlib");

/* ---- the zip ---- */

function entries(buf) {
  // The central directory is at the end, after the end-of-central-directory record.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    out.push({ name, method, compSize, localOff });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function read(buf, e) {
  // Skip the local header, whose name and extra lengths can differ from the central one.
  const lp = e.localOff;
  if (buf.readUInt32LE(lp) !== 0x04034b50) throw new Error("damaged entry: " + e.name);
  const nameLen = buf.readUInt16LE(lp + 26);
  const extraLen = buf.readUInt16LE(lp + 28);
  const start = lp + 30 + nameLen + extraLen;
  const raw = buf.slice(start, start + e.compSize);
  return e.method === 0 ? raw : zlib.inflateRawSync(raw);
}

/* ---- the xml ---- */

const unescape = (s) => String(s)
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
  .replace(/&amp;/g, "&");

/* Shared strings: every piece of text in the workbook, by number. */
function sharedStrings(xml) {
  const out = [];
  const items = xml.split(/<si[\s>]/).slice(1);
  for (const item of items) {
    const body = item.slice(0, item.indexOf("</si>") + 1);
    let text = "";
    const re = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let m;
    while ((m = re.exec(body))) text += unescape(m[1]);
    out.push(text);
  }
  return out;
}

const colOf = (ref) => {
  const m = String(ref).match(/^([A-Z]+)/);
  if (!m) return 0;
  let n = 0;
  for (const c of m[1]) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
};
const rowOf = (ref) => parseInt(String(ref).replace(/^[A-Z]+/, ""), 10) || 0;

/* One sheet as an array of rows, each an array of values. */
function sheetRows(xml, strings) {
  const rows = [];
  const parts = xml.split(/<row[\s>]/).slice(1);
  for (const part of parts) {
    const end = part.indexOf("</row>");
    const body = end >= 0 ? part.slice(0, end) : part;
    const cells = [];
    const re = /<c\s([^>]*)>([\s\S]*?)<\/c>|<c\s([^>]*)\/>/g;
    let m;
    while ((m = re.exec(body))) {
      const attrs = m[1] || m[3] || "";
      const inner = m[2] || "";
      const ref = (attrs.match(/r="([^"]+)"/) || [])[1] || "";
      const type = (attrs.match(/t="([^"]+)"/) || [])[1] || "";
      let value = null;
      if (type === "inlineStr") {
        const t = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        value = t ? unescape(t[1]) : "";
      } else {
        const v = inner.match(/<v>([\s\S]*?)<\/v>/);
        if (v) {
          const raw = unescape(v[1]);
          if (type === "s") value = strings[parseInt(raw, 10)] ?? "";
          else if (type === "b") value = raw === "1";
          else if (type === "str" || type === "e") value = raw;
          else {
            const n = parseFloat(raw);
            value = Number.isNaN(n) ? raw : n;
          }
        }
      }
      const idx = colOf(ref) - 1;
      if (idx >= 0) cells[idx] = value;
    }
    const r = rowOf((body.match(/r="([A-Z]+\d+)"/) || [])[1] || "");
    rows[(r || rows.length + 1) - 1] = cells;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

/* The first worksheet of a workbook, as rows of values. */
function readSheet(buffer) {
  const all = entries(buffer);
  const find = (re) => all.find((e) => re.test(e.name));

  const ss = find(/^xl\/sharedStrings\.xml$/);
  const strings = ss ? sharedStrings(read(buffer, ss).toString("utf8")) : [];

  let sheet = find(/^xl\/worksheets\/sheet1\.xml$/)
    || all.find((e) => /^xl\/worksheets\/.*\.xml$/.test(e.name));
  if (!sheet) throw new Error("no worksheet in that file");

  let name = "Sheet1";
  const wb = find(/^xl\/workbook\.xml$/);
  if (wb) {
    const m = read(buffer, wb).toString("utf8").match(/<sheet[^>]*name="([^"]+)"/);
    if (m) name = unescape(m[1]);
  }
  return { name, rows: sheetRows(read(buffer, sheet).toString("utf8"), strings) };
}

module.exports = { readSheet };
