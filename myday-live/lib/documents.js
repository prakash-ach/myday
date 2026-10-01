/* Turn an attachment into something readable, then into auction rows.
 *
 * PDFs go through pdftotext, which is part of poppler-utils and already
 * on the droplet. Spreadsheets are read directly. Everything else is
 * left alone rather than guessed at.
 */

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const { parseOnmInvoice } = require("./extract-onm");
const { parseRexiInvoice } = require("./extract-rexi");

const hash = (buf) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 32);

const kindOf = (filename, mimeType) => {
  const f = String(filename || "").toLowerCase();
  const m = String(mimeType || "").toLowerCase();
  if (f.endsWith(".pdf") || m.includes("pdf")) return "pdf";
  if (f.endsWith(".xlsx") || f.endsWith(".xlsm") || m.includes("spreadsheetml")) return "xlsx";
  if (f.endsWith(".xls")) return "xls";
  if (f.endsWith(".csv") || m.includes("csv")) return "csv";
  if (f.endsWith(".txt") || m.startsWith("text/")) return "text";
  return "other";
};

function pdfText(buf) {
  const tmp = path.join(os.tmpdir(), "myday-" + crypto.randomBytes(6).toString("hex") + ".pdf");
  try {
    fs.writeFileSync(tmp, buf, { mode: 0o600 });
    return execFileSync("pdftotext", ["-layout", "-q", tmp, "-"],
      { encoding: "utf8", maxBuffer: 20 * 1024 * 1024, timeout: 30000 });
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
}

const havePdftotext = () => {
  try { execFileSync("pdftotext", ["-v"], { stdio: "ignore", timeout: 5000 }); return true; }
  catch (e) { return false; }
};

/* Read one attachment as far as it can, and say honestly where it stopped. */
function readDocument(filename, mimeType, buf) {
  const kind = kindOf(filename, mimeType);
  const out = { filename, kind, bytes: buf.length, sha: hash(buf), text: "", rows: null, supplier: "", issues: [] };

  try {
    if (kind === "pdf") {
      if (!havePdftotext()) {
        out.issues.push("pdftotext isn't installed on the server, so PDFs can't be read");
        return out;
      }
      out.text = pdfText(buf);
      if (!out.text.trim()) out.issues.push("that PDF has no text in it — it may be a scan");
      else if (/Invoice no\.?:/i.test(out.text) && /Cell Phone/i.test(out.text)) {
        const r = parseOnmInvoice(out.text);
        if (r.rows.length) {
          out.rows = r.rows; out.supplier = r.supplier; out.reference = r.reference;
          out.date = r.date; out.total = r.invoiceTotal;
          out.issues.push(...(r.warnings || []));
        }
      }
    } else if (kind === "xlsx") {
      const r = parseRexiInvoice(buf);
      if (r.rows.length) {
        out.rows = r.rows; out.supplier = r.supplier; out.auction = r.auction;
        out.date = r.date; out.premium = r.premium;
        out.issues.push(...(r.warnings || []));
      } else {
        out.issues.push("read the spreadsheet but found no line items in the expected shape");
      }
      out.text = (r.rows || []).map((x) => x.raw).join("\n");
    } else if (kind === "csv" || kind === "text") {
      out.text = buf.toString("utf8").slice(0, 200000);
    } else if (kind === "xls") {
      out.issues.push("that's the older .xls format, which this can't read — ask them for .xlsx");
    } else {
      out.issues.push("not a document this knows how to read");
    }
  } catch (e) {
    out.issues.push("couldn't read it: " + String(e && e.message || e));
  }
  return out;
}

module.exports = { readDocument, kindOf, hash, havePdftotext };
