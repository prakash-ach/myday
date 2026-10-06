/* Automatic rules for incoming mail.
 *
 * The AI describes each email (what kind it is, how sure it is, deadlines,
 * amounts). This file decides, in plain code you can read, what MYDAY does
 * about it without asking:
 *
 *   1. Auction bid file          → task in My Day today
 *   2. Outside supplier invoice  → stays in Review, plus a "Review invoice" task
 *   3. A named review sender     → stays in Review, plus a review task
 *      (e.g. Saad Javed, matched only by his configured address)
 *   4. Actionable outside order  → review task
 *   5. Promotion                 → marked Ignored, no task
 *
 * Mail from your own company never triggers 1, 2, 4 or 5. Anything the AI
 * isn't sure about is left in Review. Nothing here sends mail, bids, pays,
 * or touches Gmail: the only things it can do are add a task in MYDAY and
 * mark a message Ignored inside MYDAY, and every one says why.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULTS = {
  enabled: { bids: true, invoices: true, reviewSenders: true, orders: true, promotions: true },
  timezone: "",                       // set from your browser the first time, editable
  reviewSenders: [{ name: "Saad Javed", emails: [] }],
  companyDomains: [],                 // added to the Automation settings' own domains
  promoHints: ["sickw.com"],          // senders known for promotions — a hint, judged by content
  sure: { bids: 0.7, invoices: 0.7, orders: 0.75, promotions: 0.85 },
  capturedSince: "",                  // Captured Invoices starts here (YYYY-MM-DD)
};

const file = (dir, userId) => path.join(dir, "rules-" + userId + ".json");
function read(dir, userId) {
  let r = {};
  try { r = JSON.parse(fs.readFileSync(file(dir, userId), "utf8")); } catch (e) {}
  return {
    ...DEFAULTS, ...r,
    enabled: { ...DEFAULTS.enabled, ...(r.enabled || {}) },
    sure: { ...DEFAULTS.sure, ...(r.sure || {}) },
    reviewSenders: Array.isArray(r.reviewSenders) ? r.reviewSenders : DEFAULTS.reviewSenders,
    companyDomains: Array.isArray(r.companyDomains) ? r.companyDomains : [],
    promoHints: Array.isArray(r.promoHints) ? r.promoHints : DEFAULTS.promoHints,
  };
}
function write(dir, userId, rules) {
  const clean = (a) => [...new Set((Array.isArray(a) ? a : []).map((x) => String(x || "").trim().toLowerCase()).filter(Boolean))].slice(0, 40);
  const r = {
    enabled: Object.fromEntries(Object.keys(DEFAULTS.enabled).map((k) => [k, !!(rules.enabled || {})[k]])),
    timezone: validTz(rules.timezone) ? rules.timezone : "",
    reviewSenders: (Array.isArray(rules.reviewSenders) ? rules.reviewSenders : []).slice(0, 20)
      .map((s) => ({ name: String(s.name || "").trim().slice(0, 60), emails: clean(s.emails).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) }))
      .filter((s) => s.name || s.emails.length),
    companyDomains: clean(rules.companyDomains).map((d) => d.replace(/^@/, "")),
    promoHints: clean(rules.promoHints),
    sure: { ...DEFAULTS.sure },
    capturedSince: /^\d{4}-\d{2}-\d{2}$/.test(String(rules.capturedSince || "")) ? rules.capturedSince : "",
  };
  fs.mkdirSync(dir, { recursive: true });
  const tmp = file(dir, userId) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(r, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, file(dir, userId));
  return read(dir, userId);
}

/* ---------- time ---------- */
function validTz(tz) {
  if (!tz) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch (e) { return false; }
}
const zone = (rules) => (validTz(rules.timezone) ? rules.timezone : process.env.TZ_DEFAULT || "America/New_York");
function localToday(rules) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone(rules), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/* ---------- who sent it ---------- */
const addressOf = (from) => {
  const m = String(from || "").match(/<([^>]+)>/);
  return (m ? m[1] : String(from || "")).trim().toLowerCase();
};
const nameOf = (from) => ((String(from || "").match(/^\s*"?([^"<]+?)"?\s*</) || [])[1] || addressOf(from)).trim();
const domainOf = (addr) => (addr.split("@")[1] || "").toLowerCase();
function isOwn(addr, ownDomains) {
  const d = domainOf(addr);
  return !!d && ownDomains.some((o) => { o = String(o || "").toLowerCase().replace(/^@/, ""); return o && (d === o || d.endsWith("." + o)); });
}

/* ---------- the decision ---------- */
/* item: what the watcher read. ai: the AI's description (may be null).
   Returns null to leave the email exactly as before, or
   { rule, action: "task" | "ignore" | "review", reason, key, task? } */
function decide(item, ai, rules, opts) {
  const on = rules.enabled;
  const addr = addressOf(item.from);
  const own = isOwn(addr, opts.ownDomains || []) || item.classified === "internal";
  const sender = nameOf(item.from);
  const c = (ai && ai.classify) || null;
  const kind = c && c.type;
  const conf = c ? Number(c.confidence) || 0 : 0;
  const docs = item.documents || [];
  const invoiceDoc = docs.find((d) => d.rows && d.rows.length && !d.auctionBidFile && !d.ownSeller);
  const sheet = docs.find((d) => ["xlsx", "xls", "csv", "pdf"].includes(d.kind));
  const subj = String(item.subject || "");

  // 3. A named sender, matched only by a configured address.
  if (on.reviewSenders) {
    const who = (rules.reviewSenders || []).find((s) => (s.emails || []).includes(addr));
    if (who) {
      return { rule: "reviewSender", action: "task", key: "mail:" + item.id,
        reason: `from ${who.name || addr} (${addr}), who's on your review list`, who: who.name || sender };
    }
  }

  // Your own company's mail: none of the other rules apply.
  if (own) return null;

  // 1. Auction bid file: an attachment that's a list of lots to bid on.
  const bidWords = /\bbid(s|ding| sheet| file| list)?\b/i.test(subj + " " + (c && c.summary || "")) && /auction|lot|manifest|catalog/i.test(subj + " " + item.snippet);
  if (on.bids && sheet && ((kind === "auction_bid_file" && conf >= rules.sure.bids) || (!c && bidWords && ["xlsx", "csv"].includes(sheet.kind)))) {
    return { rule: "bids", action: "task", key: "doc:" + sheet.sha, doc: sheet,
      reason: c ? `the AI read it as an auction bid file (${Math.round(conf * 100)}% sure)` : "an auction bid sheet by its subject and attachment" };
  }

  // 2. Outside supplier invoice.
  const aiInvoice = kind === "supplier_invoice" && conf >= rules.sure.invoices;
  const sq = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const ownNames = (opts.ownNames || ["mobilesentrix", "apt-ability"]).map(sq).filter((n) => n.length >= 4);
  const ownInvoice = docs.some((d) => d.ownSeller) || (c && ownNames.some((n) => sq(c.counterparty).includes(n)));
  if (on.invoices && (invoiceDoc || aiInvoice) && kind !== "promotion" && !(ownInvoice && !invoiceDoc)) {
    const doc = invoiceDoc || docs.find((d) => d.kind === "pdf") || null;
    return { rule: "invoices", action: "task", key: doc ? "doc:" + doc.sha : "mail:" + item.id, doc,
      reason: invoiceDoc ? `${invoiceDoc.filename} was read as an invoice${invoiceDoc.byAI ? " by the AI" : ""}` : `the AI read it as a supplier invoice (${Math.round(conf * 100)}% sure)` };
  }

  // 4. Actionable order from an outside customer or supplier.
  if (on.orders && kind === "order" && c.actionable && conf >= rules.sure.orders) {
    return { rule: "orders", action: "task", key: "mail:" + item.id,
      reason: `the AI read it as an order that needs action (${Math.round(conf * 100)}% sure)` };
  }

  // 5. Promotions: content decides, never the sender alone.
  if (on.promotions && kind === "promotion") {
    const hinted = (rules.promoHints || []).some((h) => addr.endsWith(h) || addr.includes("@" + h));
    const gmailSaysPromo = (item.labelIds || []).includes("CATEGORY_PROMOTIONS");
    // Never auto-ignore a message carrying a document — an invoice or file
    // dressed up as marketing stays in Review for you to see.
    const hasDocument = docs.some((d) => ["pdf", "xlsx", "xls", "csv"].includes(d.kind));
    if (conf >= rules.sure.promotions && !invoiceDoc && !hasDocument) {
      return { rule: "promotions", action: "ignore", key: "mail:" + item.id,
        reason: `promotional content (${Math.round(conf * 100)}% sure${gmailSaysPromo ? ", Gmail files it under Promotions" : ""}${hinted ? ", sender is on the promotions hint list" : ""})` };
    }
    return { rule: "promotions", action: "review", key: "mail:" + item.id,
      reason: conf >= rules.sure.promotions
        ? `reads as promotional (${Math.round(conf * 100)}% sure) but carries a document, so it's left for you to check`
        : `might be promotional (${Math.round(conf * 100)}% sure) — left for you to decide` };
  }
  return null;
}

/* ---------- the task ---------- */
const BASE = () => (process.env.PUBLIC_URL || "https://myday.acharyaandcollc.com").replace(/\/+$/, "");
const money = (n) => (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
const idFor = (rule, key) => "auto-" + crypto.createHash("sha1").update(rule + "|" + key).digest("hex").slice(0, 16);
function pickCategory(cats, re) {
  const list = (cats && cats.company) || [];
  return list.find((c) => re.test(c)) || list[0] || "";
}
function fmtDeadline(s) {
  if (!s) return "";
  const m = String(s).match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return String(s);
  const d = new Date(m[1] + "T12:00:00");
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  if (!m[2]) return day;
  const hh = Number(m[2]);
  return `${day}, ${hh % 12 || 12}:${m[3]} ${hh >= 12 ? "PM" : "AM"}`;
}

function buildTask(item, ai, d, rules, opts) {
  const today = localToday(rules);
  const c = (ai && ai.classify) || {};
  const sender = nameOf(item.from);
  const addr = addressOf(item.from);
  const doc = d.doc || null;
  const docs = item.documents || [];
  const link = `https://mail.google.com/mail/u/0/#all/${item.threadId || item.id}`;
  const attLink = doc && doc.att != null ? `${BASE()}/api/automation/attachment/${encodeURIComponent(item.id)}/${doc.att}` : "";
  const cats = opts.categories || {};

  let title, category, deadline = "", details = [];
  if (d.rule === "bids") {
    const auction = c.auction_name || (doc && doc.auction) || item.subject.replace(/^\s*(re|fw|fwd)\s*:\s*/i, "").slice(0, 60);
    deadline = c.bid_deadline || "";
    title = `Review bid file: ${auction} — from ${sender}`;
    category = pickCategory(cats, /auction|purchas|sourc|buy/i);
    details = [`Auction: ${auction}`, deadline ? `Bid deadline: ${fmtDeadline(deadline)}` : "Bid deadline: not stated in the email",
      doc ? `Bid file: ${doc.filename}` : null];
  } else if (d.rule === "invoices") {
    const supplier = (doc && doc.supplier) || c.counterparty || sender;
    const ref = (doc && doc.reference) || c.invoice_number || "";
    const amount = (doc && doc.total) || c.amount || null;
    deadline = c.due_date || "";
    title = `Review invoice from ${supplier}${ref ? ` — ${ref}` : ""}`;
    category = pickCategory(cats, /account|reconcil|financ|payabl|bill/i);
    details = [`Supplier: ${supplier}`, ref ? `Invoice no.: ${ref}` : "Invoice no.: not found",
      amount ? `Amount: ${money(amount)}` : "Amount: not found", deadline ? `Due: ${fmtDeadline(deadline)}` : "Due date: not stated",
      doc && doc.rows ? `${doc.rows.length} line items read — open Automation → Review invoice to log them to Auctions` : null,
      "This is a review task only: the invoice is not marked reviewed or paid."];
  } else if (d.rule === "orders") {
    const who = c.counterparty || sender;
    deadline = c.due_date || "";
    title = `Review order from ${who}${c.order_ref ? ` — ${c.order_ref}` : ""}`;
    category = pickCategory(cats, /sales|order|customer/i);
    details = [`From: ${who}`, c.order_ref ? `Order ref: ${c.order_ref}` : null, c.amount ? `Amount: ${money(c.amount)}` : null,
      deadline ? `Needed by: ${fmtDeadline(deadline)}` : null];
  } else {
    title = `Review email from ${d.who}: ${item.subject.replace(/^\s*(re|fw|fwd)\s*:\s*/i, "").slice(0, 60)}`;
    const files = docs.filter((x) => x.filename).map((x) => x.filename);
    category = pickCategory(cats, /team|manag/i);
    deadline = c.due_date || c.bid_deadline || "";
    details = [deadline ? `Deadline mentioned: ${fmtDeadline(deadline)}` : null,
      files.length ? `Attachments: ${files.join(", ")}` : null];
  }

  const soon = deadline && deadline.slice(0, 10) <= today;
  const note = [
    "Summary: " + ((ai && ai.summary) || c.summary || String(item.snippet || "").slice(0, 240) || item.subject),
    "",
    `Sender: ${sender} <${addr}>`,
    ...details.filter(Boolean),
    doc ? `Attachment: ${doc.filename}${attLink ? ` — ${attLink}` : ""}` : null,
    `Email: ${link}`,
    "",
    `Why: added automatically — ${d.reason}.`,
    "MYDAY didn't send, bid, pay or change anything in Gmail.",
  ].filter((x) => x !== null).join("\n");

  return {
    id: idFor(d.rule, d.key), title: title.slice(0, 120), space: "company", category,
    date: today, time: "", repeat: "none", repeatDays: null, repeatEvery: 1, repeatUntil: null,
    priority: soon ? "urgent" : "high", note, subtasks: [], projectId: null, done: {},
    createdAt: Date.now(), fromEmail: true,
    deadline: deadline ? deadline.slice(0, 10) : null, deadlineTime: /T\d{2}:\d{2}/.test(deadline) ? deadline.slice(11, 16) : null,
    source: { kind: "auto", rule: d.rule, reason: d.reason, mailId: item.id, from: item.from, subject: item.subject,
      at: Date.now(), amount: (doc && doc.total) || c.amount || null, reference: (doc && doc.reference) || c.invoice_number || c.order_ref || "" },
  };
}

/* The Friday before today (a week back if today is Friday), in your timezone. */
function lastFriday(rules) {
  const d = new Date(localToday(rules) + "T12:00:00Z");
  const back = ((d.getUTCDay() - 5 + 7) % 7) || 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

module.exports = { lastFriday, read, write, decide, buildTask, localToday, zone, validTz, idFor, addressOf, isOwn, DEFAULTS };
