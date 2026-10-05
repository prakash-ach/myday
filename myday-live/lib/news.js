/* Phone industry news.
 *
 * Reads free, public RSS/Atom feeds — official newsrooms and release notes
 * first, then established phone-news sites — on a timer. Feeds are made for
 * this kind of reading; it never scrapes article pages. For each story it
 * keeps the headline, source, publication date and link, tags brands and
 * topics, marks it Official / Confirmed / Rumor, groups the same story from
 * several sites, and (if the AI is on) writes a short summary in its own
 * words with why it may matter to a repair and resale business. Summaries
 * are cached so each story is only ever summarised once, under a daily cap.
 *
 * A source that's down is skipped and shown as down; the rest carry on.
 * Stories always show their real publication date, and the page shows when
 * it was last refreshed, so nothing old is passed off as new.
 *
 * Sources can be changed without code: put a JSON array like DEFAULT_SOURCES
 * in <data dir>/news-sources.json.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const ai = require("./ai");

const DEFAULT_SOURCES = [
  // Official: these are the companies speaking for themselves.
  { id: "apple-newsroom", name: "Apple Newsroom", url: "https://www.apple.com/newsroom/rss-feed.rss", official: "Apple" },
  { id: "apple-dev-releases", name: "Apple Developer — Releases", url: "https://developer.apple.com/news/releases/rss/releases.rss", official: "Apple" },
  { id: "google-android", name: "Google — Android blog", url: "https://blog.google/products/android/rss/", official: "Google" },
  { id: "google-pixel", name: "Google — Pixel blog", url: "https://blog.google/products/pixel/rss/", official: "Google" },
  { id: "android-dev", name: "Android Developers Blog", url: "https://android-developers.googleblog.com/feeds/posts/default", official: "Google" },
  { id: "google-security", name: "Google Security Blog", url: "https://security.googleblog.com/feeds/posts/default", official: "Google" },
  { id: "samsung-us", name: "Samsung Newsroom US", url: "https://news.samsung.com/us/feed", official: "Samsung" },
  { id: "samsung-global", name: "Samsung Global Newsroom", url: "https://news.samsung.com/global/feed", official: "Samsung" },
  { id: "lenovo-motorola", name: "Lenovo StoryHub (Motorola)", url: "https://news.lenovo.com/feed/", official: "Motorola", needs: /motorola|moto\b|razr|smartphone/i },
  // Repair
  { id: "ifixit-guides", name: "iFixit — featured guides", url: "https://www.ifixit.com/Guide/rss/featured", base: "https://www.ifixit.com", repair: true },
  { id: "ifixit-news", name: "iFixit News", url: "https://www.ifixit.com/News/feed", repair: true },
  // Phone news sites
  { id: "9to5mac", name: "9to5Mac", url: "https://9to5mac.com/feed/" },
  { id: "9to5google", name: "9to5Google", url: "https://9to5google.com/feed/" },
  { id: "macrumors", name: "MacRumors", url: "https://feeds.macrumors.com/MacRumors-All" },
  { id: "androidpolice", name: "Android Police", url: "https://www.androidpolice.com/feed/" },
  { id: "androidauthority", name: "Android Authority", url: "https://www.androidauthority.com/feed/" },
  { id: "gsmarena", name: "GSMArena", url: "https://www.gsmarena.com/rss-news-reviews.php3" },
  { id: "sammobile", name: "SamMobile", url: "https://www.sammobile.com/feed/" },
];

const UA = "MYDAY-NewsReader/1.0 (personal business dashboard; reads public RSS feeds hourly)";
const STORE = (dir) => path.join(dir, "news.json");
const USAGE = (dir) => path.join(dir, "news-usage.json");
const KEEP_DAYS = 14;
const MIN_SOURCE_GAP = 25 * 60e3;          // never ask one feed more than ~twice an hour
const MANUAL_GAP = 5 * 60e3;

function sources(dir) {
  try {
    const custom = JSON.parse(fs.readFileSync(path.join(dir, "news-sources.json"), "utf8"));
    if (Array.isArray(custom) && custom.length) return custom.filter((s) => s && s.id && (/^https:\/\//.test(s.url || "") || (process.env.NEWS_ALLOW_HTTP === "1" && /^http:\/\/127\.0\.0\.1/.test(s.url || ""))));
  } catch (e) {}
  return DEFAULT_SOURCES;
}
function read(dir) {
  try { return JSON.parse(fs.readFileSync(STORE(dir), "utf8")); }
  catch (e) { return { groups: [], sources: {}, lastRefresh: 0, lastSuccess: 0 }; }
}
function write(dir, d) {
  const tmp = STORE(dir) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(d));
  fs.renameSync(tmp, STORE(dir));
}

/* ---------- reading a feed ---------- */
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
function decode(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in ENT ? ENT[n.toLowerCase()] : m));
}
const strip = (html) => decode(decode(html)).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tag = (block, names) => {
  for (const n of names) {
    const m = block.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${n}>`, "i"));
    if (m && m[1].trim()) return m[1];
  }
  return "";
};
function parseFeed(xml, src) {
  const out = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks.slice(0, 80)) {
    const title = strip(tag(b, ["title"]));
    let link = strip(tag(b, ["link"]));
    if (!link) {
      const alt = b.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) || b.match(/<link[^>]*href=["']([^"']+)["']/i);
      link = alt ? decode(alt[1]) : "";
    }
    if (link && !/^https?:\/\//i.test(link)) {
      try { link = new URL(link, src.base || src.url).toString(); } catch (e) { link = ""; }
    }
    const when = strip(tag(b, ["pubDate", "published", "updated", "dc:date"]));
    const t = Date.parse(when);
    const text = strip(tag(b, ["description", "summary", "content:encoded", "content"])).slice(0, 700);
    if (!title || !/^https?:\/\//i.test(link)) continue;
    out.push({ title: title.slice(0, 240), link: link.split("?utm_")[0], published: Number.isFinite(t) ? t : null, text });
  }
  return out;
}

async function fetchFeed(src, prev) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const headers = { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5" };
    if (prev && prev.etag) headers["if-none-match"] = prev.etag;
    if (prev && prev.lastModified) headers["if-modified-since"] = prev.lastModified;
    const r = await fetch(src.url, { headers, signal: ctl.signal, redirect: "follow" });
    if (r.status === 304) return { notModified: true };
    if (r.status === 429 || r.status === 403) throw new Error(`the site asked us to stop for now (HTTP ${r.status})`);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const text = await r.text();
    if (text.length > 4e6) throw new Error("feed too large");
    if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(text)) throw new Error("not an RSS or Atom feed");
    return { items: parseFeed(text, src), etag: r.headers.get("etag") || "", lastModified: r.headers.get("last-modified") || "" };
  } catch (e) {
    throw new Error(e && e.name === "AbortError" ? "timed out" : String(e && e.message || e));
  } finally { clearTimeout(timer); }
}

/* ---------- what a story is about ---------- */
const BRANDS = [
  ["Apple", /\b(apple|iphone|ipad|ipados|ios \d+|ios\b|airpods|apple watch)\b/i],
  ["Google", /\b(google pixel|pixel \d|pixel [a-z]|pixel phone|pixel feature drop|\bpixel\b)/i],
  ["Samsung", /\b(samsung|galaxy [szamf]\d*|galaxy (fold|flip|tab|watch|ring|buds)|one ui)\b/i],
  ["Motorola", /\b(motorola|moto [gerx]\d*|moto edge|razr)\b/i],
  ["OnePlus", /\boneplus\b/i],
  ["Xiaomi", /\b(xiaomi|redmi|poco)\b/i],
  ["Nothing", /\bnothing phone\b|\bcmf phone\b/i],
  ["Other", /\b(sony xperia|huawei|honor \d|oppo|vivo|realme|hmd|nokia phone|fairphone|tcl \d|zte|asus rog phone)\b/i],
];
const TOPICS = [
  ["Launches", /\b(launch|launches|launched|announc|unveil|introduc|pre-?order|goes on sale|available (now|today)|release date|event)\b/i],
  ["iOS", /\b(ios|ipados)\s?\d+(\.\d+)*\b|\bios update\b|\bios beta\b/i],
  ["Android", /\bandroid \d+\b|\bandroid (update|beta|release)\b|\bone ui \d|\bfeature drop\b|\bplay system update\b/i],
  ["Security", /\b(security|vulnerab|exploit|zero-?day|cve-\d|patch(es|ed)?|spyware|malware)\b/i],
  ["Repair & parts", /\b(repair|ifixit|teardown|right to repair|self service repair|spare parts|genuine parts|parts pairing|serializ|battery replacement|screen replacement|repairability)\b/i],
  ["Resale & trade-in", /\b(trade-?in|refurbish|resale|used (phone|iphone|smartphone)|second-?hand|buyback|unlock|blacklist|imei|activation lock|certified pre-?owned)\b/i],
  ["Carriers", /\b(verizon|t-?mobile|at&t|carrier|esim|5g network)\b/i],
  ["Business", /\b(tariff|shipments|market share|earnings|revenue|supply chain|regulat|antitrust|lawsuit|\beu\b|european commission|ban(ned)?)\b/i],
];
const PHONE = /\b(phone|smartphone|iphone|pixel|galaxy|android|ios|motorola|razr|oneplus|xiaomi|repair|ifixit|carrier|imei|esim|one ui|foldable)\b/i;
const RUMOR = /\b(rumou?r(ed|s)?|leak(s|ed)?|reportedly|tipped|tipster|allegedly|purported(ly)?|said to|expected to|could (launch|arrive|come|get|feature)|might|may (launch|arrive|come|get)|renders?|concept|analyst|according to (a )?(report|sources?|leaker)|supply chain (report|sources)|claims?)\b/i;

function classify(item, src) {
  const hay = `${item.title} ${item.text}`;
  const brands = BRANDS.filter(([, re]) => re.test(hay)).map(([b]) => b);
  if (src.official && !brands.includes(src.official)) brands.unshift(src.official);
  const topics = TOPICS.filter(([, re]) => re.test(hay)).map(([t]) => t);
  if (src.repair && !topics.includes("Repair & parts")) topics.push("Repair & parts");
  const relevant = src.needs ? src.needs.test(hay) : (src.official || src.repair) ? (PHONE.test(hay) || topics.length > 0) : PHONE.test(hay) && (brands.length > 0 || topics.length > 0);
  const status = src.official ? "official" : RUMOR.test(item.title) || RUMOR.test(item.text.slice(0, 300)) ? "rumor" : "confirmed";
  return { brands: brands.length ? brands : ["Other"], topics: topics.length ? topics : ["General"], relevant, status };
}

/* ---------- grouping the same story ---------- */
const STOP = new Set("a an the and or of to in on for with by at from is are be its it this that new now how why what you your will can get gets got as vs here today all".split(" "));
/* Same meaning, different words: "patches" and "fixes", "out now" and "releases". */
const SAME = [[/^(patch|patches|patched|fix|fixes|fixed)$/, "fix"], [/^(release|releases|released|out|rolls|rolling|available|launches|launched|launch|arrives|lands)$/, "release"],
  [/^(update|updates|updated)$/, "update"], [/^(leak|leaks|leaked|render|renders|rendered|rumor|rumors|rumored|rumour|rumours|rumoured)$/, "leak"], [/^(vulnerabilities|vulnerability|flaws|flaw|bugs|bug|exploits|exploit)$/, "vuln"]];
const norm = (w) => { for (const [re, to] of SAME) if (re.test(w)) return to; if (/^(hands|deals|cases|tests|benchmarks|renders|leaks|reviews|guides|rumors)$/.test(w)) return w.replace(/s$/, ""); return w.length > 4 ? w.replace(/(es|s)$/, "") : w; };
const words = (t) => new Set(String(t).toLowerCase().replace(/(\d)\.(\d)/g, "$1$2").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
  .filter((w) => w.length > 1 && !STOP.has(w)).map(norm));
/* Same story: at least three shared meaningful words, half of the shorter
   headline, something specific (a number or model), and something shared
   beyond the model name itself. A word that changes what kind of story it is
   (beta, review, leak, guide...) must be in both or neither. */
const MODEL = /^(\d+\w*|iphone|ipad|pixel|galaxy|pro|max|ultra|plus|mini|fold|flip|apple|google|samsung|motorola|razr|moto|oneplus|io|ios|android|phone|smartphone)$/;
const KIND = ["beta", "review", "leak", "guide", "teardown", "replacement", "hand", "deal", "case", "test", "benchmark", "concept", "vs"];
function similar(a, b) {
  for (const k of KIND) if (a.has(k) !== b.has(k)) return 0;
  let n = 0, specific = false, beyond = false;
  for (const w of a) if (b.has(w)) { n++; if (/\d/.test(w)) specific = true; if (!MODEL.test(w)) beyond = true; }
  if (n < 3 || !specific || !beyond) return 0;
  return n / Math.min(a.size, b.size);
}
const gid = (link) => "n" + crypto.createHash("sha1").update(link).digest("hex").slice(0, 12);

function regroup(stories) {
  const groups = [];
  const sorted = [...stories].sort((x, y) => (y.published || y.firstSeen) - (x.published || x.firstSeen));
  for (const s of sorted) {
    const w = words(s.title);
    const t = s.published || s.firstSeen;
    const g = groups.find((g) => Math.abs((g.when) - t) < 72 * 3600e3
      && g.brands.some((b) => s.brands.includes(b)) && similar(g.words, w) >= 0.5);
    if (g) {
      g.members.push(s);
      for (const x of w) g.words.add(x);
    } else {
      groups.push({ when: t, words: w, brands: s.brands, members: [s] });
    }
  }
  return groups.map((g) => {
    const m = g.members;
    const lead = m.find((x) => x.status === "official") || m.slice().sort((a, b) => (a.published || a.firstSeen) - (b.published || b.firstSeen))[0];
    const status = m.some((x) => x.status === "official") ? "official" : m.every((x) => x.status === "rumor") ? "rumor" : "confirmed";
    return {
      id: gid(lead.link), title: lead.title, link: lead.link, source: lead.source, sourceId: lead.sourceId,
      published: lead.published, firstSeen: Math.min(...m.map((x) => x.firstSeen)),
      latest: Math.max(...m.map((x) => x.published || x.firstSeen)),
      status, brands: [...new Set(m.flatMap((x) => x.brands))], topics: [...new Set(m.flatMap((x) => x.topics))],
      text: lead.text,
      also: m.filter((x) => x !== lead).map((x) => ({ source: x.source, link: x.link, title: x.title, published: x.published, status: x.status })).slice(0, 8),
    };
  });
}

/* ---------- AI summaries, cached and capped ---------- */
const dayKey = () => new Date().toISOString().slice(0, 10);
function usage(dir) {
  try { const u = JSON.parse(fs.readFileSync(USAGE(dir), "utf8")); return u.day === dayKey() ? u : { day: dayKey(), items: 0 }; }
  catch (e) { return { day: dayKey(), items: 0 }; }
}
const DAILY = () => Math.max(0, Number(process.env.NEWS_AI_ITEMS_PER_DAY || 120));

async function summarise(dir, groups, cache) {
  if (!ai.configured() || process.env.NEWS_AI === "off") return { done: 0, note: process.env.NEWS_AI === "off" ? "AI summaries are switched off" : "AI isn't set up" };
  const u = usage(dir);
  const room = DAILY() - u.items;
  const todo = groups.filter((g) => !cache[g.id]).slice(0, Math.min(40, Math.max(0, room)));
  if (!todo.length) return { done: 0, note: room <= 0 ? `today's limit of ${DAILY()} summaries is used up` : "" };
  let done = 0;
  for (let i = 0; i < todo.length; i += 20) {
    const batch = todo.slice(i, i + 20);
    try {
      const r = await ai.summariseNews(dir, batch.map((g) => ({
        id: g.id, title: g.title, source: g.source, published: g.published ? new Date(g.published).toISOString().slice(0, 10) : "unknown",
        status_hint: g.status, text: g.text.slice(0, 450), also: g.also.map((a) => `${a.source}: ${a.title}`).slice(0, 4),
      })));
      for (const x of r) {
        if (!batch.some((g) => g.id === x.id)) continue;
        cache[x.id] = { summary: x.summary, why: x.why, status: x.status, at: Date.now() };
        done++;
      }
    } catch (e) {
      return { done, note: "AI summaries paused: " + String(e && e.message || e) };
    }
  }
  u.items += done;
  try { fs.writeFileSync(USAGE(dir), JSON.stringify(u)); } catch (e) {}
  return { done, note: "" };
}

/* ---------- a refresh ---------- */
let running = null;
async function refresh(dir, { manual = false } = {}) {
  if (running) return running;
  running = (async () => {
    const d = read(dir);
    if (manual && Date.now() - (d.lastRefresh || 0) < MANUAL_GAP) return { skipped: "refreshed less than 5 minutes ago" };
    const srcs = sources(dir);
    const now = Date.now();
    const stories = new Map((d.stories || []).map((s) => [s.link, s]));
    d.sources = d.sources || {};
    await Promise.all(srcs.map(async (src) => {
      const prev = d.sources[src.id] || {};
      if (prev.at && now - prev.at < MIN_SOURCE_GAP && prev.ok) return;     // be polite
      try {
        const r = await fetchFeed(src, prev);
        const st = { ...prev, name: src.name, url: src.url, at: now, ok: true, error: "" };
        if (!r.notModified) {
          st.etag = r.etag; st.lastModified = r.lastModified; st.items = r.items.length;
          for (const it of r.items) {
            if (it.published && now - it.published > KEEP_DAYS * 864e5) continue;
            const c = classify(it, src);
            if (!c.relevant) continue;
            const old = stories.get(it.link);
            stories.set(it.link, { ...it, ...c, source: src.name, sourceId: src.id, firstSeen: old ? old.firstSeen : now });
          }
        }
        d.sources[src.id] = st;
      } catch (e) {
        d.sources[src.id] = { ...prev, name: src.name, url: src.url, at: now, ok: false, error: String(e.message || e) };
      }
    }));
    // keep two weeks; anything without a date counts from when we first saw it
    const kept = [...stories.values()].filter((s) => now - (s.published || s.firstSeen) < KEEP_DAYS * 864e5);
    d.stories = kept.slice(-1500);
    const groups = regroup(d.stories).sort((a, b) => b.latest - a.latest).slice(0, 200);
    d.cache = d.cache || {};
    const ai_ = await summarise(dir, groups, d.cache);
    const live = new Set(groups.map((g) => g.id));
    for (const k of Object.keys(d.cache)) if (!live.has(k) && now - d.cache[k].at > KEEP_DAYS * 864e5) delete d.cache[k];
    d.groups = groups.map((g) => {
      const c = d.cache[g.id];
      // the AI may call a media story a rumor or confirmed, never "official"
      const status = g.status === "official" ? "official" : c && (c.status === "rumor" || c.status === "confirmed") ? c.status : g.status;
      const { text, ...rest } = g;
      return { ...rest, status, summary: c ? c.summary : "", why: c ? c.why : "", byAI: !!c,
        snippet: c ? "" : text.split(/(?<=[.!?])\s/)[0].split(/\s+/).slice(0, 30).join(" ") };
    });
    d.lastRefresh = now;
    if (Object.values(d.sources).some((s) => s.ok)) d.lastSuccess = now;
    d.aiNote = ai_.note || "";
    write(dir, d);
    return { groups: d.groups.length, summarised: ai_.done };
  })();
  try { return await running; } finally { running = null; }
}

function view(dir) {
  const d = read(dir);
  const srcs = sources(dir);
  return {
    groups: d.groups || [], lastRefresh: d.lastRefresh || 0, lastSuccess: d.lastSuccess || 0, aiNote: d.aiNote || "",
    aiOn: ai.configured() && process.env.NEWS_AI !== "off", usedToday: usage(dir).items, dailyLimit: DAILY(),
    sources: srcs.map((s) => { const st = (d.sources || {})[s.id] || {}; return { name: s.name, url: s.url, official: !!s.official, ok: st.ok, at: st.at || 0, error: st.error || "" }; }),
  };
}

function start(dir) {
  const every = Math.max(30, Number(process.env.NEWS_REFRESH_MINUTES || 60)) * 60e3;
  const tick = () => refresh(dir).catch((e) => console.log("[news] " + (e && e.message || e)));
  setTimeout(tick, 45000);
  const t = setInterval(tick, every); t.unref();
}

module.exports = { refresh, view, start, parseFeed, classify, regroup, DEFAULT_SOURCES, MANUAL_GAP };
