/* Turn an email into proposed MYDAY tasks.
 *
 * Nothing here saves anything. It produces a proposal with a confidence
 * and the reason it decided, which lands in the Automation Inbox for you
 * to Approve, Edit & Approve, or Ignore.
 */

const money = (s) => {
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ""));
  return Number.isNaN(n) ? null : n;
};
const iso = (m, d, y) => `${y}-${String(+m).padStart(2, "0")}-${String(+d).padStart(2, "0")}`;

function findDue(text) {
  let m = text.match(/Due date:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (m) return { date: iso(m[1], m[2], m[3]), why: "the invoice's own due date" };
  m = text.match(/\bdue\s+(?:on|by)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (m) return { date: iso(m[1], m[2], m[3]), why: "a due date in the text" };
  m = text.match(/\bnet\s*(\d{1,3})\b/i);
  if (m) return { days: +m[1], why: `payment terms of net ${m[1]}` };
  if (/due on receipt/i.test(text)) return { days: 0, why: "terms of due on receipt" };
  return null;
}

/* Amounts hide in the subject as often as the body:
 *   "Re: Payment Request : Fiesta wireless (Invoice # 22 ) - $43,610.00"
 * A labelled total wins. Otherwise take the largest figure, because an
 * invoice's total is nearly always bigger than the odds and ends around
 * it — picking the first number found gave $217 for a $43,610 invoice.
 */
function findAmount(text) {
  const labelled = text.match(/\b(?:Total due|Amount due|Balance due|Total|Amount|Balance)\b[^\d$]{0,12}\$?\s*([\d,]+\.\d{2})/i);
  if (labelled) {
    const n = money(labelled[1]);
    if (n && n >= 1) return n;
  }
  const all = [];
  const re = /\$\s*([\d,]+(?:\.\d{2})?)/g;
  let m;
  while ((m = re.exec(text))) {
    const n = money(m[1]);
    if (n && n >= 1) all.push(n);
  }
  if (!all.length) return null;
  return Math.max(...all);
}

function findRef(text) {
  const m = text.match(/Invoice\s*(?:no\.?|number|#)\s*:?\s*([A-Z0-9-]{2,20})/i)
         || text.match(/\bPO\s*#?\s*([A-Z0-9-]{3,20})/i);
  return m ? m[1] : "";
}

/* Words too common to identify anybody by. "T-Mobile Via ONM" must not
   match an email from mobilesentrix.com just because both say "mobile". */
const WEAK = new Set(["mobile", "via", "inc", "llc", "ltd", "corp", "the", "and",
  "wireless", "electronics", "electronic", "resale", "trading", "group", "company",
  "solutions", "services", "direct", "supply", "wholesale", "phone", "phones", "tech",
  "dept", "department", "team", "order", "orders", "invoice", "payment", "request"]);

/* Free mailboxes are not companies. "Pay Gmail" is nonsense; the person's
   own name is the only sensible answer. */
const FREEMAIL = new Set(["gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk",
  "hotmail.com", "outlook.com", "live.com", "aol.com", "icloud.com", "me.com",
  "protonmail.com", "proton.me", "msn.com", "ymail.com"]);

const displayNameOf = (from) => {
  const m = String(from || "").match(/^\s*"?([^"<]+?)"?\s*</);
  if (m && m[1].trim()) return m[1].trim();
  const addr = (String(from || "").match(/[\w.+-]+@/) || [""])[0].replace("@", "");
  return addr.replace(/[._]/g, " ").trim() || "Unknown";
};

/* Who the money is owed to.
 *
 * In order: an address you've recorded, a supplier named in the text, a
 * company name in the document, then the sender's own name. Never your
 * own company, and never a webmail provider. */
function findParty(email, known, aliases, ownNames) {
  const from = (email.from || "").toLowerCase();
  const domain = (from.match(/@([\w.-]+)/) || [])[1] || "";
  const hay = (email.subject + " " + email.body + " " + (email.attachmentText || "")).toLowerCase();
  const mine = (ownNames || []).map((x) => x.toLowerCase());
  const isMine = (name) => mine.some((o) => name.toLowerCase().includes(o));

  for (const [name, addrs] of Object.entries(aliases || {})) {
    if ((addrs || []).some((a) => from.includes(a.toLowerCase())
        || domain === a.toLowerCase().replace(/^@/, "")))
      return { name, known: true, how: "the sender address is on file for them" };
  }

  for (const s2 of known || []) {
    if (isMine(s2)) continue;
    const lower = s2.toLowerCase();
    if (hay.includes(lower) || from.includes(lower.replace(/\s+/g, "")))
      return { name: s2, known: true, how: "their name appears in the message" };
  }
  for (const s2 of known || []) {
    if (isMine(s2)) continue;
    const strong = (s2.match(/[A-Za-z&]{3,}/g) || [])
      .map((w) => w.toLowerCase()).filter((w) => !WEAK.has(w));
    if (strong.length && strong.some((w) => from.includes(w) || hay.includes(w)))
      return { name: s2, known: true, how: "a distinctive part of their name appears" };
  }

  /* Your mail names the payee in the subject far more often than not:
       "Payment Request : Fiesta wireless (Invoice # 22 )"
       "RJOR SERVICES LLC - Invoice # 1 Payment $7,605.00"
       "Re: Your Mannapov Order # 70514"
     Reading it there is much safer than guessing from the sender, who is
     usually one of your own people forwarding it. */
  const subject = String(email.subject || "").replace(/^\s*(re|fw|fwd)\s*:\s*/i, "");
  const shapes = [
    /payment\s*request\s*[:\-]\s*([^(\[\n]{2,48}?)\s*(?:\(|\[|-\s*\$|invoice|$)/i,
    /^([A-Za-z][\w&.' -]{2,46}?)\s*[-–]\s*invoice\b/i,
    /\byour\s+([A-Za-z][\w&.' -]{2,40}?)\s+order\b/i,
    /\binvoice\s+(?:from|for)\s+([A-Za-z][\w&.' -]{2,46}?)\s*(?:[-–(]|$)/i,
  ];
  for (const re of shapes) {
    const m = subject.match(re);
    if (m) {
      const name = m[1].replace(/\s+/g, " ").trim().replace(/[,.]$/, "");
      if (name.length > 2 && !isMine(name) && !/^(invoice|payment|order|request)$/i.test(name)) {
        return { name, known: false, how: "the name in the subject line" };
      }
    }
  }

  /* A company name in the subject, like "RJOR SERVICES LLC - Invoice # 1". */
  const subj = String(email.subject || "")
    .match(/\b([A-Z][A-Za-z&.']{1,}(?:\s+[A-Z][A-Za-z&.']{1,}){0,3}\s+(?:LLC|INC|LTD|CORP|CO)\.?)/);
  if (subj && !isMine(subj[1])) return { name: subj[1].trim(), known: false, how: "the company named in the subject" };

  const all = (email.body || "") + "\n" + (email.attachmentText || "");
  const org = all.match(/^\s*([A-Z][A-Za-z&.' ]{2,40}(?:Inc|LLC|Ltd|Corp|Co)\.?)\s*$/m);
  if (org && !isMine(org[1])) return { name: org[1].trim().replace(/\s+/g, " "), known: false, how: "a company name in the document" };

  if (FREEMAIL.has(domain) || isMine(domain)) {
    return { name: displayNameOf(email.from), known: false, how: "the sender's own name", person: true };
  }
  const base = domain.split(".")[0];
  if (base && !isMine(base)) {
    return { name: base.charAt(0).toUpperCase() + base.slice(1), known: false, how: "the sender's domain" };
  }
  return { name: displayNameOf(email.from), known: false, how: "the sender's own name", person: true };
}

const RULES = [
  { kind: "payment", category: "Accounting & Reconciliation",
    any: [/\binvoice\b/i, /\bremittance\b/i, /\bamount due\b/i, /\bstatement\b/i,
          /\bpast due\b/i, /\bpayment\s+(?:due|reminder|request)\b/i, /\bwire\s+payment\b/i] },
  { kind: "rma", category: "RMA & Returns",
    any: [/\brma\b/i, /\breturn(ed|ing)?\b/i, /\bwarranty\b/i, /\bdefective\b/i, /\bsend back\b/i] },
  { kind: "shipment", category: "Delivery and Live",
    any: [/\btracking\b/i, /\bshipped\b/i, /\bdelivered\b/i, /\beta\b/i, /\bpallet\b/i,
          /\bbill of lading\b/i, /\bfreight\b/i] },
  { kind: "auction", category: "Purchasing & Sourcing",
    any: [/\bauction\b/i, /\bbid\b/i, /\blot\s*#?\d/i, /\bwon\b/i, /\boutbid\b/i, /\bmanifest\b/i] },
  { kind: "customer", category: "Sales & Customer Support",
    any: [/\bquote\b/i, /\bavailability\b/i, /\bin stock\b/i, /\bcan you\b/i, /\bdo you have\b/i,
          /\bplease (?:send|confirm|advise)\b/i, /\binterested in\b/i, /\border status\b/i] },
];

function classify(email) {
  const text = `${email.subject}\n${email.body}`;
  const scored = RULES.map((r) => ({
    kind: r.kind, category: r.category,
    hits: r.any.filter((re) => re.test(text)).length,
  })).filter((x) => x.hits).sort((a, b) => b.hits - a.hits);
  if (!scored.length) return { kind: "other", category: "", confidence: 0.3 };
  const clear = scored.length === 1 || scored[0].hits > scored[1].hits;
  return { ...scored[0], confidence: clear ? Math.min(1, 0.6 + scored[0].hits * 0.15) : 0.5 };
}

/* Mail that should never become a task. Checked first, so none of the
   rest of this runs on a bid notification or a newsletter. */
function muted(email, opts) {
  const from = String(email.from || "").toLowerCase();
  const subject = String(email.subject || "").toLowerCase();
  for (const rule of (opts.mute || [])) {
    const r = String(rule).toLowerCase().trim();
    if (!r) continue;
    if (r.startsWith("subject:")) { if (subject.includes(r.slice(8).trim())) return r; }
    else if (from.includes(r)) return r;
  }
  return null;
}

function propose(email, opts = {}) {
  const hush = muted(email, opts);
  if (hush) return { classified: "muted", party: "", who: null, tasks: [], muted: hush };
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const known = opts.knownSuppliers || [];
  const text = `${email.subject}\n${email.body}\n${email.attachmentText || ""}`;
  const c = classify({ subject: email.subject, body: text });
  /* People you work with, by address. Someone in finance sending an
     invoice means something different from a stranger sending one. */
  const people = opts.people || {};
  const fromAddr = (String(email.from || "").match(/[\w.+-]+@[\w.-]+/) || [""])[0].toLowerCase();
  const person = Object.entries(people).find(([addr]) => addr.toLowerCase() === fromAddr);
  const who = person ? { address: person[0], ...person[1] } : null;

  /* Mail from your own domain is a colleague, not a supplier. If they've
     forwarded someone's invoice, the money is owed to that someone — so
     look past the sender and find the supplier in the message itself. */
  const ownNames = opts.ownNames || ["mobilesentrix", "apt-ability"];
  const internal = (opts.ownDomains || []).some((d) => (email.from || "").toLowerCase().includes(d.toLowerCase()));
  const displayName = (who && who.name)
    || (String(email.from || "").match(/^\s*"?([^"<]+?)"?\s*</) || [])[1]
    || (fromAddr.split("@")[0] || "a colleague").replace(/[._]/g, " ");

  let party;
  if (internal) {
    /* Look past the sender. If the message names a company — in the
       subject, in the document, anywhere — that's who the money is for,
       whether or not you've dealt with them before. Only when all it
       finds is a person do we treat it as a colleague's own message. */
    const inside = findParty({ ...email, from: "" }, known, opts.supplierAddresses, ownNames);
    party = (!inside.person && inside.name && !ownNames.some((o) => inside.name.toLowerCase().includes(o)))
      ? { ...inside, forwardedBy: displayName }
      : { name: displayName.trim(), known: false, how: "one of your own people", colleague: true };
  } else {
    party = findParty(email, known, opts.supplierAddresses, ownNames);
  }
  const out = [];

  const shift = (base, days) => {
    const d = new Date(base + "T12:00:00");
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  /* A colleague's message is something to do, not something to pay —
     unless they've forwarded an invoice with a supplier and a total on it. */
  const urgent = /\basap\b|\burgent\b|\btoday\b|\bby friday\b|\bnow\b/i.test(email.subject + " " + email.body);
  /* A colleague forwarding an invoice is still an invoice, as long as we
     can see who it's actually for and how much. */
  const amountHere = findAmount(text);
  const forwardedInvoice = internal && amountHere && !party.colleague
    && party.name && party.name.toLowerCase() !== displayName.toLowerCase();

  if (internal && !forwardedInvoice) {
    out.push({
      kind: "internal",
      title: `${displayName.trim()} — ${email.subject.replace(/^\s*(re|fw|fwd)\s*:\s*/i, "").slice(0, 48)}`,
      space: "company",
      category: (who && who.category) || "Team & Management",
      date: shift(email.date || today, urgent ? 0 : 1),
      priority: urgent ? "urgent" : "high",
      note: `From: ${displayName.trim()}${who && who.role ? ` (${who.role})` : ""}\n\n${email.body.slice(0, 400)}`,
      confidence: who ? 0.8 : 0.55,
      why: who
        ? `${who.name} handles ${who.role}, and this reads like it needs you`
        : "from one of your own addresses and reads like it needs an answer",
    });
  }

  /* With a colleague handled, don't also make a payment task for them. */
  if (internal && !forwardedInvoice) return { classified: "internal", party: party.name, who, tasks: out };

  if (c.kind === "payment" || forwardedInvoice) {
    const amount = findAmount(text);
    const ref = findRef(text);
    const due = findDue(text);
    const date = due ? (due.date || shift(email.date || today, due.days)) : shift(email.date || today, 7);
    const big = amount && amount >= 50000;
    out.push({
      kind: "payment",
      title: `Pay ${party.name}${ref ? ` — invoice ${ref}` : ""}${amount ? ` — $${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : ""}`,
      space: "company", category: "Accounting & Reconciliation",
      date, priority: big ? "urgent" : "high",
      note: [`From: ${email.from}`,
             party.forwardedBy ? `Forwarded by ${party.forwardedBy}` : null,
             `Subject: ${email.subject}`,
             amount ? `Amount: $${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : null,
             ref ? `Reference: ${ref}` : null,
             due && due.why ? `Due date from ${due.why}.` : "No due date found, so a week was assumed."]
            .filter(Boolean).join("\n"),
      amount, reference: ref,
      forPerson: who && /finance|account|book/i.test(who.role || "") ? (who.name || null) : null,
      confidence: Math.min(1, (amount ? 0.4 : 0.2) + (due ? 0.4 : 0.1)
        + (party.known ? 0.2 : 0.1) + (who ? 0.1 : 0)),
      why: [amount ? `found a total of $${amount.toLocaleString()}` : "no total found",
            due ? due.why : "no due date found",
            party.known ? `${party.name} matched because ${party.how}` : `read as ${party.name} from ${party.how}`,
            party.forwardedBy ? `forwarded by ${party.forwardedBy}` : null].filter(Boolean).join("; "),
    });
  }

  if (c.kind === "customer") {
    out.push({
      kind: "reply", title: `Reply to ${party.name} — ${email.subject.slice(0, 60)}`,
      space: "company", category: "Sales & Customer Support",
      date: shift(email.date || today, 1), priority: "high",
      note: `From: ${email.from}\n\n${email.body.slice(0, 400)}`,
      confidence: c.confidence,
      why: "reads like a customer asking for something, so it needs an answer",
    });
  }

  if (c.kind === "rma") {
    out.push({
      kind: "rma", title: `RMA — ${party.name}${findRef(text) ? ` ${findRef(text)}` : ""}`,
      space: "company", category: "RMA & Returns",
      date: shift(email.date || today, 2), priority: "high",
      note: `From: ${email.from}\nSubject: ${email.subject}\n\n${email.body.slice(0, 300)}`,
      confidence: c.confidence, why: "mentions a return or warranty claim",
    });
  }

  if (c.kind === "shipment") {
    const tr = text.match(/\b(1Z[0-9A-Z]{16}|\d{12,22})\b/);
    out.push({
      kind: "delivery", title: `Receive ${party.name} delivery${tr ? ` (${tr[1]})` : ""}`,
      space: "company", category: "Delivery and Live",
      date: shift(email.date || today, 1), priority: "normal",
      note: `From: ${email.from}\nSubject: ${email.subject}${tr ? `\nTracking: ${tr[1]}` : ""}`,
      confidence: c.confidence, why: tr ? "a tracking number is in the message" : "reads like a shipment notice",
    });
  }

  // A question mark in the body, from anyone, is worth a reply task.
  if (!out.length && /\?/.test(email.body) && email.body.length < 2000) {
    out.push({
      kind: "reply", title: `Answer ${party.name} — ${email.subject.slice(0, 60)}`,
      space: "company", category: "Sales & Customer Support",
      date: shift(email.date || today, 1), priority: "normal",
      note: `From: ${email.from}\n\n${email.body.slice(0, 400)}`,
      confidence: 0.45, why: "there's a question in it but nothing else matched",
    });
  }

  return { classified: c.kind, party: party.name, who, tasks: out };
}

module.exports = { propose, classify, findDue, findAmount, findRef, muted, FREEMAIL };
