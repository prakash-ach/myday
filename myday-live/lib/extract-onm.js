/* Extract auction rows from an O&M Electronics invoice (T-Mobile Via ONM).
 *
 * Each line looks like:
 *   1.  Cell Phone  T-MOBILE IPHONE 13 PRO 256GB-B  120  $347.69  $41,722.80
 * and sometimes wraps, with the size and grade on the next line.
 */

const OEMS = [
  [/\bIPHONE|IPAD\b/i, "Apple"],
  [/\bSAMSUNG|GALAXY\b/i, "Samsung"],
  [/\bMOTOROLA|MOTO\b/i, "Motorola"],
  [/\bGOOGLE|PIXEL\b/i, "Google"],
  [/\bTCL\b/i, "TCL"],
  [/\bONEPLUS\b/i, "OnePlus"],
  [/\bLG\b/i, "LG"],
];

const num = (v) => {
  const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.]/g, ""));
  return Number.isNaN(n) ? 0 : n;
};

function parseOnmInvoice(text) {
  const out = { supplier: "T-Mobile Via ONM", rows: [], warnings: [] };

  const inv = text.match(/Invoice no\.?:\s*(\S+)/i);
  out.reference = inv ? inv[1] : "";
  const d = text.match(/Invoice date:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  out.date = d ? `${d[3]}-${String(+d[1]).padStart(2, "0")}-${String(+d[2]).padStart(2, "0")}` : "";
  const tot = text.match(/Total\s+\$([\d,]+\.\d{2})/i);
  out.invoiceTotal = tot ? num(tot[1]) : null;

  // A page break can leave the item number alone on one line and the rest
  // at the top of the next page, with a form feed in front of it.
  const lines = text.split("\n").map((l) => l.replace(/\f/g, " "));
  for (let i = 0; i < lines.length; i++) {
    // "N.  Cell Phone  <description>  <qty>  $rate  $amount", with the
    // number optional because of that page break.
    const m = lines[i].match(/^\s*(?:(\d+)\.\s+)?Cell Phone\s+(.+?)\s{2,}(\d[\d,]*)\s+\$([\d,.]+)\s+\$([\d,.]+)\s*$/);
    if (!m) continue;
    let desc = m[2].trim();

    // The description sometimes wraps onto the next non-empty line.
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const nxt = lines[j];
      if (!nxt.trim()) continue;
      if (/^\s*\d+\.\s+Cell Phone/.test(nxt) || /Subtotal|Ways to pay/i.test(nxt)) break;
      if (/^\s{10,}\S/.test(nxt) && !/\$/.test(nxt)) { desc += " " + nxt.trim(); i = j; }
      else break;
    }

    out.rows.push(fromDescription(desc, num(m[3]), num(m[4]), num(m[5]), out));
  }

  const summed = out.rows.reduce((n, r) => n + r.price * r.qty, 0);
  if (out.invoiceTotal && Math.abs(summed - out.invoiceTotal) > 1) {
    out.warnings.push(`lines add to ${summed.toFixed(2)} but the invoice says ${out.invoiceTotal.toFixed(2)}`);
  }
  return out;
}

function fromDescription(desc, qty, price, amount, ctx) {
  const row = { raw: desc, qty, price, amount, confidence: 1, issues: [] };

  // Carrier prefix, if any.
  let rest = desc.replace(/^(T-MOBILE|VERIZON|AT&T|SPRINT|UNLOCKED)\s+/i, (x) => {
    row.carrier = x.trim();
    return "";
  }).trim();

  // Grade is the bit after the final dash: "...256GB-B"
  const g = rest.match(/-([A-Z0-9]{1,8})\s*$/i);
  if (g) { row.grade = g[1].toUpperCase(); rest = rest.slice(0, g.index).trim(); }
  else { row.grade = ""; row.issues.push("no grade on the line"); row.confidence -= 0.3; }

  // Size: 128GB, 1TB, 64 GB. Take the first, drop every occurrence, so a
  // wrapped line can't leave a stray "128GB" stuck to the model name.
  const s = rest.match(/(\d+)\s*(GB|TB)\b/i);
  if (s) {
    row.size = s[1] + s[2].toUpperCase();
    rest = rest.replace(/\d+\s*(GB|TB)\b/gi, " ").replace(/\s+/g, " ").trim();
  } else { row.size = "—"; row.issues.push("no storage size"); row.confidence -= 0.2; }

  const oem = OEMS.find(([re]) => re.test(desc));
  row.oem = oem ? oem[1] : "";
  if (!oem) { row.issues.push("make not recognised"); row.confidence -= 0.3; }

  // What's left is the model, with the maker's name dropped off the front.
  row.model = rest.replace(/^(SAMSUNG|MOTOROLA|GOOGLE|APPLE|TCL|LG|ONEPLUS)\s+/i, "")
    .replace(/\s+/g, " ").trim();
  if (!row.model) { row.issues.push("no model"); row.confidence -= 0.4; }

  // Sanity: does qty x rate match the amount on the line?
  if (amount && Math.abs(qty * price - amount) > 0.05) {
    row.issues.push("quantity times rate doesn't match the line total");
    row.confidence -= 0.2;
  }
  row.confidence = Math.max(0, Math.round(row.confidence * 100) / 100);
  return row;
}

module.exports = { parseOnmInvoice };
