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
