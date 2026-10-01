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
const { readDocument } = require("./documents");
const { propose } = require("./propose");

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

/* One pass over one mailbox. Returns what it added. */
async function sweep(dir, userId, options = {}) {
  const feed = readFeed(dir, userId);
  const seen = new Set(feed.seen || []);
  const label = options.label || "";
  const max = options.max || 20;

  const started = Date.now();
  const added = [];
  const problems = [];

  let ids = [];
  try {
    ids = await google.listMessages(dir, userId, { label, max });
  } catch (e) {
    feed.log = [{ at: Date.now(), error: String(e && e.message || e) }, ...(feed.log || [])].slice(0, 50);
    writeFeed(dir, userId, feed);
    throw e;
  }

  for (const { id } of ids) {
    if (seen.has("msg:" + id)) continue;      // already looked at this message
    let msg;
    try { msg = await google.getMessage(dir, userId, id); }
    catch (e) { problems.push({ id, error: String(e && e.message) }); continue; }

    const documents = [];
    for (const att of (msg.attachments || [])) {
      if (!att.attachmentId || att.size > 12 * 1024 * 1024) continue;
      try {
        const buf = await google.getAttachment(dir, userId, id, att.attachmentId);
        const doc = readDocument(att.filename, att.mimeType, buf);
        doc.duplicate = seen.has("doc:" + doc.sha);
        delete doc.text;
        documents.push(doc);
        seen.add("doc:" + doc.sha);
      } catch (e) {
        problems.push({ subject: msg.subject, error: att.filename + ": " + String(e && e.message) });
      }
    }

    const p = propose({
      from: msg.from, subject: msg.subject, body: msg.body, date: msg.date,
      attachmentText: "",
    }, {
      today: new Date().toISOString().slice(0, 10),
      knownSuppliers: options.knownSuppliers || [],
      supplierAddresses: options.supplierAddresses || {},
      ownDomains: options.ownDomains || [],
      people: options.people || {},
    });

    seen.add("msg:" + id);
    const item = {
      id, from: msg.from, subject: msg.subject, date: msg.date, snippet: msg.snippet,
      seenAt: Date.now(), classified: p.classified, party: p.party, who: p.who || null,
      documents, tasks: p.tasks, decided: null,
      lines: documents.reduce((n, d) => n + (d.rows ? d.rows.length : 0), 0),
    };
    if (item.tasks.length || item.lines) added.push(item);
  }

  feed.items = [...added, ...(feed.items || [])].slice(0, 300);
  feed.seen = [...seen].slice(-4000);
  feed.stats = {
    lastRun: Date.now(),
    tookMs: Date.now() - started,
    looked: ids.length,
    added: added.length,
    totalItems: feed.items.length,
    waiting: feed.items.filter((x) => !x.decided).length,
    lines: feed.items.reduce((n, x) => n + (x.lines || 0), 0),
  };
  feed.log = [
    { at: Date.now(), looked: ids.length, added: added.length,
      problems: problems.length, ms: Date.now() - started },
    ...(feed.log || []),
  ].slice(0, 50);
  writeFeed(dir, userId, feed);
  return { added, problems, stats: feed.stats };
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

module.exports = { sweep, readFeed, writeFeed, start };
