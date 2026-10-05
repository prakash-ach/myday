/* OpenAI, used in two places:
 *
 *   emailTasks()  reads one email and drafts the tasks it needs, each with a
 *                 comment explaining what to do and why. The drafts go to the
 *                 Automation inbox like every other proposal: nothing becomes a
 *                 task until you approve it.
 *
 *   chat()        the assistant you talk to. It answers about your tasks and
 *                 can suggest changes, which come back as buttons. It never
 *                 changes anything itself.
 *
 * The key lives in /etc/myday/secrets.env as OPENAI_API_KEY and never leaves
 * the server. OPENAI_MODEL changes the model; AI_DAILY_LIMIT caps calls per
 * person per day so a runaway can't run up a bill. OPENAI_BASE_URL points it
 * at another OpenAI-compatible service if you ever want one.
 */

const fs = require("node:fs");
const path = require("node:path");

const MODEL = () => process.env.OPENAI_MODEL || "gpt-5.4-mini";
const LIMIT = () => Math.max(1, Number(process.env.AI_DAILY_LIMIT || 400));
const configured = () => !!(process.env.OPENAI_API_KEY || "").trim();

/* ---------- daily allowance, per person ---------- */
const usageFile = (dir, userId) => path.join(dir, "ai-usage-" + userId + ".json");
const dayKey = () => new Date().toISOString().slice(0, 10);
function usage(dir, userId) {
  try {
    const u = JSON.parse(fs.readFileSync(usageFile(dir, userId), "utf8"));
    return u.day === dayKey() ? u : { day: dayKey(), calls: 0, tokens: 0 };
  } catch (e) { return { day: dayKey(), calls: 0, tokens: 0 }; }
}
function spend(dir, userId, tokens) {
  const u = usage(dir, userId);
  u.calls += 1; u.tokens += tokens || 0;
  try { fs.writeFileSync(usageFile(dir, userId), JSON.stringify(u), { mode: 0o600 }); } catch (e) {}
}

/* ---------- one call ---------- */
async function call(dir, userId, messages, { maxTokens = 1500 } = {}) {
  if (!configured()) throw new Error("OpenAI isn't set up yet");
  if (usage(dir, userId).calls >= LIMIT()) throw new Error(`Today's limit of ${LIMIT()} AI requests is used up. It resets at midnight UTC.`);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60000);
  let res, data;
  try {
    res = await fetch((process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "") + "/chat/completions", {
      method: "POST",
      signal: ctl.signal,
      headers: { "content-type": "application/json", authorization: "Bearer " + process.env.OPENAI_API_KEY.trim() },
      body: JSON.stringify({
        model: MODEL(),
        messages,
        response_format: { type: "json_object" },
        max_completion_tokens: maxTokens,
      }),
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    throw new Error(e && e.name === "AbortError" ? "OpenAI took too long to answer" : "Couldn't reach OpenAI");
  } finally { clearTimeout(timer); }

  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || res.statusText;
    if (res.status === 401) throw new Error("OpenAI didn't accept the key. Check OPENAI_API_KEY in /etc/myday/secrets.env.");
    if (res.status === 429) throw new Error("OpenAI says slow down, or the account is out of credit: " + msg);
    if (res.status === 404) throw new Error(`OpenAI doesn't know the model "${MODEL()}". Set OPENAI_MODEL in /etc/myday/secrets.env.`);
    throw new Error("OpenAI: " + msg);
  }
  spend(dir, userId, data.usage && data.usage.total_tokens);
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || "";
  try { return JSON.parse(text); }
  catch (e) {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (e2) {} }
    throw new Error("OpenAI's answer wasn't readable");
  }
}

/* ---------- tidying what comes back ---------- */
const PRI = new Set(["low", "normal", "high", "urgent"]);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !Number.isNaN(Date.parse(s));
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ""));
const clip = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const rid = () => Math.random().toString(36).slice(2, 10);
function pickCategory(cats, space, wanted) {
  const list = (cats && cats[space]) || [];
  if (!list.length) return wanted || "";
  const w = String(wanted || "").toLowerCase();
  return list.find((c) => c.toLowerCase() === w) || list.find((c) => w && (c.toLowerCase().includes(w) || w.includes(c.toLowerCase()))) || list[0];
}

