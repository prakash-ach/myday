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
