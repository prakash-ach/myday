# MYDAY — progress

Updated at the end of every working session. Read this before changing code.

## Live prototype (`myday-live`, on the droplet)

This is what runs at myday.acharyaandcollc.com today. The Next.js phases
below are the longer-term rebuild and haven't replaced it yet.

**Known gap:** the readable source for `public/app.js` (`myday-live/src/`)
was never committed. Screen changes are made as checked, exact-match edits
to the built bundle until the source is rebuilt.

### 2 October 2026 — one colour, glass panels, a live Automation light
- **App colour** row in Settings recolours everything at once: both
  spaces, the "All" view (which used to stay grey), and every glow, edge,
  grid line and hover ring, which were hard-coded green.
- Panels, sidebar, top bar and the watcher strip are frosted glass over
  the moving colour behind them, in light and dark.
- Automation has a real status light, on its tab and on its page. Green
  and blinking while Gmail is connected and watching, fast while reading,
  red if the last pass failed, grey if Gmail isn't connected. It never
  shows green when nothing is watching.
- Fixed: Settings Dark/Light did nothing if the top-bar switch was on
  System.
- Verified in a headless browser against a local server: login, colour
  switch, dark and light, Automation connected and not. No page errors.

### 2 October 2026 — floating My day, timer and calculator
- **Float** button in the top bar opens a small window with three tabs:
  My day (today's and overdue tasks, tick off, add new), Timer (countdown
  with presets or stopwatch, beeps when done) and Calculator (keyboard
  works, never uses eval, tap answer to copy, last four results kept).
- Chrome and Edge on a computer: a real Picture-in-Picture window that
  stays above every window and app. Safari, iPad, Firefox don't allow
  that, so it becomes a draggable panel that floats over every MYDAY screen.
- Minimise shrinks it to one line showing the next task and the timer.
  Back-arrow returns to My day. The timer keeps running when minimised or
  closed.
- Readable source: `myday-live/public/float.js`. The bundle only hands it
  live state (`window.__myday`) and shows the button.
- Tested in a headless browser in both modes: ticking syncs both ways,
  timer runs, 12×3+4 = 40, minimise and close work, no page errors.

### 5 October 2026 — OpenAI: Gmail to tasks, and an assistant you can talk to
- **Gmail → tasks with AI.** With `OPENAI_API_KEY` in `/etc/myday/secrets.env`,
  the watcher has OpenAI read each new email (and attached PDF text) and draft
  what needs doing: title, date, time, priority, category, 2–5 steps, and a
  comment in the note (what was asked, by whom, amounts, deadline, Gmail link).
  Newsletters and FYI mail get nothing. Drafts land in the Automation inbox and
  only become tasks when approved; approving now keeps the time and steps.
  The invoice reader's payment tasks are kept as-is (exact totals from PDFs).
  If OpenAI fails or the limit is hit, the rule-based tasks stand.
- **Assistant.** Round button on the right edge opens a side panel. Ask about
  your tasks by typing, the mic, or **Talk** (hands-free: listens, answers out
  loud, listens again). It can suggest add / mark done / move / priority as
  buttons; nothing changes until tapped. Locked Personal tasks aren't sent.
- **Settings → Appearance:** Assistant name (default Max) and icon.
- Server: `lib/ai.js`, routes `/api/ai/status` and `/api/ai/chat`. Key never
  reaches the browser. `OPENAI_MODEL` (default gpt-5.4-mini),
  `AI_DAILY_LIMIT` (default 400 calls/person/day), `OPENAI_BASE_URL` optional.
- Screen code: `public/assistant.js` (readable). Bundle edits: Settings rows,
  approval keeps time and steps.
- Tested against a pretend OpenAI: email → task with comment, steps and time;
  newsletter dropped; OpenAI down falls back to rules; chat actions applied;
  invented task ids dropped; bad key and no key show clear messages.

### 5 October 2026 — who gets AI, per person
- Settings → Team now has two switches per person: **AI assistant** and
  **AI reads their Gmail**. Off for everyone except the owner until switched
  on. Enforced on the server: the chat route refuses, and the watcher skips
  the AI pass, for anyone without the switch. Their assistant button hides.
- Implemented as two extra entries (`ai-chat`, `ai-mail`) in the server's
  section list, so they use the existing Team storage in `team.json`.

### 5 October 2026 — the assistant can see the Automation inbox
- First live run worked (gpt-6-luna answered "What's on today?" from real tasks).
- The assistant now also gets the Automation inbox (waiting emails, sender,
  AI summary, proposed tasks, amounts) for anyone allowed to see Automation.
  It can summarise it and offer "Add from email" / "Ignore email" buttons,
  which do exactly what the Automation screen's buttons do.

### 5 October 2026 — invoices from any supplier, read by AI, logged to Auctions
- Why real mail looked wrong: the watcher only reads NEW mail, so everything
  from before AI was switched on had only been seen by the old rules; and only
  ONM (PDF) and Rexi (xlsx) invoices were ever turned into lines. Approving an
  email never saved lines to Auctions at all.
- `lib/ai.js readInvoice`: any other invoice — text PDF, scanned PDF (pages
  sent as pictures via pdftoppm), photo, CSV, spreadsheet — becomes lines in
  the same shape as the built-in readers (make, model, size, grade, carrier,
  qty, unit price, line total), with fees separate. Each line is checked
  (qty × price vs line total, all lines + fees vs invoice total) and gets a
  confidence and plain-English issues.
- `lib/watcher.js` restructured around `readOne()`, shared by the regular
  check, **Read again** (`/api/automation/reread`) and **Look back N days**
  (`/api/automation/lookback`, picks up mail the old rules passed over).
  Re-reading keeps decisions and logged marks.
- `public/invoice.js`: when an invoice with lines turns up, a card asks
  "Invoice found — log it to Auctions?". Review opens an editable table
  (supplier, date, invoice no., auction/lot, status; per line make, model,
  size, grade, qty, price), flags lines to check, shows whether it adds up,
  then logs ticked lines as Auction entries and adds new suppliers, grades,
  models and sizes to the catalog. `/api/automation/logged` remembers it so
  it isn't logged twice.
- Automation screen: per email **Review invoice** / **Logged ✓** and
  **Read again**; at the bottom **Read waiting again with AI** and
  **Look back 7 days**. Max sees invoices too and can open the review.
- Tested with a pretend Gmail (scanned PDF, CSV, older email) and a pretend
  OpenAI: scan read from page images, CSV from text, makes and sizes
  normalised, totals check, flagged line fixed, 3 entries logged with notes,
  catalog updated, marked logged, look-back found the older email.

### 5 October 2026 — automatic tasks and auto-ignore (owner-authorised)
Prakash authorised MYDAY to create review tasks and mark messages Ignored
inside MYDAY without approval, for five rules. Not authorised, and not done:
sending mail, bidding, paying, deleting or changing anything in Gmail.
- `lib/rules.js`: the AI now also classifies each email (bid file / supplier
  invoice / order / promotion / other, with confidence, deadline, amount,
  refs). Plain code then applies the rules:
  1. auction bid file → task today (sender, auction, bid deadline, links);
  2. outside supplier invoice → stays in Review + "Review invoice from X"
     task (number, amount, due date, attachment link); never marked
     reviewed or paid;
  3. review senders (Saad Javed) matched ONLY by configured address →
     stays in Review + review task;
  4. actionable outside order → review task; own-company mail (company
     domains, incl. MobileSentrix) and non-actionable confirmations skipped;
  5. promotion ≥85% sure by content → Ignored; less sure → left in Review.
  Own-company mail never triggers 1, 2, 4 or 5. Without AI only rule 3 and
  invoices the built-in readers recognise can fire; nothing is auto-ignored.
- Tasks: dated "today" in the configured timezone (from the browser the first
  time, editable); real deadline kept in `deadline`/`deadlineTime` and the
  note; note has summary, details, Gmail link, attachment link
  (`/api/automation/attachment/<mail>/<n>`), and why.
- `lib/outbox.js`: fixed ids from rule + email or attachment hash, never
  recreated (even after deletion). Open tabs collect them (`rules.js`); with
  no tab open the server writes them into saved MYDAY; a save from a stale
  tab gets unseen ones put back (`/api/state` PUT).
- Every action is logged with its reason (feed.autoLog). Auto rules panel
  (Automation → ⚙ Auto rules): switches, review senders, company domains,
  promo hints, timezone, log, "Put back in Review" for auto-ignored mail.
  Each email in Automation shows what was done automatically and why.
- Everything else still waits for approval as before.
- Tested: unit cases for every rule and edge (other "Saad" address, SICKW
  receipt, unsure promo, no AI, forwarded duplicate attachment, stale save);
  end to end with no tab open (server wrote 5 tasks), tab collection,
  rescans (still 5), log and undo.