/* ---------- 1. email → proposed tasks ---------- */
async function emailTasks(dir, userId, email, opts = {}) {
  const today = opts.today || dayKey();
  const cats = opts.categories || { company: [], personal: [] };
  const name = opts.userName || "the owner";
  const body = String(email.body || "").slice(0, 7000);
  const att = String(email.attachmentText || "").slice(0, 3500);

  const sys = `You read one email for ${name}, who runs a business (company work) and also has a personal life, and decide what ${name} needs to DO because of it.
Today is ${today}.
Reply with JSON only, shaped exactly like:
{"needs_action": true|false,
 "summary": "one sentence: what this email is",
 "tasks": [{
   "title": "short imperative, max 80 chars, e.g. 'Reply to Sam with the iPhone 13 quote'",
   "space": "company" or "personal",
   "category": one of the category names below for that space,
   "date": "YYYY-MM-DD, the day to do it (use any deadline in the email; otherwise today for urgent, else tomorrow)",
   "time": "HH:MM 24h if the email names a time, else empty string",
   "priority": "low" | "normal" | "high" | "urgent",
   "steps": ["2 to 5 short concrete steps"],
   "comment": "2-4 sentences for the task's note: what was asked, by whom, any amounts, references or deadlines, and anything to watch out for",
   "why": "one short reason this needs doing",
   "confidence": 0.0-1.0
 }]}
Rules: newsletters, promotions, receipts with nothing to do, automatic notifications and FYI-only mail get needs_action false and no tasks.
At most 3 tasks. Never invent facts that aren't in the email. Keep amounts, invoice numbers and names exactly as written.
Company categories: ${JSON.stringify(cats.company || [])}
Personal categories: ${JSON.stringify(cats.personal || [])}`;

  const user = `From: ${email.from || ""}\nTo: ${email.to || ""}\nDate: ${email.date || ""}\nSubject: ${email.subject || ""}\n\n${body}${att ? `\n\n--- Attachment text ---\n${att}` : ""}`;

  const out = await call(dir, userId, [{ role: "system", content: sys }, { role: "user", content: user }], { maxTokens: 1400 });
  if (!out || out.needs_action === false || !Array.isArray(out.tasks)) return { summary: clip(out && out.summary, 200), tasks: [] };

  const link = email.threadId || email.id ? `https://mail.google.com/mail/u/0/#all/${email.threadId || email.id}` : "";
  const tasks = out.tasks.slice(0, 3).map((t) => {
    const space = t.space === "personal" ? "personal" : "company";
    const steps = (Array.isArray(t.steps) ? t.steps : []).map((s) => clip(s, 120)).filter(Boolean).slice(0, 6);
    const note = [
      clip(t.comment, 900),
      "",
      `From: ${clip(email.from, 160)}`,
      `Subject: ${clip(email.subject, 200)}`,
      email.date ? `Received: ${clip(email.date, 60)}` : null,
      link ? `Open in Gmail: ${link}` : null,
      "",
      `Drafted by AI from this email — check before acting.`,
    ].filter((x) => x !== null).join("\n");
    return {
      kind: "ai",
      title: clip(t.title, 90) || clip(email.subject, 90),
      space,
      category: pickCategory(cats, space, t.category),
      date: isDate(t.date) ? t.date : addDays(today, 1),
      time: isTime(t.time) ? t.time : "",
      priority: PRI.has(t.priority) ? t.priority : "normal",
      note,
      subtasks: steps.map((s) => ({ id: rid(), title: s, done: false })),
      confidence: Math.max(0, Math.min(1, Number(t.confidence) || 0.6)),
      why: "AI: " + (clip(t.why, 160) || "this email asks for something"),
    };
  });
  return { summary: clip(out.summary, 200), tasks };
}

/* ---------- 1b. any invoice → clean auction lines ----------
 * For attachments the built-in ONM and Rexi readers don't recognise: text
 * PDFs, scans, photos, spreadsheets and CSVs. It sends the text, or page
 * pictures for scans and photos, and asks for every device line in the same
 * shape MYDAY's own readers produce. Each line is then checked here (qty ×
 * price against the line total, the lines against the invoice total) and
 * gets a confidence score and plain-English issues, so you can see what to
 * check before anything is logged. */
