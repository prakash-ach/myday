/* The part that keeps working when nobody's looking.
 *
 * Every few minutes it goes through each connected mailbox, reads
 * anything new, pulls the invoices apart, and files what it finds into
 * a feed. Nothing it finds is saved into your tasks or price history
 * without approval — the feed is a waiting room, not a decision.
 */

const fs = require("node:fs");
const path = require("node:path");

const google = require("./google");
const { readDocument, pdfPages } = require("./documents");
const { propose } = require("./propose");
const ai = require("./ai");
const rulesLib = require("./rules");
const outbox = require("./outbox");

const feedFile = (dir, userId) => path.join(dir, "feed-" + userId + ".json");

function readFeed(dir, userId) {
  try { return JSON.parse(fs.readFileSync(feedFile(dir, userId), "utf8")); }
  catch (e) { return { items: [], seen: [], stats: {}, log: [] }; }
}

function writeFeed(dir, userId, feed) {
  fs.mkdirSync(dir, { recursive: true });
  const f = feedFile(dir, userId);
  const tmp = f + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(feed), { mode: 0o600 });
  fs.renameSync(tmp, f);
}

/* Is this attachment worth asking the AI to read as an invoice? Only when
   the built-in readers didn't already, and something says "invoice". */
const INVOICE_WORDS = /invoice|\binv[\s#-]?\d|receipt|bill of sale|statement|purchase order|\bp\.?o\.?\s?#|packing list|\blot\b|auction|qty|quantity|unit price|subtotal|total due|amount due|balance due/i;
function invoiceCandidate(doc, msg, text) {
  if (doc.rows && doc.rows.length) return false;
  if (!["pdf", "image", "csv", "text", "xlsx"].includes(doc.kind)) return false;
  if (doc.bytes > 10 * 1024 * 1024) return false;
  const around = `${doc.filename} ${msg.subject} ${String(msg.body || "").slice(0, 3000)}`;
  if (doc.kind === "image") return INVOICE_WORDS.test(around);
  if (text && text.trim()) return INVOICE_WORDS.test(text.slice(0, 6000)) && /\d/.test(text);
  return doc.kind === "pdf" && INVOICE_WORDS.test(around);           // a scan
}

/* Read one email all the way: attachments, invoices, proposed tasks.
   Used by the regular check, by "Read again with AI", and by "Look back". */
async function readOne(dir, userId, id, options, run) {
  const msg = await google.getMessage(dir, userId, id);
  const aiOn = ai.configured() && options.ai !== false;
  const documents = [];
  let attText = "";

  for (const att of (msg.attachments || [])) {
    if (!att.attachmentId || att.size > 12 * 1024 * 1024) continue;
    try {
      const buf = await google.getAttachment(dir, userId, id, att.attachmentId);
      const doc = readDocument(att.filename, att.mimeType, buf);
      doc.att = (msg.attachments || []).indexOf(att);
      doc.duplicate = !run.reread && run.seen.has("doc:" + doc.sha);
      const text = doc.text || "";

      if (aiOn && invoiceCandidate(doc, msg, text)) {
        if (run.invoices >= (options.invoiceMax || 10)) {
          doc.issues.push("left for the next check — AI invoice limit for one pass reached");
        } else {
          run.invoices++;
          try {
            const images = text.trim() ? [] : doc.kind === "image" ? [buf.toString("base64")] : pdfPages(buf, 4);
            if (!text.trim() && !images.length) doc.issues.push("couldn't turn the scan into pictures for the AI");
            else {
              const r = await ai.readInvoice(dir, userId, {
                filename: att.filename, from: msg.from, subject: msg.subject, text, images,
                imageType: doc.kind === "image" ? (att.mimeType || "image/png") : "image/png",
                makes: options.makes || [],
              });
              if (r.isInvoice && r.lines.length) {
                Object.assign(doc, {
                  rows: r.lines, supplier: r.supplier, reference: r.reference, auction: r.auction,
                  date: r.date, total: r.total, fees: r.fees, currency: r.currency, byAI: true,
                });
                doc.issues = doc.issues.filter((x) => !/no text in it/.test(x)).concat(r.warnings);
              } else if (r.isInvoice) {
                doc.issues.push("looks like an invoice, but the AI couldn't pick out the lines" + (r.notes ? ": " + r.notes : ""));
              }
            }
          } catch (e) {
            doc.issues.push("AI couldn't read it: " + String(e && e.message || e));
            run.problems.push({ subject: msg.subject, error: "AI: " + String(e && e.message || e) });
          }
        }
      } else if (doc.kind === "image" && !aiOn) {
        doc.issues.push("a picture — switch on AI to read invoices in photos");
      }

      if (text && attText.length < 4000) attText += `\n[${att.filename}]\n` + text.slice(0, 4000 - attText.length);
      if (doc.rows && doc.byAI && attText.length < 5000) {
        attText += `\n[${att.filename} read as invoice: ${doc.supplier || "?"} ${doc.reference || ""}, ${doc.rows.length} lines, total ${doc.total || "?"}]`;
      }
      delete doc.text;
      documents.push(doc);
      run.seen.add("doc:" + doc.sha);
    } catch (e) {
      run.problems.push({ subject: msg.subject, error: att.filename + ": " + String(e && e.message) });
    }
  }

  const p = propose({
    from: msg.from, subject: msg.subject, body: msg.body, date: msg.date, attachmentText: "",
  }, {
    today: run.today,
    knownSuppliers: options.knownSuppliers || [],
    supplierAddresses: options.supplierAddresses || {},
    ownDomains: options.ownDomains || [],
    people: options.people || {},
  });

  /* With OpenAI on, it reads the email and drafts what you need to do, with
     a comment and steps. The built-in invoice reader's payment tasks are kept,
     because it copies totals straight off the PDF. If the AI fails or the
     day's limit is used, the rules' tasks stand. */
  let tasks = p.tasks;
  let aiSummary = null;
  let classify = null;
  if (aiOn && p.classified !== "muted" && run.ai < (options.aiMax || 15)) {
    run.ai++;
    try {
      const r = await ai.emailTasks(dir, userId, {
        id, threadId: msg.threadId, from: msg.from, to: msg.to, subject: msg.subject,
        body: msg.body, date: msg.date, attachmentText: attText,
      }, { today: run.today, categories: options.categories, userName: options.userName,
           ownDomains: options.ownDomains, promoHints: options.rules && options.rules.promoHints });
      aiSummary = r.summary || null;
      classify = r.classify || null;
      const keep = p.tasks.filter((t) => t.kind === "payment" && t.amount);
      const extra = r.tasks.filter((t) => !(keep.length && /\bpay\b|invoice|payment/i.test(t.title)));
      tasks = [...keep, ...extra];
    } catch (e) {
      run.problems.push({ subject: msg.subject, error: "AI: " + String(e && e.message || e) });
    }
  }

  return {
    id, threadId: msg.threadId, from: msg.from, subject: msg.subject, date: msg.date, snippet: msg.snippet,
    seenAt: Date.now(), classified: p.classified, party: p.party, who: p.who || null,
    labelIds: msg.labelIds || [], listUnsubscribe: msg.listUnsubscribe || undefined,
    documents, tasks, aiSummary, classify, decided: null, readWithAI: aiOn || undefined,
    lines: documents.reduce((n, d) => n + (d.rows ? d.rows.length : 0), 0),
  };
}

/* Your automatic rules (see rules.js). Adds tasks to the outbox, marks
   promotions Ignored, and notes why — or does nothing if no rule fits. */
function applyRules(dir, userId, item, options, run) {
  const rules = options.rules;
  if (!rules) return;
  const d = rulesLib.decide(item, { classify: item.classify, summary: item.aiSummary }, rules, { ownDomains: options.ownDomains || [] });
  if (!d) return;
  const at = Date.now();
  const entry = { at, rule: d.rule, action: d.action, reason: d.reason, mailId: item.id, from: item.from, subject: item.subject };
  item.auto = (item.auto || []).filter((a) => a.rule !== d.rule);
  if (d.action === "task") {
    const task = rulesLib.buildTask(item, { classify: item.classify, summary: item.aiSummary }, d, rules, options);
    const isNew = outbox.add(dir, userId, task, { mailId: item.id, rule: d.rule, reason: d.reason });
    item.auto.push({ rule: d.rule, action: "task", taskId: task.id, title: task.title, reason: d.reason, at, already: !isNew || undefined });
    if (isNew) run.autoLog.push({ ...entry, title: task.title, taskId: task.id });
  } else if (d.action === "ignore") {
    item.auto.push({ rule: d.rule, action: "ignore", reason: d.reason, at });
    if (!item.decided) {
      item.decided = "ignored"; item.decidedAt = at; item.decidedBy = "auto"; item.decidedReason = d.reason;
      run.autoLog.push(entry);
    }
  } else {
    item.auto.push({ rule: d.rule, action: "review", reason: d.reason, at });
    run.autoLog.push(entry);
  }
}

const newRun = (feed) => ({
  autoLog: [],
  seen: new Set(feed.seen || []), problems: [], ai: 0, invoices: 0,
  today: new Date().toISOString().slice(0, 10), reread: false,
});

function finish(dir, userId, feed, run, extra) {
  feed.seen = [...run.seen].slice(-4000);
  feed.autoLog = [...run.autoLog, ...(feed.autoLog || [])].slice(0, 300);
  feed.stats = {
    ...(feed.stats || {}),
    ...extra.stats,
    totalItems: feed.items.length,
    waiting: feed.items.filter((x) => !x.decided).length,
    lines: feed.items.reduce((n, x) => n + (x.lines || 0), 0),
  };
  feed.log = [
    { at: Date.now(), looked: extra.looked, added: extra.added, problems: run.problems.length,
      ms: extra.ms, ai: (run.ai + run.invoices) || undefined, note: extra.note || undefined,
      error: run.problems.length && run.problems.every((x) => /^AI:/.test(x.error)) ? run.problems[0].error : undefined },
    ...(feed.log || []),
  ].slice(0, 50);
  writeFeed(dir, userId, feed);
  try { outbox.deliver(dir, userId); } catch (e) { /* the next tab or pass will pick them up */ }
}

/* One pass over one mailbox. Returns what it added.
   options.lookBackDays: read the last N days again, including mail the old
   rules passed over, skipping anything already in the inbox list. */
async function sweep(dir, userId, options = {}) {
  const feed = readFeed(dir, userId);
  const run = newRun(feed);
  const label = options.label || "";
  const back = Math.min(30, Math.max(0, Number(options.lookBackDays) || 0));
  const max = back ? Math.min(60, options.max || 40) : options.max || 20;

  /* A label that doesn't exist matches nothing, and Gmail gives no hint
     that's why. Rather than read zero messages forever, check it once
     and fall back to the whole inbox, saying so in the log. */
  let useLabel = label;
  let labelNote = null;
  if (label) {
    try {
      const names = await google.listLabels(dir, userId);
      const found = names.find((n) => n.toLowerCase() === label.toLowerCase());
      if (!found) { labelNote = `no label called "${label}" in this mailbox — read the whole inbox instead`; useLabel = ""; }
      else useLabel = found;
    } catch (e) { /* if the lookup fails, carry on with what we were given */ }
  }

  const started = Date.now();
  const added = [];
  let ids = [];
  try {
    /* Regular passes only need what's arrived since the last one. */
    const last = feed.stats && feed.stats.lastRun;
    const query = back ? `newer_than:${back}d`
      : last && Date.now() - last < 36 * 3600e3 ? "newer_than:" + Math.max(1, Math.ceil((Date.now() - last) / 864e5)) + "d" : "";
    ids = await google.listMessages(dir, userId, { label: useLabel, query, max });
  } catch (e) {
    feed.log = [{ at: Date.now(), error: String(e && e.message || e) }, ...(feed.log || [])].slice(0, 50);
    writeFeed(dir, userId, feed);
    throw e;
  }

  const inList = new Set((feed.items || []).map((x) => x.id));
  for (const { id } of ids) {
    if (back ? inList.has(id) : run.seen.has("msg:" + id)) continue;
    let item;
    try { item = await readOne(dir, userId, id, options, run); }
    catch (e) { run.problems.push({ id, error: String(e && e.message) }); continue; }
    run.seen.add("msg:" + id);
    applyRules(dir, userId, item, options, run);
    if (item.tasks.length || item.lines || (item.auto && item.auto.length)) added.push(item);
  }

  feed.items = [...added, ...(feed.items || [])].slice(0, 300);
  finish(dir, userId, feed, run, {
    looked: ids.length, added: added.length, ms: Date.now() - started,
    note: back ? `looked back ${back} days` : labelNote,
    stats: back ? {} : { lastRun: Date.now(), label: useLabel, labelNote, tookMs: Date.now() - started, looked: ids.length, added: added.length },
  });
  return { added, problems: run.problems, stats: feed.stats };
}

/* Read some emails in the list again, with today's readers and the AI.
   Keeps what you'd already decided, and remembers which invoices you'd
   already logged so nothing gets logged twice. */
async function reread(dir, userId, ids, options = {}) {
  const feed = readFeed(dir, userId);
  const run = newRun(feed);
  run.reread = true;
  const started = Date.now();
  const done = [];
  for (const id of ids.slice(0, 15)) {
    const i = (feed.items || []).findIndex((x) => x.id === id);
    if (i < 0) continue;
    const old = feed.items[i];
    let item;
    try { item = await readOne(dir, userId, id, options, run); }
    catch (e) { run.problems.push({ id, error: String(e && e.message) }); continue; }
    item.decided = old.decided || null;
    if (old.decidedAt) item.decidedAt = old.decidedAt;
    if (old.decidedBy) { item.decidedBy = old.decidedBy; item.decidedReason = old.decidedReason; }
    if (old.undoneAt) item.undoneAt = old.undoneAt;
    item.seenAt = old.seenAt;
    for (const d of item.documents) {
      const was = (old.documents || []).find((o) => o.sha === d.sha);
      if (was && was.logged) d.logged = was.logged;
    }
    if (!item.undoneAt) applyRules(dir, userId, item, options, run);
    feed.items[i] = item;
    done.push(item);
  }
  finish(dir, userId, feed, run, { looked: done.length, added: 0, ms: Date.now() - started, note: `read ${done.length} again`, stats: {} });
  return { items: done, problems: run.problems };
}

/* Remember an invoice was logged to Auctions. */
function markLogged(dir, userId, id, sha, count) {
  const feed = readFeed(dir, userId);
  const item = (feed.items || []).find((x) => x.id === id);
  const doc = item && (item.documents || []).find((d) => d.sha === sha);
  if (!doc) return false;
  doc.logged = { at: Date.now(), count: Number(count) || 0 };
  writeFeed(dir, userId, feed);
  return true;
}

/* The loop. Started once when the server starts. */
function start(dir, { everyMinutes = 10, usersFile, readJson, settingsFor } = {}) {
  let running = false;

  const pass = async () => {
    if (running) return;
    running = true;
    try {
      const db = readJson(usersFile()) || { users: [] };
      for (const u of db.users) {
        const t = google.readTokens(dir, u.id);
        if (!t || !t.refresh_token) continue;          // no mailbox connected
        const opts = settingsFor ? settingsFor(u) : {};
        if (opts.paused) continue;
        try {
          const r = await sweep(dir, u.id, opts);
          if (r.added.length) {
            console.log(`[watcher] ${u.username}: ${r.added.length} new, ${r.stats.lines} lines total`);
          }
        } catch (e) {
          console.log(`[watcher] ${u.username}: ${String(e && e.message || e)}`);
        }
      }
    } finally { running = false; }
  };

  setTimeout(pass, 20000);                              // once shortly after boot
  const timer = setInterval(pass, Math.max(2, everyMinutes) * 60000);
  timer.unref();
  return { pass, stop: () => clearInterval(timer) };
}

/* Put an automatically ignored message back in Review. */
function undoIgnore(dir, userId, id) {
  const feed = readFeed(dir, userId);
  const item = (feed.items || []).find((x) => x.id === id);
  if (!item || item.decidedBy !== "auto") return false;
  item.decided = null; item.decidedBy = null; item.undoneAt = Date.now();
  feed.autoLog = [{ at: Date.now(), rule: "you", action: "undo", reason: "you put it back in Review", mailId: id, from: item.from, subject: item.subject },
    ...(feed.autoLog || [])].slice(0, 300);
  writeFeed(dir, userId, feed);
  return true;
}

module.exports = { sweep, reread, markLogged, undoIgnore, readFeed, writeFeed, start };
