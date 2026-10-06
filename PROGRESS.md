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
