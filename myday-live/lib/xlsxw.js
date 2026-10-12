/* A small, dependency-free .xlsx writer.
 *
 * Writes genuine Office Open XML workbooks (a zip of XML parts), with:
 * bold header row, frozen panes, autofilter, column widths, number formats
 * (money, percent, integer), and fill colours for the priority meanings.
 * Strings are written inline, so identifiers like IMEIs and SKUs stay text
 * exactly as given — leading zeros and all.
 *
 *   const xlsx = build([{ name, columns: [{ header, width, type, key }], rows, freeze: true, fills }])
 *   type: "text" | "int" | "money" | "pct" | "num"; a cell may be { v, fill: "red" } to colour it.
 */

const zlib = require("node:zlib");

/* ---------- zip (deflate) ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zip(files) {
  const parts = [], central = []; let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8"), data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, "utf8");
    const comp = zlib.deflateRawSync(data, { level: 6 }), crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, name);
    off += lh.length + name.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

/* ---------- styles ---------- */
// Fill colours (light, readable) for the priority meanings.
const FILLS = { red: "FFFAD4D4", amber: "FFFDEBC8", green: "FFD5F2E3", gray: "FFE7E9EC", blue: "FFD6E6FB", purple: "FFE9DDF9", head: "FF1F2937", note: "FFF4F6F8" };
const FILL_KEYS = Object.keys(FILLS);
const FMT = { text: 49, int: 3, money: 164, pct: 165, num: 4, date: 0 };   // 49 = "@" text
const TYPES = ["text", "int", "money", "pct", "num"];
// style index = 1 + header? ... built as a grid: for each type × (no fill + each fill) → one xf. Header style is last.
function stylesXml() {
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>',
    ...FILL_KEYS.map((k) => `<fill><patternFill patternType="solid"><fgColor rgb="${FILLS[k]}"/><bgColor indexed="64"/></patternFill></fill>`)];
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  for (const t of TYPES) {
    xfs.push(`<xf numFmtId="${FMT[t]}" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>`);
    FILL_KEYS.forEach((k, i) => xfs.push(`<xf numFmtId="${FMT[t]}" fontId="0" fillId="${i + 2}" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>`));
  }
  xfs.push(`<xf numFmtId="49" fontId="1" fillId="${FILL_KEYS.indexOf("head") + 2}" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>`);
  xfs.push(`<xf numFmtId="49" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>`);   // title
  xfs.push(`<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>`);   // wrapped note
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00;[Red]-&quot;$&quot;#,##0.00"/><numFmt numFmtId="165" formatCode="0.00&quot;%&quot;"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
<fills count="${fills.length}">${fills.join("")}</fills>
<borders count="2"><border/><border><left style="thin"><color rgb="FFE1E4E8"/></left><right style="thin"><color rgb="FFE1E4E8"/></right><top style="thin"><color rgb="FFE1E4E8"/></top><bottom style="thin"><color rgb="FFE1E4E8"/></bottom></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}
const styleId = (type, fill) => 1 + TYPES.indexOf(TYPES.includes(type) ? type : "text") * (FILL_KEYS.length + 1) + (fill && FILL_KEYS.includes(fill) ? FILL_KEYS.indexOf(fill) + 1 : 0);
const HEAD = 1 + TYPES.length * (FILL_KEYS.length + 1), TITLE = HEAD + 1, WRAP = HEAD + 2;

/* ---------- sheets ---------- */
const esc = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const col = (n) => { let s = ""; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
function cell(ref, v, type, fill, forceStyle) {
  const s = forceStyle != null ? forceStyle : styleId(type, fill);
  if (v === null || v === undefined || v === "") return fill || forceStyle != null ? `<c r="${ref}" s="${s}"/>` : "";
  if (type !== "text" && typeof v === "number" && isFinite(v)) return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}
function sheetXml(sh) {
  const cols = sh.columns || [];
  const rowsXml = [];
  let r = 1;
  const pre = sh.preface || [];   // lines above the table (title, notes)
  for (const p of pre) { rowsXml.push(`<row r="${r}">${cell("A" + r, p.text, "text", null, p.title ? TITLE : WRAP)}</row>`); r++; }
  const headRow = r;
  if (cols.length) {
    rowsXml.push(`<row r="${r}" ht="30" customHeight="1">${cols.map((c, i) => cell(col(i) + r, c.header, "text", null, HEAD)).join("")}</row>`); r++;
    for (const row of sh.rows || []) {
      const fillRow = row.__fill;
      rowsXml.push(`<row r="${r}">${cols.map((c, i) => {
        let v = typeof c.get === "function" ? c.get(row) : row[c.key];
        let fill = c.fillFrom ? c.fillFrom(row) : null;
        if (v && typeof v === "object" && !Array.isArray(v)) { fill = v.fill || fill; v = v.v; }
        return cell(col(i) + r, v, c.type || "text", fill || (c.rowFill ? fillRow : null));
      }).join("")}</row>`);
      r++;
    }
  }
  const last = r - 1;
  const widths = cols.length ? `<cols>${cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 14}" customWidth="1"/>`).join("")}</cols>`
    : `<cols><col min="1" max="1" width="${sh.width || 110}" customWidth="1"/></cols>`;
  const freeze = cols.length && sh.freeze !== false
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headRow}" xSplit="${sh.freezeCols || 0}" topLeftCell="${col(sh.freezeCols || 0)}${headRow + 1}" activePane="${sh.freezeCols ? "bottomRight" : "bottomLeft"}" state="frozen"/></sheetView></sheetViews>`
    : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
  const filter = cols.length && last > headRow ? `<autoFilter ref="A${headRow}:${col(cols.length - 1)}${last}"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${freeze}<sheetFormatPr defaultRowHeight="15"/>${widths}<sheetData>${rowsXml.join("")}</sheetData>${filter}</worksheet>`;
}

function build(sheets) {
  const safe = sheets.map((s, i) => ({ ...s, name: String(s.name || "Sheet" + (i + 1)).replace(/[\\/?*[\]:]/g, " ").slice(0, 31) }));
  const files = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${safe.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${safe.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>${
      (() => { const d = safe.map((s, i) => s.columns && s.columns.length && (s.rows || []).length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(s.name).replace(/'/g, "''")}'!$A$${(s.preface || []).length + 1}:$${col(s.columns.length - 1)}$${(s.preface || []).length + 1 + s.rows.length}</definedName>` : "").join(""); return d ? `<definedNames>${d}</definedNames>` : ""; })()}</workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${safe.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${safe.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: stylesXml() },
    ...safe.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ];
  return zip(files);
}

module.exports = { build, FILLS };