const MAKES = ["Apple", "Samsung", "Google", "Motorola", "OnePlus", "LG", "TCL", "Nokia", "Xiaomi", "Sony", "Huawei", "ZTE", "Alcatel", "Kyocera", "Microsoft", "Lenovo"];
const num = (x) => { const n = Number(String(x == null ? "" : x).replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : null; };

async function readInvoice(dir, userId, doc) {
  const known = [...new Set([...(doc.makes || []), ...MAKES])];
  const sys = `You read supplier invoices for a business that buys used phones and devices, often at auction, and turn them into clean lines.
Reply with JSON only:
{"is_invoice": true|false,
 "supplier": "company that issued it",
 "reference": "invoice number as printed",
 "auction": "auction / lot / PO reference if any, else empty",
 "date": "YYYY-MM-DD invoice date",
 "currency": "USD unless it says otherwise",
 "total": number (grand total as printed) or null,
 "fees": [{"label":"shipping / tax / buyer premium / etc","amount":number}],
 "lines": [{"oem":"maker","model":"model","size":"128GB","grade":"A","carrier":"","qty":1,"price":0,"amount":0,"raw":"line as printed"}],
 "notes": "anything unclear, short"}
Rules for lines:
- One line per product line on the invoice. Devices only; shipping, tax, fees and premiums go in "fees", not lines.
- oem: one of ${JSON.stringify(known)} if it fits, spelled exactly like that; otherwise as written.
- model: without the maker's name, as a buyer would say it, e.g. "iPhone 13 Pro Max", "Galaxy S22 Ultra", "Pixel 7a".
- size: storage like "64GB", "128GB", "1TB"; "—" if none.
- grade: exactly as the invoice grades it, uppercase, e.g. "A", "B+", "C", "D", "CPO", "NEW". Empty if not stated.
- carrier: e.g. "Unlocked", "T-Mobile", "Verizon", "AT&T", empty if not stated.
- qty: whole number. price: unit price per device. amount: line total. Numbers only, no $.
- Copy what's printed. Never invent lines, prices or grades. If you can't read part of it, say so in notes.
If this isn't an invoice, bill, receipt or packing list with prices, set is_invoice false and lines [].`;

  const head = `File: ${doc.filename}\nEmail from: ${doc.from || ""}\nEmail subject: ${doc.subject || ""}`;
  const content = [];
  if (doc.text && doc.text.trim()) {
    content.push({ type: "text", text: `${head}\n\n--- Document text ---\n${String(doc.text).slice(0, 24000)}` });
  } else {
    content.push({ type: "text", text: `${head}\n\nThe document is attached as ${doc.images.length} page picture(s).` });
    for (const b64 of (doc.images || []).slice(0, 4)) {
      content.push({ type: "image_url", image_url: { url: `data:${doc.imageType || "image/png"};base64,${b64}`, detail: "high" } });
    }
  }
  const out = await call(dir, userId, [{ role: "system", content: sys }, { role: "user", content }], { maxTokens: 12000 });
  if (!out || out.is_invoice === false) return { isInvoice: false, lines: [], notes: clip(out && out.notes, 200) };

  const lines = (Array.isArray(out.lines) ? out.lines : []).slice(0, 400).map((l) => {
    const row = {
      raw: clip(l.raw, 200), oem: clip(l.oem, 30), model: clip(l.model, 80),
      size: clip(l.size, 12) || "—", grade: clip(l.grade, 10).toUpperCase(), carrier: clip(l.carrier, 20),
      qty: Math.max(1, Math.round(num(l.qty) || 1)), price: num(l.price) || 0, amount: num(l.amount),
      confidence: 1, issues: [], byAI: true,
    };
    const mk = known.find((m) => m.toLowerCase() === row.oem.toLowerCase());
    if (mk) row.oem = mk; else { row.issues.push("make not recognised"); row.confidence -= 0.3; }
    if (row.size !== "—") {
      const m = row.size.replace(/\s+/g, "").match(/^(\d+)(GB|TB)$/i);
      if (m) row.size = m[1] + m[2].toUpperCase(); else { row.issues.push("storage size looks odd"); row.confidence -= 0.1; }
    } else { row.issues.push("no storage size"); row.confidence -= 0.2; }
    if (!row.grade) { row.issues.push("no grade on the line"); row.confidence -= 0.3; }
    if (!row.model) { row.issues.push("no model"); row.confidence -= 0.4; }
    if (!row.price) { row.issues.push("no price"); row.confidence -= 0.4; }
    if (row.amount != null && row.price && Math.abs(row.qty * row.price - row.amount) > 0.05) {
      row.issues.push("quantity times price doesn't match the line total"); row.confidence -= 0.2;
    }
    if (row.amount == null) row.amount = Math.round(row.qty * row.price * 100) / 100;
    row.confidence = Math.max(0, Math.round(row.confidence * 100) / 100);
    return row;
  }).filter((r) => r.model || r.raw);

  const fees = (Array.isArray(out.fees) ? out.fees : []).slice(0, 12)
    .map((f) => ({ label: clip(f.label, 40), amount: num(f.amount) || 0 })).filter((f) => f.amount);
  const total = num(out.total);
  const warnings = [];
  const summed = lines.reduce((n, r) => n + r.amount, 0) + fees.reduce((n, f) => n + f.amount, 0);
  if (total && lines.length && Math.abs(summed - total) > 1) {
    warnings.push(`lines and fees add to ${summed.toFixed(2)} but the invoice total is ${total.toFixed(2)}`);
  }
  if (out.notes) warnings.push("AI: " + clip(out.notes, 160));
  return {
    isInvoice: true, lines, fees, total, warnings,
    supplier: clip(out.supplier, 80), reference: clip(out.reference, 60), auction: clip(out.auction, 60),
    date: isDate(out.date) ? out.date : "", currency: clip(out.currency, 6) || "USD",
  };
}

/* ---------- 2. the assistant you talk to ---------- */
async function chat(dir, userId, { messages, context, assistantName, userName, mail }) {
  const name = clip(assistantName, 30) || "Max";
  const ctxText = JSON.stringify(context || {}).slice(0, 50000);
  const mailText = mail ? JSON.stringify(mail).slice(0, 30000) : "";
  const sys = `You are ${name}, the assistant inside MYDAY, ${clip(userName, 40) || "the user"}'s task planner. You are friendly, brief and practical, and you speak plainly — short sentences, no jargon.
You can see their tasks in the JSON below (ids, titles, dates, times, categories, done or not). Today is ${context && context.today}, now is ${context && context.now}.
Answer questions about their tasks, help them plan the day, and suggest changes.
You cannot change anything yourself. To suggest a change, add it to "actions"; the user taps a button to do it.
Reply with JSON only:
{"reply": "what you say, under 120 words unless they ask for detail; use plain text, line breaks allowed",
 "actions": [
   {"type":"add","title":"...","space":"company|personal","category":"exact category name","date":"YYYY-MM-DD","time":"HH:MM or empty","priority":"low|normal|high|urgent","note":"optional"},
   {"type":"done","id":"task id"},
   {"type":"move","id":"task id","date":"YYYY-MM-DD","time":"HH:MM or empty"},
   {"type":"priority","id":"task id","priority":"low|normal|high|urgent"},
   {"type":"approve_mail","mailId":"mail id"},
   {"type":"ignore_mail","mailId":"mail id"},
   {"type":"review_invoice","mailId":"mail id"}
 ]}
Only use ids that appear in the data. Only suggest actions when the user asks for a change or clearly wants one; otherwise "actions": [].
If something isn't in the data, say you can't see it rather than guessing.
${mail ? `
"Automation" (also called the Automation tab or inbox) is the list below: emails MYDAY read from their Gmail, with the tasks it proposed, waiting for them to approve or ignore. When they ask about Automation, their Gmail, or what came in, use this. approve_mail adds that email's proposed tasks; ignore_mail dismisses it. Mention amounts and deadlines when there are any.
Each email may list "invoices" read from its attachments (supplier, lines, total, whether already logged to Auctions). When one isn't logged yet, offer review_invoice, which opens it for them to check and log to Auctions. "attachmentsNotRead" says what couldn't be read and why.
Automation inbox:
${mailText}
` : `
They can't see the Automation inbox (the owner hasn't given them that section), so say so if they ask about it.
`}
Their tasks:
${ctxText}`;

  const convo = (Array.isArray(messages) ? messages : []).slice(-16)
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
    .map((m) => ({ role: m.role, content: clip(m.content, 4000) }));
  if (!convo.length) throw new Error("Nothing to answer");

  const out = await call(dir, userId, [{ role: "system", content: sys }, ...convo], { maxTokens: 1200 });
  const cats = (context && context.categories) || {};
  const ids = new Set(((context && context.tasks) || []).map((t) => t.id));
  const mails = new Map(((mail && mail.waiting) || []).map((m) => [m.mailId, m]));
  const actions = (Array.isArray(out.actions) ? out.actions : []).slice(0, 8).map((a) => {
    if (!a || typeof a !== "object") return null;
    if (a.type === "add") {
      const space = a.space === "personal" ? "personal" : "company";
      return { type: "add", title: clip(a.title, 90), space, category: pickCategory(cats, space, a.category),
        date: isDate(a.date) ? a.date : (context && context.today), time: isTime(a.time) ? a.time : "",
        priority: PRI.has(a.priority) ? a.priority : "normal", note: clip(a.note, 600) };
    }
    if (a.type === "review_invoice") {
      const m = mails.get(a.mailId);
      const inv = m && (m.invoices || [])[0];
      return inv ? { type: a.type, mailId: a.mailId, subject: m.subject, label: `${inv.supplier || m.from} · ${inv.lines} lines${inv.total ? " · $" + inv.total : ""}` } : null;
    }
    if (a.type === "approve_mail" || a.type === "ignore_mail") {
      const m = mails.get(a.mailId);
      return m ? { type: a.type, mailId: a.mailId, subject: m.subject, from: m.from, count: m.proposed.length } : null;
    }
    if (!ids.has(a.id)) return null;
    if (a.type === "done") return { type: "done", id: a.id };
    if (a.type === "move" && isDate(a.date)) return { type: "move", id: a.id, date: a.date, time: isTime(a.time) ? a.time : "" };
    if (a.type === "priority" && PRI.has(a.priority)) return { type: "priority", id: a.id, priority: a.priority };
    return null;
  }).filter((a) => a && (a.type !== "add" || a.title));

  return { reply: String(out.reply || "").slice(0, 3000) || "…", actions };
}

module.exports = { configured, MODEL, LIMIT, usage, emailTasks, readInvoice, chat };
