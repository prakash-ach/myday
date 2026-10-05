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

/* ---------- 2. the assistant you talk to ---------- */
async function chat(dir, userId, { messages, context, assistantName, userName }) {
  const name = clip(assistantName, 30) || "Max";
  const ctxText = JSON.stringify(context || {}).slice(0, 60000);
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
   {"type":"priority","id":"task id","priority":"low|normal|high|urgent"}
 ]}
Only use ids that appear in the data. Only suggest actions when the user asks for a change or clearly wants one; otherwise "actions": [].
If something isn't in the data, say you can't see it rather than guessing.

Their data:
${ctxText}`;

  const convo = (Array.isArray(messages) ? messages : []).slice(-16)
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
    .map((m) => ({ role: m.role, content: clip(m.content, 4000) }));
  if (!convo.length) throw new Error("Nothing to answer");

  const out = await call(dir, userId, [{ role: "system", content: sys }, ...convo], { maxTokens: 1200 });
  const cats = (context && context.categories) || {};
  const ids = new Set(((context && context.tasks) || []).map((t) => t.id));
  const actions = (Array.isArray(out.actions) ? out.actions : []).slice(0, 8).map((a) => {
    if (!a || typeof a !== "object") return null;
    if (a.type === "add") {
      const space = a.space === "personal" ? "personal" : "company";
      return { type: "add", title: clip(a.title, 90), space, category: pickCategory(cats, space, a.category),
        date: isDate(a.date) ? a.date : (context && context.today), time: isTime(a.time) ? a.time : "",
        priority: PRI.has(a.priority) ? a.priority : "normal", note: clip(a.note, 600) };
    }
    if (!ids.has(a.id)) return null;
    if (a.type === "done") return { type: "done", id: a.id };
    if (a.type === "move" && isDate(a.date)) return { type: "move", id: a.id, date: a.date, time: isTime(a.time) ? a.time : "" };
    if (a.type === "priority" && PRI.has(a.priority)) return { type: "priority", id: a.id, priority: a.priority };
    return null;
  }).filter((a) => a && (a.type !== "add" || a.title));

  return { reply: String(out.reply || "").slice(0, 3000) || "…", actions };
}

module.exports = { configured, MODEL, LIMIT, usage, emailTasks, chat };