### 5 October 2026 — read-only guarantee, dashboard quote, Phone Industry News
- **Gmail stays read-only.** Audited: OAuth scope is `gmail.readonly`, every
  Gmail call is a GET. Added a hard guard in `lib/google.js` that refuses any
  Gmail path except reading profile, labels, message lists, one message
  (`?format=full`) and attachments; tested 5 read paths allowed and 8 change
  paths (send, modify, trash, batchModify, batchDelete, import, drafts,
  filters) refused. "Ignored" is only a MYDAY status.
- **Email content is data.** Every AI prompt (email reading, invoices, news,
  assistant) says outside content is data and can't change rules or output;
  emails are wrapped in <email> tags. Final decisions stay in plain code in
  `rules.js`. New safeguard: a promotion-looking message that carries a
  document (PDF/xlsx/csv) is never auto-ignored; it stays in Review.
- Rule wording: bid tasks are "Review bid file: …" with the file named;
  every automatic task note starts with "Summary:" (AI summary or snippet).
- **Dashboard quote** (`lib/quotes.js`, `public/quote.js`): one short
  original line per person per local day, theme rotates daily (progress,
  discipline, business, learning, balance, focus, resilience, craft). Cached
  per day; "New quote" up to QUOTE_REFRESHES_PER_DAY (5). Labelled
  "AI-generated", never attributed. Without AI: MYDAY's own lines, labelled
  as such. Uses the "AI assistant" permission.
- **Phone Industry News** tab (`lib/news.js`, `public/news.js`, Team section
  "news", owner on by default): public RSS/Atom feeds — Apple Newsroom and
  developer releases, Google Android/Pixel/Security/Android Developers blogs,
  Samsung US and global newsrooms, Lenovo (Motorola), iFixit guides and news,
  9to5Mac, 9to5Google, MacRumors, Android Police, Android Authority,
  GSMArena, SamMobile. Override with `<data>/news-sources.json`.
  Polite: feeds only (no article scraping), ETag/If-Modified-Since, ≤ ~2
  requests/hour per source, identifying user agent. Keeps 14 days; real
  publication dates shown; last refresh shown; banner if sources unreachable
  for 3h+. Brand and topic tags, Official / Confirmed report / Rumor (official
  only from company sources; leak/"reportedly"/analyst wording → rumor).
  Duplicate coverage grouped (8 tricky headline pairs tested, incl. leak vs
  confirmation kept apart). AI summary in its own words + "why it may matter",
  cached per story; NEWS_AI_ITEMS_PER_DAY (120), NEWS_AI=off to disable,
  NEWS_REFRESH_MINUTES (60), NEWS_OFF=1 to stop the timer. Without AI, the
  feed's own first sentence (≤30 words) is shown, credited.
- Tested with pretend feeds (official, media, iFixit relative links, a broken
  source, a 30-day-old and an off-topic story) and pretend AI: grouping,
  filters, rumor/confirmed, source health, links open the original, staff
  without the section get no tab and a 403.

### 6 October 2026 — your suppliers and grades, Captured Invoices, Past days
- **Supplier matching** (`public/invoice.js`): invoices are matched to the
  suppliers in Auctions → Setup by, in order: a match confirmed before
  (invoice supplier name or sender domain, saved in prefs.invoiceMap); the
  part after "Via" (ONM, MNVP, B-Stock) found in sender/invoice/file name;
  aliases (Mannapov → MNVP); the full name. Tested: B-Stock → ATT Via
  B-Stock, Mannapov → Verizon Via MNVP, ONM → T-Mobile Via ONM.
- **Grade conversion** to that supplier's grades: confirmed before → exact
  → same grade written differently ("Grade A+", "B plus") → the supplier's
  shared prefix ("A" → DNA, "A" → T-Mobile A) → Sealed/New/CPO synonyms.
  Anything else is left blank with a dropdown of that supplier's grades and
  must be picked before adding. Choices are remembered per supplier.
- **New supplier**: if no match, a box suggests adding it (grades from the
  invoice) or picking an existing one; nothing is added to Setup without a tap.
- **Captured Invoices** menu (`public/captured.js`, Team section
  "captured"): every invoice MYDAY has read lines from, including in emails
  already approved/ignored — From, email/invoice date, invoice no.,
  supplier (or "New supplier"), total qty, total amount, status (To review /
  Added / Not added), View invoice. Blinking red/yellow light and count on
  the menu while any wait. "Not added" is stored on the server
  (`/api/automation/invoice-status`), with "Put back to review".
  View invoice → everything filled in → "Add N lines to Auction table".
- Bid sheets are never treated as invoices when the email is classified as
  an auction bid file.
- **Past days** (`public/past.js`): button next to "Pick a date" on My day.
  One date or a range (Yesterday / Last 7 / Last 30 quick picks): tasks
  ticked each day (incl. repeating) and one-off tasks due that day and still
  not done, with "Move to today". Follows the current space.
- Test note: the test runner's cleanup didn't match the way the test server
  starts, so one run hit an old server; fixed and every result above is from
  a clean run.

### 6 October 2026 — one row per invoice number; Captured Invoices since last Friday
- **No duplicates**: Captured Invoices groups by invoice number (numbers
  under 4 characters are grouped per sender). One row, "received N× — shown
  once", showing the supplier's own copy rather than a colleague's forward.
  If any copy was added, the invoice is Added; "Don't add" applies to every
  copy; opening another copy of an added invoice warns it's already in the
  Auction table (and from which copy).
- **Start date**: `rules.capturedSince` — set automatically the first time to
  the Friday before (Fri 2 Oct 2026), changeable with the date box on the
  screen (up to 3 months back). Older invoices aren't shown.
- **Backfill**: on first open, and when the date changes or "Fetch again
  since …" is pressed, the server fetches every email with an attachment
  since that date in the background (Gmail `after:` + `has:attachment`, up
  to 150, paged; read-only), reading invoices with AI. It does not create
  automatic tasks for those older emails. The screen shows "Fetching…" and
  updates itself.
- `google.listMessages` now pages through results (up to 200).
- Tested: inbox with the same invoice original + forwarded, a Sep 25 invoice,
  and this week's invoices — start date set to Oct 2, old one excluded, one
  row per number, 4 entries (not 8), warnings and Don't add across copies.

