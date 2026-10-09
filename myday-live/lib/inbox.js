/* The Automation inbox, as you see it.
 *
 * READ-ONLY. This builds a view from what the watcher stored; it never
 * changes, removes or rewrites any stored email, suggestion or decision.
 * Sorting things into "Handled quietly", grouping replies, and holding back
 * unsafe suggestions all happen here, at display time, and every one comes
 * with its reason and can be undone. The only thing it reads besides the
 * feed is your own "put back" choices (feed.viewOverrides), which are new
 * entries, not edits.
 *
 *   needs  — something for you to decide
 *   auto   — a task was already added to My Day automatically
 *   quiet  — handled quietly: codes, login alerts, shipping notices,
 *            promotions, "PAID" confirmations, your own company's automatic
 *            notices, or nothing to do
 */

const domainOf = (from) => ((String(from || "").match(/@([^>\s]+)/) || [])[1] || "").toLowerCase();
const localOf = (from) => ((String(from || "").match(/<?([^<@\s]+)@/) || [])[1] || "").toLowerCase();
const nameOf = (from) => ((String(from || "").match(/^\s*"?([^"<]+?)"?\s*</) || [])[1] || String(from || "")).trim();

const QUIET = [
  [/\b(verification|security|confirmation|one[- ]time|login|sign[- ]?in|otp)\s*(code|pin|passcode)\b|\bhere'?s (your|the) (verification )?code\b|\bverify your (email|account)\b/i, "a verification or sign-in code"],
  [/\blogin (success|alert|attempt)|new (sign[- ]?in|login)\b|\bsign[- ]?in (alert|attempt)|password (reset|changed)|\b2fa\b/i, "a login or security alert"],
  [/\bhas been shipped\b|\bhas shipped\b|\bshipping (confirmation|update|notification)\b|\bout for delivery\b|\bdelivered\b|\bdelivery status notification\b|\btracking (number|update)\b/i, "a shipping or delivery notice"],
  [/\bunsubscribe\b|\bnewsletter\b|\b\d+% off\b|\bsale (begins|ends|starts)|\bdon'?t miss\b|\blimited time\b|\bearn big\b|\brewards?\b.*\b(earn|points)\b|\bpre-?order\b/i, "a promotion"],
  [/\boffline message\b|\bauto(matic)? ?reply\b|\bout of office\b|\bundeliverable\b|\bmail delivery (failed|subsystem)\b/i, "an automatic message"],
];
const PAID = /(^|\b)(re:\s*|fwd?:\s*)*paid\b[:\s]|\bpayment (received|confirmation|confirmed)\b|\bpaid in full\b|\breceipt (for|#)/i;
const AUTOMATED_LOCAL = /^(no-?reply|do-?not-?reply|notifications?|orders?|shipping|support|rma|system|mailer|alerts?|auto|info|sales-?orders?)/i;

function invoiceNo(item) {
  const d = (item.documents || []).find((x) => x.reference);
  if (d) return String(d.reference).toLowerCase().replace(/[^a-z0-9]/g, "");
  const m = String(item.subject || "").match(/\b(?:invoice|inv)\b\s*(?:#|no\.?|number)?\s*:?\s*([A-Z]{0,5}-?\d{3,})/i);
  return m ? m[1].toLowerCase().replace(/[^a-z0-9]/g, "") : "";
}
const baseSubject = (s) => String(s || "").replace(/^\s*((re|fw|fwd|paid)\s*:\s*)+/i, "").replace(/\s+/g, " ").trim().toLowerCase();

/* Why this one can be handled quietly — or "" if it needs you. */
function quietReason(item, own) {
  const subject = String(item.subject || "");
  const text = subject + " " + String(item.snippet || "");
  const c = item.classify || {};
  if (item.auto && item.auto.some((a) => a.action === "ignore")) return item.auto.find((a) => a.action === "ignore").reason;
  if (c.type === "promotion" && (c.confidence || 0) >= 0.7) return "a promotion";
  for (const [re, why] of QUIET) if (re.test(text)) {
    if (why === "a promotion" && (item.documents || []).some((d) => d.rows && d.rows.length)) continue;  // never quiet an invoice
    return why;
  }
  if ((item.labelIds || []).includes("CATEGORY_PROMOTIONS") && !(item.documents || []).length) return "Gmail files it under Promotions";
  if (PAID.test(subject)) return "a \u201cpaid\u201d confirmation — nothing left to pay";
  if (own(item.from) && (AUTOMATED_LOCAL.test(localOf(item.from)) || /\bnew order\b|\brma completed\b|\border (#|number)|\bsales order\b/i.test(subject)))
    return "an automatic notice from your own company";
  if (!(item.tasks || []).length && !(item.documents || []).some((d) => d.rows && d.rows.length) && !(item.auto || []).length) return "nothing to do in it";
  return "";
}

/* A suggestion we won't offer by default, and why. */
function unsafe(task, item, quiet) {
  if (task.kind !== "payment" && !/^pay\b/i.test(task.title || "")) return "";
  if (PAID.test(item.subject || "")) return "the email says it's already paid";
  if (quiet) return `it's ${quiet}`;
  const c = item.classify || {};
  if (c.type === "promotion") return "it's a promotion";
  if (item.readWithAI && c.type && c.type !== "supplier_invoice" && c.type !== "order" && !(item.documents || []).some((d) => d.rows && d.rows.length))
    return "the AI didn't read it as a bill";
  return "";
}

function build(feed, { ownDomains = [], toReviewInvoices = 0, since = 0, sinceDay = "", learned = null } = {}) {
  const own = (from) => { const d = domainOf(from); return ownDomains.some((o) => o && (d === o.toLowerCase() || d.endsWith("." + o.toLowerCase()))); };
  const overrides = feed.viewOverrides || {};
  const waiting = (feed.items || []).filter((x) => !x.decided);
  // "Start from now": older mail is tucked away from this view — never changed or deleted.
  const items = since ? waiting.filter((x) => (x.seenAt || 0) >= since && (!sinceDay || (x.date || "") >= sinceDay)) : waiting;

  // One row per conversation or invoice number.
  const groups = new Map();
  for (const it of items) {
    const inv = invoiceNo(it);
    const key = inv ? "inv:" + inv : "sub:" + baseSubject(it.subject) + "|" + (own(it.from) ? "own" : domainOf(it.from));
    (groups.get(key) || groups.set(key, []).get(key)).push(it);
  }

  const rows = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => (b.seenAt || 0) - (a.seenAt || 0));
    const lead = list[0];
    // What you taught MYDAY wins over the built-in guesses.
    const reasons = list.map((it) => {
      const L = learned ? learned(it) : { hint: "" };
      if (L.hint === "needs") return "";
      if (L.hint === "quiet") return L.why;
      return quietReason(it, own);
    });
    const forced = list.some((it) => overrides[it.id] === "needs");
    // Quiet only if every email in the conversation is quiet.
    const quiet = !forced && reasons.every(Boolean) ? reasons[0] : "";
    const paidSeen = list.some((it) => PAID.test(it.subject || ""));
    const seen = new Set(), tasks = [];
    for (const it of list) for (const t of it.tasks || []) {
      const k = String(t.title || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60);
      if (seen.has(k)) continue; seen.add(k);
      const why = unsafe(t, paidSeen ? { ...it, subject: "PAID: " + it.subject } : it, quiet);
      tasks.push({ title: t.title, date: t.date, time: t.time || "", priority: t.priority, category: t.category, amount: t.amount || null, kind: t.kind, from: it.id, held: why || undefined });
    }
    const auto = list.flatMap((it) => (it.auto || []).filter((a) => a.action === "task").map((a) => ({ title: a.title, reason: a.reason })));
    const invSeen = new Set();
    const invoices = list.flatMap((it) => (it.documents || []).filter((d) => d.rows && d.rows.length).map((d) => ({ mailId: it.id, sha: d.sha, reference: d.reference, lines: d.rows.length, total: d.total, logged: !!d.logged })))
      .filter((x) => { const k = String(x.reference || x.sha).toLowerCase(); if (invSeen.has(k)) return false; invSeen.add(k); return true; });   // same invoice in several emails = one
    rows.push({
      key, ids: list.map((it) => it.id), lead: lead.id, count: list.length,
      // Name the other side of the conversation, not your own colleague who replied.
      subject: lead.subject.replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, ""), from: (list.find((it) => !own(it.from)) || lead).from,
      who: nameOf((list.find((it) => !own(it.from)) || lead).from), own: own(lead.from),
      date: lead.date, seenAt: lead.seenAt, kind: lead.classified, summary: lead.aiSummary || lead.snippet || "",
      emails: list.map((it) => ({ id: it.id, from: it.from, subject: it.subject, date: it.date, snippet: it.aiSummary || it.snippet || "" })),
      tasks, auto, invoices, paid: paidSeen,
      bucket: quiet ? "quiet" : auto.length ? "auto" : "needs", quiet: quiet || undefined, forced: forced || undefined,
    });
  }
  rows.sort((a, b) => (b.seenAt || 0) - (a.seenAt || 0));

  // Owed: each unpaid invoice once, nothing quiet, nothing marked paid.
  const owedBy = new Map();
  for (const r of rows) {
    if (r.bucket === "quiet" || r.paid) continue;
    for (const t of r.tasks) if (t.amount && !t.held && (t.kind === "payment" || /^pay\b/i.test(t.title))) {
      const k = r.key.startsWith("inv:") ? r.key : r.key + "|" + t.amount;
      if (!owedBy.has(k)) owedBy.set(k, Number(t.amount) || 0);
    }
  }
  return {
    rows,
    counts: { needs: rows.filter((r) => r.bucket === "needs").length, auto: rows.filter((r) => r.bucket === "auto").length, quiet: rows.filter((r) => r.bucket === "quiet").length, emails: items.length },
    owed: { total: [...owedBy.values()].reduce((n, v) => n + v, 0), invoices: owedBy.size },
    toReviewInvoices, tucked: waiting.length - items.length, since,
  };
}

module.exports = { build, quietReason, PAID };
