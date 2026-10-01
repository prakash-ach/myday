/* Auction rows from a REXI Resale invoice (.xlsx).
 *
 * The grade isn't written anywhere. It's the letter before the "U" in
 * the line code, which is Rexi's own scheme, so it's carried through as
 * their code and mapped to your grades in the supplier rules.
 */

const { readSheet } = require("./xlsx");

const OEMS = ["Apple", "Samsung", "Google", "Motorola", "TCL", "OnePlus", "LG", "Nokia"];
const MONTHS = ["january","february","march","april","may","june",
                "july","august","september","october","november","december"];

const num = (v) => {
  if (typeof v === "number") return v;
  const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.]/g, ""));
  return Number.isNaN(n) ? 0 : n;
};
const text = (v) => String(v == null ? "" : v).trim();

const gradeFromCode = (code) => {
  const m = text(code).match(/^[A-Z0-9]+?([A-Z])U\d+G?X$/);
  return m ? m[1] : "";
};

function parseRexiInvoice(buffer) {
  const { rows } = readSheet(buffer);
  const out = { supplier: "Rexi", auction: "", date: "", premium: 0, rows: [], warnings: [] };

  const head = text(rows[0] && rows[0][0]);
  if (!/REXI/i.test(head)) out.warnings.push("this doesn't look like a Rexi invoice");

  const sub = text(rows[1] && rows[1][0]);
  if (sub.includes("—")) {
    out.auction = sub.split("—")[0].trim();
    const d = sub.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
    if (d) {
      const mi = MONTHS.indexOf(d[2].toLowerCase());
      if (mi >= 0) out.date = `${d[3]}-${String(mi + 1).padStart(2, "0")}-${String(+d[1]).padStart(2, "0")}`;
    }
  }

  const hi = rows.findIndex((r) => text(r && r[0]).toLowerCase() === "lot");
  if (hi < 0) { out.warnings.push("couldn't find the column headings"); return out; }
  const head2 = rows[hi].map((x) => text(x).toLowerCase());
  const col = (...names) => {
    for (const n of names) {
      const i = head2.findIndex((h) => h.startsWith(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  const cCode = col("line code"), cDesc = col("description");
  const cUnits = col("units"), cPrice = col("unit price");
  const cGoods = col("goods"), cFee = col("platform fee");

  if (cFee >= 0) {
    const m = text(rows[hi][cFee]).match(/([\d.]+)\s*%/);
    if (m) out.premium = parseFloat(m[1]);
  }

  let goods = 0;
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const desc = text(row[cDesc]);
    const units = row[cUnits];
    if (!desc || units === undefined || units === null || units === "") continue;

    const item = { raw: desc, issues: [], confidence: 1 };
    const parts = desc.split("|").map((x) => x.trim());
    const name = parts[0] || "";

    const oem = OEMS.find((o) => name.toLowerCase().startsWith(o.toLowerCase()))
             || OEMS.find((o) => name.toLowerCase().includes(o.toLowerCase())) || "";
    item.oem = oem;
    if (!oem) { item.issues.push("make not recognised"); item.confidence -= 0.3; }
    item.model = oem ? name.replace(new RegExp("^" + oem + "\\s*", "i"), "").trim() : name;

    let size = "";
    for (const p of parts.slice(1)) {
      const m = p.match(/^(\d+)\s*(GB|TB)$/i);
      if (m) { size = m[1] + m[2].toUpperCase(); break; }
    }
    if (!size) {
      const m = desc.match(/(\d+)\s*(GB|TB)/i);
      if (m) size = m[1] + m[2].toUpperCase();
    }
    item.size = size || "—";
    if (!size) { item.issues.push("no storage size"); item.confidence -= 0.2; }

    item.lineCode = text(row[cCode]);
    item.supplierGrade = gradeFromCode(item.lineCode);
    if (!item.supplierGrade) { item.issues.push("no grade in the line code"); item.confidence -= 0.3; }

    item.condition = parts[2] || "";
    item.qty = Math.max(1, Math.round(num(units)));
    item.price = num(row[cPrice]);
    const lineGoods = cGoods >= 0 ? num(row[cGoods]) : 0;
    if (lineGoods && Math.abs(item.qty * item.price - lineGoods) > 0.05) {
      item.issues.push("units times price doesn't match the goods column");
      item.confidence -= 0.2;
    }
    goods += lineGoods;
    item.confidence = Math.max(0, Math.round(item.confidence * 100) / 100);
    out.rows.push(item);
  }

  let stated = null;
  for (let r = rows.length - 1; r > rows.length - 10 && r >= 0; r--) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (text(row[c]).toLowerCase() === "goods") stated = num(row[c + 1]);
    }
  }
  out.goodsTotal = goods;
  out.statedGoods = stated;
  if (stated && Math.abs(stated - goods) > 1) {
    out.warnings.push(`lines add to ${goods.toFixed(2)} but the sheet says ${stated.toFixed(2)}`);
  }
  return out;
}

module.exports = { parseRexiInvoice };