### 6 October 2026 — grades read from the printed invoice line
- Real MNVP invoices write the grade inside the description ("APPLE IPHONE
  13 256 MIDNIGHT — DNC MLAH3LL/A") and the AI left the grade empty, so
  lines needed picking (one was picked wrong: DNB instead of DNC).
- `invoice.js gradeInLine()`: scans each printed line for the matched
  supplier's grades. Codes of 3+ characters (DNB, AA+, T-Mobile A) as their
  own word; 1–2 character grades (A, B+, C) only right after "grade"/"cond";
  never glued to "/" (Apple part numbers end "LL/A"). Exactly one grade found
  → used, and it overrides a different AI grade; two different → asks.
- AI invoice prompt now says grades are often short codes inside the
  description and gives the MNVP example.
- Tested on the five real lines from the screenshot plus six tricky cases.
- Already-added invoices aren't changed; an entry added with a wrong grade is
  fixed in the Auction table.

### 6 October 2026 — type any grade by hand
- Invoice review grade dropdown ends with "✎ Type a grade…": turns the box
  into a text field (↩ goes back to the list). Typed grades survive changing
  the supplier. A grade not on the supplier's list is marked "new grade for
  …", and a tick box (on by default) adds the new grade(s) to that supplier
  in Setup when the lines are added. What was typed is remembered for that
  supplier's invoice wording, like a picked grade.
- Tested: typed "DN Premium" on a Mannapov line, switched supplier and back,
  added — entry has "DN Premium", Setup has it after DNE.

### 6 October 2026 — model names without colours, matched to Setup
- Problem: the AI invoice reader put colours in model names ("iPhone 11
  Red", "iPhone 13 Pro Alpine Green"), and logging added those as new Setup
  models. It never saw the user's model list.
- AI: `aiOptsFor` now passes each make's Setup models; the invoice prompt
  says model only (no colour/storage/carrier/part number), with an example,
  and to use Setup's exact spelling.
- `public/models.js clean()`: removes part numbers, storage, carrier and —
  from the end — colours (Apple names like Alpine Green, Sierra Blue,
  Midnight, Black Titanium; Samsung/Google/common ones), then matches Setup's
  spelling (exact, or the longest Setup model followed only by colour).
  Colour goes into the entry's notes. Used in the invoice review ("✓ colour
  … moved to notes · matches … in Setup"). 14 formats tested.
- Cleanup: Captured Invoices shows "🧹 Tidy model names (N)" when entries
  have a colour in the model; preview of every change, then renames entries
  (colour → notes) and merges colour-named Setup models into the clean one
  (sizes merged). Prices, grades, quantities untouched.

### 6 October 2026 — safe saving across devices, invoice integrity, trends, health
- **Two devices no longer overwrite each other** (`lib/merge.js`, server
  `/api/state`, `public/sync.js`, bundle patch 14). Every save carries the
  version it started from (`baseRev`); the server keeps recent versions in
  memory and, if another device saved in between, does a three-way merge:
  id lists (tasks, entries, notes, ...) item by item, objects key by key,
  edits on both sides field by field (incoming wins on the same field);
  deletions stick only if the other side didn't edit the item; no base known
  (after a restart) → nothing dropped. The tab adopts the merged result only
  if nothing newer was typed meanwhile. Tabs check `/api/state-rev` every 15 s
  and on focus. Tested with two simultaneous browsers (adds, a pref change,
  a delete while the other added).
- **Undo add** on Captured Invoices removes exactly that invoice's lines and
  returns it to review (all copies). **Duplicate check** against the Auction
  table: warns when entries already mention the invoice number.
- **Landed cost**: invoice fees go into each entry — shipping/other per
  phone (shipEach), buyer premium % and tax % — only when the invoice adds up
  (fee list complete); shown in the review as "Landed cost: …".
- **Price trends** (`public/trends.js`, "📈 Trends & download" on Auctions):
  filters (make, model, size, grade, supplier, status, period, week/month,
  price or landed), cards (units, spend, qty-weighted average, last 30 vs
  previous 30 days, cheapest supplier), SVG chart with low–high band or one
  line per supplier, monthly table, biggest moves across all models;
  downloads (CSV, opens in Excel): trend table, price grid by month, entries.
- **Health** (`/api/health/status`, `public/health.js`): Gmail, OpenAI (last
  error kept in `ai.lastProblem`), news sources, nightly backup, last save.
  The Automation menu light is now overall health (green / amber / red,
  problems in the tooltip, click for the panel); 🩺 Health button.
- Automatic tasks only for mail dated yesterday or today (local), on every
  path (regular check, backfill, look back, read again); older mail is still
  read and listed with the reason no task was made. Promotions are ignored
  at any date. Found because the since-Friday backfill could otherwise take
  today's mail without making its tasks.
- Not done yet: real invoice samples as tests (need copies from Prakash),
  tidying the email/invoice screens into one place, rebuilding the screen
  source (`src/`), outside price sources (eBay Browse API proposed; no
  stealth scraping of Amazon/Swappa/Back Market).

### 6 October 2026 — new mail only; never MobileSentrix's own invoices; new suppliers mapped to Setup
- Prakash logs past invoices by hand. Captured Invoices now starts from the
  day it's first opened (local date); the automatic since-Friday backfill and
  the "Fetch again" button are gone (the date can still be changed to filter).
- **Strict rule**: an invoice counts only if the seller is someone other than
  his own company (MobileSentrix, Apt-Ability — the Automation settings' own
  names and domains). Dropped when the seller name is his company (even via
  QuickBooks etc.), or when sent from his own domain with no other seller
  visible. A colleague forwarding another seller's invoice still counts.
  Enforced in the watcher (rows removed, reason recorded), in the Captured
  list, and in the invoice rule (no auto task; also checks the AI's
  counterparty).
- **New suppliers mapped to Setup**: sizes matched to the model's Setup sizes
  ("256" → 256GB, "1 TB" → 1TB); grades cleaned before becoming the new
  supplier's scale ("GRADE A" → A, "Grade B+" → B+); suggested name in the
  Setup pattern "Carrier Via Seller" (e.g. "Verizon Via Prime Phones") when
  60%+ of units share a carrier; models cleaned as before.
- Tested: MobileSentrix invoice from own domain and via QuickBooks dropped,
  Ali's forward of a B-Stock invoice kept; Prime Phones invoice → supplier
  "Verizon Via Prime Phones" [A, B+], sizes/models/colours mapped.

### 7 October 2026 — a calmer Automation screen (GLOBAL RULE: never destroy or edit existing data)
- Prakash's rule, applied everywhere from now on: existing data is never
  destroyed or edited by MYDAY on its own. Only his taps change things.
- **New Automation inbox** (`lib/inbox.js` read-only view builder,
  `/api/automation/inbox`, `public/inbox.js`): one compact row per
  conversation or invoice number (replies grouped, outside sender shown), in
  tabs Needs you · Added automatically · Handled quietly · Owed. Quiet reasons
  are computed at display time (verification/sign-in codes, login alerts,
  shipping/delivery notices, promotions, "PAID" confirmations, own-company
  automatic notices, automatic messages, nothing to do) — stored mail isn't
  touched. "Put back" stores a new `feed.viewOverrides` note only.
- **Held-back suggestions**: "Pay" suggestions on PAID emails, promotions,
  quiet mail, or mail the AI didn't read as a bill are shown greyed with the
  reason and only added if ticked. Owed counts each unpaid invoice once.
- Actions: Add (ticked suggestions, once per conversation; marks all its
  emails approved), Done (auto-added), Ignore (inside MYDAY only), bulk
  select, Read again, Check now (`/api/automation/check-now`, saved
  settings). The old screen remains as "Classic view" (route
  `automation-classic`) for Gmail connect and settings.
- **New mail only**: the old rules' "Pay" suggestion is kept only when the AI
  reads the email as a bill or actionable order; never on "PAID" subjects.
- Tested on a copy of the real inbox (16 emails incl. PAID Mannapov, Dell and
  Surface promos, codes, shipping, offline messages, a 3-email invoice
  thread): 3 rows need him, 8 quiet with reasons, 1 auto; Owed $44,337 (was
  inflated to millions); stored emails byte-identical after viewing and after
  Put back.

### 7 October 2026 — Start from now, Select all, Clear all
- **Start from now** (`rules.inboxSince`, `/api/automation/inbox-since`): the
  Automation inbox shows only mail first seen from that moment AND dated that
  day or later; older mail is tucked away from the view (count shown), never
  changed or deleted. Also sets Captured Invoices to start today. "Show
  everything" undoes it. No look-back.
- **Select all** box above the list; **Clear all N** for the current tab
  (asks first): Needs you / Handled quietly → marked ignored inside MYDAY,
  Added automatically → marked done. Status change by his tap only; nothing
  deleted; Gmail untouched.
- Tested: 16 old emails tucked (stored data byte-identical), 2 new emails
  shown, Select all + Clear all marked them ignored (still stored), Show
  everything restored the older view; older mail first read after the start
  stayed hidden.

### 8 October 2026 — identical lines combined; Auctions compact view and select by date
- Netra-style invoices list every unit on its own line. The invoice review now
  combines lines with the same make, model, size, grade, carrier and price
  into one line with the summed quantity ("Combine identical lines (24 → 4)",
  on by default, untick to see them separately). New logging only.
- **Auctions → ▤ Compact view** (`public/compact.js`): the Auction table with
  identical entries (date, supplier, make, model, size, grade, price, fees,
  status) shown as one row with summed qty and "× N lines" — display only.
  Date filters (All, Today, Yesterday, Last 7 days, From–To), supplier,
  search, Select all. Actions only on tap + confirm: set status, download
  CSV, "Combine into one line each" (keeps the first entry with the summed
  qty and merged notes, removes the repeats), delete.
- Tested: 24-line Netra invoice → 4 entries (9×$132, 1×$145, 13×AB, 1×B);
  14 existing lines → 4 rows, combine kept all 34 units and kept different
  prices/grades apart.

### 8 October 2026 — AI core, part 1: shared memory and learning from corrections
- `lib/memory.js` (own file `memory-<user>.json`; never touches tasks, mail,
  invoices or auctions):
  - **facts** read live from MYDAY (suppliers + grades, makes/models,
    categories, review senders, company domains, timezone);
  - **notes** "Things to know", written by Prakash;
  - **lessons** learned from corrections, de-duplicated with a count:
    inbox (Ignore / Add / Put back — recorded server-side in decide and
    view-override), suggestion (added vs skipped, from the new inbox's Add),
    invoice (supplier picked/added, grade picked/typed, model or size edited —
    sent from the invoice review).
- **Used**: the inbox applies lessons first (2+ ignores of the same sender +
  subject pattern and none kept → Handled quietly "you've ignored 2 like this
  from …"; any kept/put back → always shown). `promptBlock()` gives the email
  reader and invoice reader his notes plus the ~10 most relevant lessons
  (same sender/pattern/supplier, recent, repeated), labelled as coming from
  him, not the email; Max gets the notes.
- **🧠 AI memory** panel (`public/memory.js`; Automation → 🧠 Memory, and
  Settings → AI memory): facts, editable notes, lessons in plain English by
  type with Forget / Forget all. Routes `/api/memory`, `/learn`, `/notes`,
  `/forget`.
- Tested: ignore 2 "Weekly specials" → the next 3 quiet with that reason; put
  one back → all shown again and kept separately as a lesson; the AI prompt
  for the next email from that vendor contained the lesson; invoice grade and
  model fixes recorded; notes saved; forget works.
- Next for the AI core: Max as the one brain across all features (data +
  actions registered per feature), proactive suggestions, model routing,
  accuracy page from real invoices and corrections.

### 8 October 2026 — Apple Trade-In section
- New sidebar section **Apple Trade-In** (Team section "tradein";
  `lib/tradein.js`, `public/tradein.js`, `/api/tradein`, `/check`, `/paste`).
- Reads Apple's public US trade-in page (apple.com/shop/trade-in) at most once
  a day (timer looks every 3 h; manual "Check Apple now" limited to once per
  10 min). Polite: checks Apple's robots.txt first and doesn't read the page
  if it's disallowed; identifying user agent; never logs in or submits.
- Fallback / alternative: "Paste from Apple" — paste Apple's page or a
  9to5Mac / MacRumors list; the reader picks out "Model … Up to $N" and
  "Model: $N" (section headings glued to model names are stripped).
- Snapshots kept when values change (last 60): change ▲/▼ with date, and a
  per-model history. Tabs iPhone / iPad / Mac / Apple Watch / Android.
- Next to Apple's value: his 30-day average buy price for the model from the
  Auction table (qty-weighted, all grades/sizes, excluding lost) and the gap.
- Tested against a pretend Apple site: robots block → not read, clear
  message; paste → 5 values; allowed → 8 values; later change → ▲$25 / ▼$20
  with history; Android tab; buy-price comparison. The real page's layout
  couldn't be checked from the build sandbox — first live check will tell;
  paste always works.
- TRADEIN_OFF=1 stops the timer; TRADEIN_PAGE / TRADEIN_ROBOTS override the
  URLs (testing only).

### 8 October 2026 — type a model, see Apple's trade-in value
- Typing in MYDAY's top search bar ("iphone 13", "15 pro", "galaxy s24")
  drops a card under it with matching Apple Trade-In models, Apple's "up to"
  value, the latest change, and his 30-day average buy price; clicking one
  opens Apple Trade-In with that search. Only shows for device-like text
  (nothing for "call ramesh"); uses a 30-minute cache; hidden for people
  without the section.
- The Apple Trade-In page has its own search box (filters across all tabs).
- Max gets the current trade-in values (if he has the section), labelled as
  Apple's best-condition offers.
- Tested: "iphone 13" → iPhone 13 $250 · you paid $217, iPhone 13 Pro $330;
  click → page filtered; "galaxy" → S24 Ultra; unrelated text → no card; the
  chat prompt contained the values.

### 9 October 2026 — ✨ extras: Snap & know, briefing, bid board, price watch, Ask my history, widget
All open from a new ✨ button in the top bar (`public/cool.js`).
- **📷 Snap & know**: camera/photo → `/api/snap` (AI vision, `ai.snap`) reads
  make, model, storage, colour, IMEI; model cleaned with models.js; shows
  Apple trade-in (matched by cleaned name), his 30-day avg buy, units in the
  Auction table, open tasks; Watch / Open in Trade-In / Copy IMEI. Photos are
  shrunk to 1400 px JPEG in the browser first. Needs the AI assistant switch.
- **🎧 Morning briefing**: `/api/briefing` writes ~1 minute of speech from his
  day (tasks/overdue from Max's context, inbox Needs you, Owed, recent
  trade-in changes); cached per local day, "Make a new one"; played with the
  device's own voice (keep the screen on).
- **⏱ Bid board**: full-screen countdowns for today/tomorrow — tasks with a
  deadline (bid-file tasks) or bid/auction/lot tasks with a time; green →
  amber (<2 h) → red pulsing (<30 min) → closed; quick price check (Apple
  trade-in + his avg). Ticks every second.
- **👁 Price watch**: prefs.watch (his own list; add from the panel, Snap,
  Apple Trade-In rows, or Max's "watch" action). Alerts: Apple trade-in value
  changed since watching/acknowledged; his buy price this week ±5% vs the
  previous month; invoice lines this week ±10% vs his usual. Daily toast nudge.
- **Ask my history**: Max's context now carries the Auction table summarised
  by month × supplier × model × size × grade × status (last 12 months, ≤600
  rows), with its own space separate from tasks; Max told to answer from it.
- **📱 Widget**: `/api/widget/token` makes a revocable random link (only a
  hash is stored); `/api/widget?t=` returns a read-only summary (next task,
  today's count, bids closing, invoices waiting). Scriptable script provided
  to copy. Switching off → 401.
- Tested all six end to end (incl. no-sign-in widget call and revocation).

### 9 October 2026 — fix: "OpenAI's answer wasn't readable" (briefing)
- Cause: newer models (gpt-6-luna) spend part of max_completion_tokens on
  thinking; the briefing's 700-token budget ran out before any text, so the
  reply was empty/cut off and failed to parse. Other small budgets (quote
  200, snap 400) were at the same risk.
- `ai.call` now gives every request at least 2,000 tokens; if the answer is
  empty or finish_reason is "length" (and not valid JSON), it retries once
  with double (max 16,000). Errors now say "empty answer" / "cut off" /
  "not in the expected format". The briefing accepts plain text
  (`textOk`) and has 2,500 tokens.
- Tested with a pretend OpenAI that returns an empty cut-off answer at 2,500
  and plain text at 5,000: briefing shown; quote unaffected.

### 12 October 2026 — Repair Devices module
New sidebar item **Repair Devices** (Team section "repair"; owner sees it, nobody
else's access changed). Six tabs: Overview, Device Explorer, SKU Priorities,
Repair Workflow, Costs & Margins, Files & Data Quality. Not deployed by Claude.
- `lib/repair.js` — RFC 4180 CSV (quotes, "" escapes, multiline, BOM, CRLF);
  roles from headers + values (repair = IMEI/SKU/Bin Location/Reason; sales =
  every product row Monthly sale > 0; inventory = every product row first
  Inventory > 0; both → ambiguous, user chooses) — never from filenames.
  Validation (duplicate IDs, duplicate/blank catalog SKUs, missing roles,
  field-count mismatches, footers). Batches stored under data/repair/batches/
  with originals byte-for-byte, SHA-256, rows, findings; a failed batch never
  replaces the active one; repeat imports are recognised and never add.
  Exact-SKU joins; IDs/SKUs as text; missing ≠ 0; Stock Summary parsed per
  warehouse with both numbers; availability = configurable warehouse/number
  (provisional: first Inventory number); completeness setting. Workflow rules
  exactly as specified (presold first; Bin-N001 month; Cleaning→Arika;
  technician bins/assignees; board-level; blacklisted; testers; Bibek bins with
  With Bibek only on a recorded handoff; unknown assignees → Assignment review;
  invalid Bin- patterns → Bin review; bin/assignee conflicts kept and shown).
  Demand: daily, coverage, target, shortage, Red/Amber/Green/Gray/Purple, Blue
  for presold; eligibility evidence separate; candidates and provisional limit.
  Finances: matched populations, weighted margin, no substitution for missing
  Total Cost. Handoff overrides in overrides.json with who/when.
- `lib/xlsxw.js` — dependency-free .xlsx writer (fills, frozen panes,
  autofilter, widths, money/percent formats, inline-string identifiers).
- `lib/repairExport.js` — 7-sheet workbook of the current filters: Overview,
  SKU priorities, Devices, Costs by workflow/owner/SKU, Rules & sources
  (assumptions, formulas, files + hashes, footers, review findings).
- `public/repair.js` — the screen: shared filters with chips + Clear, clickable
  cards/bars, sortable paginated tables, device and SKU drawers with complete
  original records (file + line), three-file upload with role choice,
  evidence, validation and preview, settings, batch history, Excel button.
- Regression on the supplied snapshot: all 20 checks pass (8,661 devices/IDs,
  1,076 repair SKUs, 1,236 sales + 665 inventory products, 1 footer each,
  1,991 SKUs, 13,042 row monthly vs footer 2,368 shown, 20,947 Inventory
  units, 535/261/62/226/63/81/6/2/78/7,347 workflow, 3,087 missing Total Cost,
  279 missing Reason). 27 edge-case tests pass. Browser test with the real
  files end to end; export verified with openpyxl and LibreOffice.
- Open business definitions: meaning of the Inventory pair numbers; real sales
  window; whether exports are complete; Maniraj Guragain's role (78 devices);
  "Repair To Repair" treated as a technician bin as listed; 3 bin/assignee
  disagreements (Nazar Mohammad Rahem, Rashed Naimee) left visible, no alias.

### 12 October 2026 — fix: Repair upload "Couldn't reach the server"
- Cause: nginx in front of MYDAY has the default 1 MB client_max_body_size;
  the three CSVs (4.3 MB, ~5.7 MB as base64 JSON) were refused with 413 before
  reaching MYDAY, and the screen reported it as a connection failure. The
  local tests had no nginx in front.
- Uploads are now gzipped in the browser (CompressionStream) and unzipped on
  the server (`enc: "gzip"`, 300 MB cap): 5.75 MB → 0.46 MB; stored originals
  are byte-identical (checked by SHA-256).
- setup.sh: new nginx sites get `client_max_body_size 60m`; existing MYDAY
  sites get it added once (after each server_name, incl. certbot blocks),
  with a timestamped backup and automatic rollback if `nginx -t` fails.
- The Repair screen now reads non-JSON answers and says what happened (413
  upload limit, 502/504 MYDAY restarting, other HTTP status).
- Tested through a stand-in for nginx's 1 MB limit: compressed upload works;
  uncompressed shows the upload-limit message.

### 12 October 2026 — Repair: priority cards with quantities; Repair To Repair = Waiting for repair
- Prakash: "Repair To Repair" is not repair in progress. It's now its own
  status **Waiting for repair** ("Queued for repair — not started; assign to a
  technician", owner "Repair queue"), removed from the technician list, and
  counted as an assessment/assignment candidate with Not mapped. Snapshot:
  Repair in Progress 261 → **168**, Waiting for repair **93** (all other
  workflow counts unchanged). Technician/Bibek/queue lists always come from the
  code, so an older saved settings file can't bring the old list back.
- Overview: six larger priority cards (devices, SKUs, reported cost), click to
  filter. Every chart and the workflow queues now count with all filters
  except their own, so every bar/card always shows its real quantity (before,
  choosing Amber zeroed the others). "Unassigned highest-priority" uses a
  candidates filter (Not mapped + Waiting for repair, no eligibility flags).

### 15 October 2026 — Scan Boxes
New sidebar item **Scan Boxes** (Team section "scanbox"; `lib/scanbox.js`,
`public/scanbox.js`, `ai.scanBoxes`).
- Photo (camera or files, several at once) of one box or a stack → AI reads
  each box: brand, model, colour, RAM, storage, IMEI 1/2, serial, product
  model, EID; told to leave unclear digits empty rather than guess.
- IMEIs checked with the Luhn check digit (✓ / ⚠ fails / — missing). Where the
  browser has BarcodeDetector (Chrome/Android; not Safari/iPad), barcode values
  confirm exact matches and correct 1–2-digit misreads; never invents matches.
- Review before saving: editable rows with live checks, photo thumbnails,
  already-scanned warnings (unticked by default, "save anyway").
- One shared table on the server (data/scanbox/rows.json + photos): each row
  has who and when. People see their own rows; the owner sees everyone's, with
  a "Scanned by" filter. Others can't open the owner's photos or edit his rows.
  Edits logged (field, from, to, who, when); Remove only hides. Filters: date,
  person, search, needs-checking. Formatted Excel export (IMEIs as text, check
  status coloured, edits listed).
- Tested with Prakash's stack photo (6 boxes) against a pretend AI: a
  mistyped IMEI flagged and fixed, an unreadable box left blank, a second user's
  rescan caught as duplicates, owner sees both users, edit log, hide, export.

### 15 October 2026 — Scan Boxes: rapid mode for big batches (3,500 devices)
- **⚡ Rapid mode** (default on): shoot continuously; photos queue and are read
  4 at a time in the background; rows save straight into the table (live).
- **On-phone photo check before upload** (no upload if it fails): long side
  < 1000 px, mean brightness < 45 / > 238, Laplacian variance < 40 (blur) →
  "take it again" with the reason; "Use this one anyway" available.
- **AI can't read it** → photo deleted, retake asked within seconds.
- **Duplicates never recorded**: skipped against the table and within the same
  batch; if a close-up later shows a just-created row is a duplicate (no other
  identifier, unedited, < 10 min old) the row is removed and its photo dropped
  when no rows remain; photos with only duplicates aren't kept.
- **Close-up re-read**: the AI returns each box's position; for boxes with a
  missing/failed IMEI or missing serial, the phone crops that box from the
  full-size photo and `/api/scanbox/reread` (ai.readOneBox) fills in only
  numbers that pass the IMEI check digit; logged as an "AI close-up re-read"
  edit.
- Scanning has its own daily AI allowance (SCAN_DAILY_LIMIT, default 5,000),
  separate from the 400 general limit; `ai.call` accepts a per-job limit.
- Tested: blurry/dark/small rejected on the phone with zero uploads; 6 boxes
  saved in 3.5 s with 2 IMEIs fixed by close-up; 7 more photos of the same
  stack in parallel (5.5 s vs ~10.5 s serial) → 42 duplicates skipped, still 6
  rows and 1 photo; unreadable photo → retake, not kept.
- Expected real throughput: ~10 s per photo, 4 in parallel → ~600 photos
  (3,500 devices) ≈ 25 min of AI time while shooting; ~$3–6 total.

### 16 October 2026 — phones: every section reachable
- The phone bottom bar showed only Today, All tasks, Calendar and Projects, so
  newer sections (Automation, Captured Invoices, Repair Devices, Scan Boxes,
  News, Trade-In, etc.) couldn't be reached on mobile. The last slot is now
  **More**, opening an "All sections" sheet (3-column grid) of every section
  the person has access to, plus Settings. Staff see only their sections.
  Bundle patch 23.

### 16 October 2026 — Scan Boxes: any orientation
- Photos taken any way up: browsers apply the photo's EXIF orientation when
  drawing it, so the AI and crops get the photo as seen.
- Boxes turned within a photo: the AI now reports each label's "rotation"
  (0/90/180/270, clockwise to upright) and reads at any angle. The close-up
  re-read crops that box and turns it upright before sending
  (`rotCanvas`). Turned boxes also get the close-up when the AI is < 80% sure,
  not only for failed/missing IMEIs or a missing serial.
- Tested: upright-turning correct at 90/180/270; a sideways EXIF-tagged photo
  plus the new photo at 0/90/180/270 → 6 rows, 24 duplicates skipped, C75
  close-up sent turned upright; no errors. (Stand-in AI: proves the turning,
  cropping and flow, not the real model's reading accuracy at each angle.)

### 16 October 2026 — Scan Boxes: brand and model separate; RAM and storage separate
- Model no longer repeats the brand ("realme Note 70" → brand realme, model
  Note 70; repeated prefixes too). Only the row's own brand is removed, so
  "Xiaomi Redmi Note 13" keeps "Redmi Note 13". Brand spelling made consistent
  for known brands (POCO, Redmi, Xiaomi, realme, Samsung, Apple, OPPO, vivo…).
- New scans are saved clean; older rows are shown and exported cleaned without
  rewriting what's stored (global rule). AI told the model must not include
  the brand.
- Table and Excel: separate Brand, Model, Colour, RAM, Storage columns.

### 16 October 2026 — phones: side menu + bottom bar in pages of 4
- ☰ button on the phone top bar opens a side menu (from the left) listing
  every section the person can open, plus Settings.
- Bottom bar: 4 sections per page (2 left, 2 right) with the + button fixed in
  the middle; swipe left/right for the next/previous 4; tappable page dots under
  the +. Opening a section from the side menu turns the bar to its page.
  Solid background, iPhone home-bar safe area. Replaces the "More" button.
  Bundle patches 24–25.
- Tested at iPhone size: 4 pages (owner), swipe both ways, dot tap, side menu
  → Scan Boxes; staff see one page with their sections only.

### 16 October 2026 — Scan Boxes: owner can see removed rows, restore, delete permanently
- Owner only: "Show removed (N)" switch shows hidden rows faded with who
  removed them and when; Restore (logged in the row's history); Delete
  permanently — only rows already removed (two steps), with a confirmation;
  the photo is deleted too when no other row uses it; a deletion record
  (data/scanbox/deletions.json: ids, IMEIs, serial, model, who, when) is kept.
- Staff: can only remove (hide) their own rows; no removed view; restore and
  purge refused (403) server-side.
- Tested with two users end to end.

### 16 October 2026 — phones: version number + Reload in the side menu
- The ☰ side menu shows "Version NN" (from extra/RELEASE, injected by build.sh
  as window.MYDAY_BUILD) and a ↻ Reload button — home-screen apps on iPhone
  have no refresh button. Pages are served with no-cache + ETag and there's no
  service worker, so reopening the app loads a newly deployed version.
- Prakash's phone screenshots showed the old bottom bar: version 44 wasn't
  deployed yet (or the app wasn't reopened).
- Bump extra/RELEASE with each package.

### 16 October 2026 — Scan Boxes: never "server not reached"; built for 3 people shooting at once
- Cause: on iPhone the page is paused while the camera is open; rapid mode's
  long upload-and-wait requests (10–20 s of AI each) were cut → "Couldn't
  reach the server". Also nginx's 60 s proxy timeout.
- New flow: `/api/scanbox/upload` takes the photo quickly and returns a ticket
  (photo's own uploadId; a retried upload gets the same ticket, so nothing is
  processed twice); the server reads photos in a shared queue
  (SCAN_CONCURRENCY, default 6 across all users); the phone polls
  `/api/scanbox/job` every 2 s. Every request retries automatically (network
  drops, 5xx, 408/429) with backoff up to 30 s, waking on reconnect / app
  return; a ticket lost to a server restart → the photo is uploaded again.
  The phone shows "waiting for the connection" — never an error that loses a
  photo. Close-up re-reads retry the same way.
- Boxes with neither a valid IMEI nor a serial are never saved as rows (they
  couldn't be duplicate-checked): a close-up of that box decides — numbers
  found → saved (duplicate-checked), else "take a close-up of <box>".
  Close-up reads are told the expected box (brand/model/colour) and an answer
  for a different model is rejected.
- setup.sh: nginx proxy_read_timeout/proxy_send_timeout 180 s for MYDAY
  (added to existing sites with backup + rollback).
- Stress test through an nginx stand-in: 3 users × 4 photos at once, 40% of
  Scan Boxes connections dropped, MYDAY restarted mid-run → all 12 photos done
  in 21 s, no errors shown, exactly 6 rows (one per box), 0 duplicates, all
  IMEIs valid.

### 16 October 2026 — Scan Boxes: big Next photo / Retake buttons
- Rapid mode shows fixed buttons above the phone's bottom bar (rendered on
  <body> so "fixed" is the screen, not the page): **📷 Next photo** always,
  and a red **↻ Retake** (with the reason) when a photo or a box needs
  retaking; the retake photo replaces that item. A one-line result above them
  ("✓ 6 saved · …" / "⚠ too blurry…", "· N reading in the background").
  Max's launcher is hidden on Scan Boxes to make room. iPhone only opens the
  camera from a tap, so it's one tap per photo.
- Tested at iPhone size: blurry → Retake shown; retake → 6 saved, Retake
  gone; Next photo while another is still reading; duplicates line.

### 16 October 2026 — Scan Boxes projects
- The owner creates named projects (data/scanbox/projects.json); can rename
  and archive (archived hidden from staff; never deleted). Staff can't create
  or change projects (403).
- Scan Boxes opens on a project list; choosing one opens the usual scanning
  screen with a "← Projects · <name>" bar; the last project is remembered per
  device. Every row (rapid upload jobs, close-up saves, review saves) carries
  projectId; the table, removed view, counts and Excel export are per project;
  the export is named "<project> - scanned boxes - <date>.xlsx".
- Duplicates are checked within the same project (the same phone can appear in
  a later project). One-line change in `duplicates()` to make it global.
- Earlier rows (no project) are untouched and listed as "Earlier scans (no
  project)".
- Owner sees everyone's rows in every project; staff see only their own.
- Tested with two users end to end (create, pick, scan, same boxes in two
  projects, rescan duplicates, visibility, export name, archive).

### 16 October 2026 — Scan Boxes: lock / unlock a project for scanning
- Owner: 🔒 Lock scanning / 🔓 Unlock on each project card (and in the locked
  project's banner). Locked projects vanish from staff lists; the owner sees
  them marked 🔒 and can view/export; no scan buttons while locked.
- Server refuses new uploads and review saves into a locked or archived
  project (HTTP 423). Photos already uploaded before the lock still finish.
- A phone inside a project that gets locked: the next photo is refused, it
  returns to the project list with the reason.
- Tested with two users: lock while staff scanning → refused, 0 rows, back to
  list showing only open projects; direct upload 423; owner banner; unlock
  restores it for staff.

### 16 October 2026 — Scan Boxes: storage without a manifest
- No manifests come with lots, so missing storage/RAM is filled from the boxes:
  the AI also reads the 13-digit retail barcode number (`ean`); boxes with the
  same number share model/colour/RAM/storage, so any box that shows them
  teaches the rest ("from barcode"). New rows are filled when saved; older rows
  are filled on display/export only (not rewritten).
- Project defaults (owner, in the project bar): RAM/storage used only where a
  label has none and no barcode match ("project default").
- Filters "Storage missing" / "RAM missing"; bulk edit (select rows → set
  Storage/RAM/Model/Colour/Brand), each change logged with bulk:true;
  per-person counts per project.
- Tested: barcode learning, default fallback, display-only fill of an old row
  (stored still blank), bulk edit + log, and the screen.

### 16 October 2026 — Scan Boxes: cap the shared queue (20)
- Server limit on photos waiting + being read across all users
  (SCAN_QUEUE_LIMIT, default 20). `/api/scanbox/queue` reports it; uploads
  beyond it get 429 {busy} and the phone keeps the photo and retries (never
  lost).
- Phones poll the queue every 2–4 s while a project is open; when server queue
  + this phone's not-yet-uploaded photos ≥ limit, 📷 Next photo turns grey
  ("⏳ Wait — queue full · N of 20 · unlocks automatically") and unlocks on its
  own. Choosing many from the gallery takes only what fits, with a message.
- Note: each phone sends at most 4 photos at a time, so the cap is reached
  with several people shooting at once.
- Tested (limit 6, slow AI): gallery pick of 8 trimmed to 6; with two users
  filling the queue the third user's button locked at 6/6; all unlocked ~4 s
  after it drained; held photos sent afterwards.

### 16 October 2026 — Repair Devices: Action Plan (what to repair first, what to buy)
- New first tab **Action Plan**: cards (Repair now units/SKUs, Buy more
  units/SKUs, out-of-stock-and-selling SKUs, already moving) and two ranked
  lists. Per SKU (provisional, from the settings' assumptions):
  pipeline = Repair in Progress + Process and Move + Cleaning;
  after pipeline = max(0, shortage − pipeline);
  repairNow = min(repair candidates, after pipeline); buyQty = after pipeline −
  repairNow. Checked on the real snapshot: repair + buy + pipeline used =
  shortage for every SKU. Snapshot: 756 units to repair (268 SKUs), 2,755 to
  buy (649 SKUs); top buys iPad 8 (462) and iPad 7 (444).
- "Repair first" ranked by priority, then coverage, then quantity; "Buy more"
  by quantity, with catalog cost and last purchase date/amount. Rows open the
  SKU drawer. Excel export gains "Repair first" and "Buy more" sheets.

### 16 October 2026 — Repair Devices: no money; selling stock-outs repaired first
- Prakash doesn't want money in Repair Devices: prices, costs, spreads and
  margins are stripped server-side before anything reaches the screen,
  drawers (original/catalog records shown without money fields), SKU route or
  the Excel export (Costs sheets and money columns removed). Costs & Margins
  tab, money cards/filters/sorts and the low-margin setting removed.
- Repair first order: selling with zero stock first (highest monthly sales
  first), then Red low-stock by coverage, then Amber; rows show "selling · out
  of stock". Same rule as the original requirement, made explicit.
- Checked: every tab, the device drawer and the export contain no money.

### 16 October 2026 — fix: boxes silently missing from a photo
- 5 photos × 4 phones gave 4 rows. Cause: boxes without a readable IMEI/serial
  wait for a close-up, which needs the box's position; if the AI gave no
  position the box was skipped with no message. Now such boxes go straight to
  the named Retake list; the AI is told a position is required for every box
  and to return every box it sees. Each photo's line accounts for every box:
  "N found · saved · duplicates · need a close-up · fixed up close".
- Tested: 4-box photo with 3 unreadable, position-less boxes → 1 saved, the 3
  named in Retake.

### 16 October 2026 — Scan Boxes: in-app camera, photos kept on the phone until read
- 📸 Camera (blue button next to Next photo): full-screen live view from the
  rear camera (getUserMedia, ideal 4096×3072), square guide in the middle,
  big shutter for rapid shots, torch where supported. Each shot crops the
  square (+6% margin) from the full-resolution frame, is checked for blur /
  darkness / size (min 500 px) — bad shots flash "try again" and aren't kept.
- Every accepted shot is saved in the phone's IndexedDB ("myday-scan") first,
  then queued; removed only after the server has read it (done or retake).
  Opening the project again resumes anything left on the phone (closed app,
  lost signal, server restart). The camera never locks on a full queue —
  photos wait on the phone. Native camera and Choose photos remain.
- Tested with a simulated camera: 6 rapid shots stored, reload mid-upload,
  resumed, all read, phone copies cleared.

### 16 October 2026 — Scan Boxes: 4 slots per user, the rest wait on the phone
- Server: SCAN_PER_USER (default 4) — the queue picks the oldest waiting photo
  from someone using fewer than 4 slots, so one person can't take others'
  slots; SCAN_CONCURRENCY raised to 12 (3 users × 4).
- Phone: 4 photos processing at a time (unchanged); further photos wait on the
  phone (kept in IndexedDB) until a slot frees. A live slot bar "⚙ Processing
  N of 4 · M waiting on the phone · K done" with 4 slot lights; the camera
  counter shows the same.
- Tested: two users × 8 rapid camera shots → each "processing 4 of 4 · 4
  waiting", all 16 read, nothing left on the phones. (Both test phones share
  one browser's 6-connection limit, so server-side sampling lagged; real phones
  each have their own.)

### 16 October 2026 — Scan Boxes camera: rectangle frame, stable
- Guide is a 16:10 rectangle (per-box label), everything outside it black, so
  only what will be captured is visible; the photo is cropped to the frame
  with a 2.5% margin. Landscape phones get a height-based frame.
- Stability: shutter disabled until the stream is ready (loadedmetadata +
  play); one capture at a time (busy flag — no double shots); camera stops when
  the app is hidden and restarts on return; a track that ends is reconnected;
  phone storage failure is reported and the photo still queued for the session.
- Tested: disabled-until-ready, frame 373×235, saved photo 712×462 (same
  shape), double-tap → 1 photo, rapid taps → each saved and processing.

### 16 October 2026 — Scan Boxes camera: auto-capture
- The camera samples the frame area ~7×/s (192×120 grey): label present =
  edge density > 0.06 (barcodes/print) with sane brightness; steady = mean
  frame-to-frame difference ≤ 6; sharp = Laplacian variance ≥ 120. Four
  steady, sharp samples in a row (~0.6 s) → automatic shot (still passes the
  full-size blur/dark check). After a shot it waits for the picture to change
  clearly (diff > 22 vs the shot) before arming again — no repeat shots of the
  same box. Status line ("Looking for a label…" / "Hold steady…" / "✓ N —
  place the next box"), a green ring filling on the shutter, Auto on/off
  toggle; manual shutter still works (and also waits for the next box).
- Lightweight checks, not shape recognition. Tested with a simulated camera:
  steady label → 1 shot then waits; empty view → never fires.

### 17 October 2026 — auto-capture made hand-friendly
- Prakash's phone screenshots: sharp labels in frame stuck on "Hold steady…".
  Causes: pixel-level movement test (hand shake + exposure flicker), a 0.6 s
  hold, a strict trigger sharpness, and a full-detail blur check on the shot;
  also a rejected auto shot left the camera waiting for a "next box".
- Now: movement judged on a 24×15 brightness-normalised grid (≤ 12); 2 steady
  samples (~0.3 s) or ~1 s of a readable label with moderate movement (≤ 28)
  fires; trigger sharpness ≥ 60; label present = edge density > 0.02 (edge
  strength 40) — white labels on white card count; the camera shot's blur
  check is judged at 320 px (threshold 22); a rejected shot re-arms at once.
- Tested with feeds built from his photos: shaking hand-held label → captured
  in < 2 s, once; heavily blurred → never; empty → never.

### 17 October 2026 — auto-capture: fast, beep, fixed-phone station
- Still stuck on "Hold steady…" on a real iPhone (soft video). Now: no
  sharpness gate for triggering; a label in frame is taken once it settles
  (1 sample ≤ 14 movement after 2 sightings, ~0.2–0.3 s) or after 4 sightings
  (~0.6 s) regardless of movement. Final check rejects only a truly smeared
  shot (blur < 8 at 320 px) or < 400 px. Rearm after the picture changes.
- Scanner beep on every capture (Web Audio square 2.4 kHz, ~110 ms; unlocked by
  the tap that opens the camera) + 40 ms vibration where supported.
- Camera shows the version (vNN) top-right.
- Tested: shaking hand-held → 0.5 s; boxes sliding under a fixed phone → one
  capture per box with a beep each; empty → none.
- Recommended station: phone fixed facing down on a stand, even light,
  slide boxes underneath label-up.

### 17 October 2026 — auto-capture: no more empty-table shots
- Prakash's video showed captures of the bare wooden table (✓46, ✓51). Measured
  from his video frames: labels 0.10–0.31 edge density (gradient > 40), empty
  wood ≈ 0.06; the trigger was 0.02.
- Label threshold now 0.08, and the camera learns the empty surface from quiet
  views only (edges < 0.08; slow upward creep): need = max(0.08, surface +
  0.03). A label in view never becomes the background.
- Tested: empty wood → 0; 3 boxes sliding over wood → 3 (beep each); opening on
  a label → 0.3 s; empty plain → 0.

### 17 October 2026 — auto-capture: whole label only, one shot per box, scanner beep
- Capture only when: a barcode is seen (≥ 12 sharp alternating bars along a
  row or column, either orientation) + text/edge density above the learned
  surface + the frame's edge ring looks like bare surface (ring < max(0.06,
  surface + 0.04)) — i.e. all 4 corners inside, no hand/object crossing in.
  Prompts: "Place a box label in the frame" / "Looking for the barcode…" /
  "Fit all 4 corners inside — nothing crossing the frame".
- One shot per box: after a capture it re-arms only once that label has left
  the frame (no label + quiet), so a box resting there is never taken twice.
- Scanner-style beep: 2.9 kHz square + 5.8 kHz sine through a band-pass,
  crisp attack, ~140 ms.
- Tested: wood → 0; boxes sliding over wood → 1 per box; cut-off label → 0
  with the corners prompt; empty → 0.

### 17 October 2026 — auto-capture: 1 s of stillness, sharpest of 3, ✓ 0.5 s later
- Capture only after the whole label (4 corners + barcode) has been still for
  1 full second (7 samples at ~150 ms, movement ≤ 10 on the coarse grid);
  any movement restarts the count ("Hold still…", ring fills over the second).
- Anti-shake: at capture, 3 frames ~0.1 s apart are grabbed and the sharpest
  (Laplacian variance at 320 px) is kept.
- The ✓ and scanner beep come 0.5 s after the photo.
- Measured: still label → photo at ~1.95 s, ✓ at ~2.42 s; shaking label → never.
- NOTE: Claude's build workspace was reset before this change; the build
  tooling (patch.py, build.sh, test mocks) was lost. This version was made by
  editing myday-live/public/scanbox.js directly in the v63 package (app.js is
  the already-patched bundle) and bumping MYDAY_BUILD + the script ?v in
  index.html. Future changes: edit myday-live/ files directly; bump the build
  number in index.html.

### 17 October 2026 — every page has its own address
- New `public/router.js` (loaded after app.js): keeps the URL and the page in
  step — /today, /tasks, /calendar, /projects, /auctions, /captured-invoices,
  /repair-devices, /scan-boxes, /development, /automation,
  /automation/classic, /phone-news, /apple-trade-in, /notes, /goals, /habits,
  /settings ("/" = Dashboard). Refresh stays on the page; Back/Forward work;
  links can be bookmarked/shared; a link opened while signed out lands there
  after sign-in. Tab title shows the page name. The server already serves
  index.html for extension-less paths, so no server change.
- Tested: click → URL, refresh, direct link, Back/Forward, signed-out link.

### 17 October 2026 — every table: rows per page + column picker
- New `public/tables.js` (loaded after router.js) enhances every table with a
  header row (≥ 3 columns, not key/value drawers), including ones drawn later
  (MutationObserver): **Rows** 20 (default) / 30 / 50 / 100 / 200 / 500 / 1000 /
  2000 / 3000 with Prev/Next and "page X of Y · N rows"; **Columns ▾** to show
  or hide columns (remembered per table and page, "Show all columns").
  Settings in localStorage (myday_rows, myday_cols:*).
- Repair Devices pages on its own: its page size now follows the same Rows
  setting (default 20; `myday-rows` event), and the toolkit only adds Rows +
  Columns there.
- Tested on Scan Boxes (45 rows): 20 by default, Next, Rows 50, hide Colour,
  both remembered after refresh.

### 19 October 2026 — Scan Boxes: filters on the table; IMEI 2 can be ignored
- A filter row under the table headings: Scanned → From/To date; By → person
  (owner); Clear. Replaces the separate date/person boxes above the table.
- "⚠ Needs checking" now means IMEI 1 only (bad, or no IMEI 1 and no serial);
  new "IMEI 2 needs checking" filter.
- IMEI 2 can be set aside: ⊘ Ignore per row (undo) and "Ignore IMEI 2" bulk
  action → checks.imei2 = "ignored" (shown ⊘, "⊘ ignored" in Excel), logged as
  "IMEI 2 status" edits; undo re-runs the normal check. (`edit` field
  "imei2Status".)
- Tested with 6 rows: IMEI-1-only needs checking (1), IMEI 2 filter (3), ignore +
  bulk ignore stored + logged, date and person filters, Clear.

### 19 October 2026 — Scan Boxes: a person can confirm a flagged IMEI is right
- "✓ It's right" next to a flagged IMEI 1 or IMEI 2 → checks.imeiN =
  "confirmed" + imeiNBy (name); leaves Needs checking, counts as ✓ IMEI
  verified, shown "checked by <name> · undo", Excel "✓ checked by person"
  (green). Bulk "✓ Mark IMEI 1 right on N" (asks to confirm). Logged as
  "IMEI 1/2 status" edits; undo re-runs the normal check. (`edit` field
  "imei1Status" / "imei2Status".)
- Tested: Needs checking 2 → 1, stored with who, logged, shown as checked.

### 19 October 2026 — speed fixes (server was healthy: 2 GB, load 0.07)
- Prakash's droplet: 1.97 GB RAM with 1.46 GB available, load 0.07 → the
  slowness was in the browser. Disk: Scan Boxes photos 1.1 GB.
- tables.js only re-processes a table when it changed (row count / first row /
  rows setting stamp); clicks force a refresh. Tables marked
  `data-own-pager` page themselves.
- Scan Boxes draws only the current page (Rows setting, default 20) with its
  own Prev/Next; list endpoint gzip-compressed; refresh after photos debounced
  to 3 s; queue polling pauses while the tab is hidden.
- Owner: in a locked project, "🗑 Delete this project's photos (keep the
  data)" → `/api/scanbox/drop-photos` deletes the image files, clears photoId,
  logs it per row; reports photos and MB freed.
- Also advised: apt upgrade + reboot (security update pending).

### 19 October 2026 — Scan Boxes: scan type per project (device box / bulk carton)
- Owner sets each project's Scan type on its card: 📦 Device box (default —
  the existing flow, unchanged; existing projects stay on it) or 🗃 Bulk carton
  (project.scanType = "carton"). Staff see the type; the camera prompt adapts.
- Carton photos go to `ai.scanCarton`: brand, model, product/part number,
  count, GTIN, SSCC and every serial/IMEI listed → one row per serial (product
  in Product model, "carton SSCC · GTIN · count" in the note); duplicates per
  project as usual; label count vs serials read compared — mismatch is shown
  and the photo goes to Retake with the rows kept. No close-up re-reads.
- Tested with the Apple master-carton photo: 10 serials, count 10 ✓, rescan →
  10 duplicates, device-box project unchanged.

### 19 October 2026 — carton scans: tolerant reader + carton table
- "Not able to save" on carton scans: the reader only accepted `items`; real
  answers may use serials / serial_numbers / imeis, objects or plain strings,
  count as a string. Now all accepted.
- Carton fields stored per row: sscc, gtin, cartonCount (FIELDS); Excel gets
  Carton SSCC / GTIN / Carton count columns.
- 🗃 Bulk-carton projects show their own table: Scanned, By, Brand, Product,
  Model, Serial, IMEI, Carton SSCC, GTIN, Count (+ the in-table date/person
  filters, paging, Columns picker). Device-box projects keep their table.
- Tested: plain-list answer → 10 saved, carton table rows, device table unchanged.

### 19 October 2026 — Gmail reconnect after a password change
- A password change revokes MYDAY's Gmail refresh token. On reconnect Google
  may not send a new refresh token (it remembers the grant); the callback then
  reused the old, revoked one → "Token has been expired or revoked" kept
  repeating. The callback no longer reuses an old refresh token: it shows
  "Remove MYDAY's old access first" (myaccount.google.com/connections), then
  connecting again gets a fresh token.

### 26 October 2026 — combine projects, name no-project scans, printed-IMEI fallback
- Owner: tick "combine" on 2+ project cards → name → "Combine into new
  project": a NEW project with a copy of every row (new ids, `source` = the
  origin project name, "copied" edit logged; combinedFrom on the project).
  Originals untouched. "Earlier scans (no project)" → "Name these scans → new
  project" (rows get the project, logged). Source shown under Brand and as an
  Excel column. Rename already existed (owner, project card).
- POCO C75 black labels under glossy wrap weren't auto-captured / read: the AI
  (stack read and close-up read) is told to use the printed "IMEI1:/IMEI2:/SN:"
  text when barcodes are unreadable; auto-capture accepts a label with dense
  print (edge density > 0.13) when barcode stripes are hidden by glare, and
  darker labels (mean > 25).
- Tested combine (4 rows, sources, originals unchanged) and name-legacy.

### 26 October 2026 — Scan Boxes: PDF with photos
- "⬇ PDF with photos" beside ⬇ Excel: opens a print view of the filtered rows
  (device or carton layout) with each row's photo beside its details, loaded
  through the signed-in session (nothing public); the print dialog opens once
  the photos have loaded → "Save as PDF". Tested: 10 rows, 10 photos.

## Where we are (Next.js rebuild)

**Phase 1 of 15 complete.** Foundation and responsive shell.
**Next: Phase 2** — Supabase, authentication, database schema, row level security.

## Done

### Phase 1 — foundation

- Next.js 16.3.5, React 19, TypeScript strict, Tailwind 4, App Router, `src/` layout
- Design tokens for light and dark in `src/app/globals.css`, all colour going
  through CSS variables so the accent becomes user-configurable in Phase 9
- Typography: Inter Tight for interface and figures, Newsreader for the greeting
- App shell: sidebar on desktop, bottom bar with centre add button on phones,
  top bar on mobile, theme switch with light / dark / match system
- Dashboard hero: live clock, greeting that changes through the day, weekday,
  date, and three counts (currently zero, because nothing is stored yet)
- Eleven routes, each with a written empty state rather than placeholder data
- Vitest with nine tests covering the time helpers, including a local-midnight
  case and daylight saving boundaries
- ESLint, Prettier, `npm run verify`, GitHub Actions CI with a secret scanner

### Verified

`npm run lint` · `npm run typecheck` · `npm run test` (9 passing) ·
`npm run build` (11 routes prerendered).

## Not done yet, by design

- No database, no authentication, no real data. The counts are zeroes and the
  add buttons are disabled rather than pretending to work.
- Search, settings and customisation screens are signposted, not built.

## Decisions made, and why

**Wall-clock vs instant time.** Task dates and times are stored as local date
and time plus the user's timezone; only real events (created, completed,
reminder fired) are timestamps. Stops "gym at 7am" drifting when daylight
saving changes. `src/lib/time.ts`, tested.

**Recurring tasks store a rule, not rows.** One task row with an RRULE,
occurrences expanded on read, `task_occurrences` holding only exceptions
(completed, skipped, moved). Avoids thousands of unmanageable future rows.

**Clock and theme read through `useSyncExternalStore`.** The usual
state-plus-effect hydration guard is flagged by React 19's lint rules and
costs an extra render. `src/lib/hooks/use-now.ts` and `use-hydrated.ts`.

**Green accent, not purple.** Explicit request. Every accent use goes through
`--accent` so Phase 9 can change it per user without touching components.

**Vercel builds, not the droplet.** The DigitalOcean droplet has 512 MB RAM;
a Next.js build wants 1–2 GB. Vercel's free tier does the building instead,
and the droplet keeps serving the older standalone task app until Phase 4.

## Known constraints

- `npm run build` cannot reach fonts.googleapis.com inside Claude's sandbox.
  A build that fails _only_ on `next/font/google` is the sandbox, not the code.
  Phase 1 was verified with the fonts stubbed, then restored.
- Supabase project `myday-prod` exists (East US). Not yet connected to the app.

## Phase 2 checklist

- [ ] `@supabase/supabase-js` and `@supabase/ssr`, browser and server clients
- [ ] Migration 001: profiles, user_preferences, categories, tags
- [ ] Migration 002: tasks, task_occurrences, subtasks, reminders
- [ ] RLS policy on every table, plus a test proving one user can't read another's rows
- [ ] Login page, session middleware, protected routes
- [ ] Generated database types into `src/types/database.ts`
- [ ] Vercel project connected, environment variables set
