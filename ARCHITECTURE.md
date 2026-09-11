# MYDAY — System Architecture

Version 0.1, for approval. Nothing has been built yet.

---

## 0. What already exists

I inspected the working directory. There is **no MYDAY code, no package.json, no git repository**. This is a clean start.

The only code present is the small task app built earlier in this conversation:

```
task-app/
├── public/index.html     single-file React app, no build step
├── server.js             Node HTTP server, sessions, per-account JSON storage
├── store.js              scrypt password hashing
├── manage.js             CLI for accounts
└── deploy.sh / push.sh   droplet deploy scripts
```

It is a different stack and a different scope. **Recommendation: leave it running on `task.acharyaandcollc.com` as-is until MYDAY Phase 4 is live, then retire it.** It already exports CSV, and MYDAY's importer will read that same CSV shape, so nothing is stranded.

### Toolchain confirmed in my sandbox

|                       |                                        |
| --------------------- | -------------------------------------- |
| Node                  | v22.22.2                               |
| npm                   | 10.9.7 (registry reachable)            |
| git                   | 2.43.0 (can clone public GitHub repos) |
| Next.js latest stable | 16.3.5                                 |
| React                 | 19.3.0                                 |
| Tailwind              | 4.3.3                                  |

### What I can and cannot do

**I can:** scaffold the project, write every file, install packages, write SQL migrations, run ESLint, `tsc --noEmit`, tests and `next build`, fix what breaks, and hand you working code.

**I cannot:** create accounts, hold your API keys, reach supabase.com or vercel.com from my sandbox (both blocked), push to GitHub, or trigger a deploy. Those are yours. I'll give you the exact clicks and commands each time, and everything else I do myself.

**I also have no memory between conversations.** This is the single biggest risk to a long-term project. The fix is in §9.4 — the GitHub repo becomes the memory, and I re-read it at the start of each session.

---

## 1. System architecture

```
        ┌────────────────────────────────────────────────┐
        │  Browser / installed PWA                       │
        │  desktop · iPhone · iPad · Android             │
        │  React 19 · service worker · web push          │
        └───────────────┬────────────────────────────────┘
                        │ HTTPS
        ┌───────────────▼────────────────────────────────┐
        │  Vercel — Next.js 16 App Router                │
        │                                                │
        │  Server Components   read data, render         │
        │  Server Actions      writes, revalidation      │
        │  Route Handlers      /api/ai  /api/news        │
        │                      /api/weather  /api/push   │
        │  Cron Job            /api/cron/reminders  5min │
        │                                                │
        │  Secrets live here only, never in the bundle   │
        └───┬──────────────┬──────────────┬──────────────┘
            │              │              │
    ┌───────▼──────┐ ┌─────▼──────┐ ┌─────▼────────────┐
    │  Supabase    │ │ Anthropic  │ │ Open-Meteo (wx)  │
    │  Postgres    │ │ Claude API │ │ RSS feeds (news) │
    │  Auth        │ └────────────┘ │ no API keys      │
    │  Storage     │                └──────────────────┘
    │  RLS on all  │
    └──────────────┘
```

**Why this shape.** All third-party calls happen server-side, so no key ever reaches the browser. The browser talks to Supabase directly only for authenticated reads/writes, where RLS is the guard — never with a service role key.

### Rendering strategy

| Surface                                | Approach          | Reason                                |
| -------------------------------------- | ----------------- | ------------------------------------- |
| Dashboard shell, lists                 | Server Components | fast first paint, no data waterfall   |
| Clock, slideshow, drag & drop, editors | Client Components | interactive                           |
| Task/note writes                       | Server Actions    | no hand-written API layer to maintain |
| AI, news, weather, push                | Route Handlers    | need secrets or streaming             |

---

## 2. Database schema

PostgreSQL via Supabase. Everything below is real DDL I'll turn into migrations.

### 2.1 The two decisions that matter most

**Time.** Getting this wrong is the classic way these apps rot. Two different kinds of time need two different storage types:

- **Wall-clock intent** — "gym at 7:00am every Tuesday". Stored as `date` + `time` columns plus the user's IANA timezone. 7am stays 7am through daylight saving, which is what a human means.
- **Absolute moments** — created_at, completed_at, when a reminder actually fires. Stored as `timestamptz` in UTC.

The reminder row holds a computed `fire_at timestamptz`, recalculated whenever the task time, recurrence, or the user's timezone changes.

**Recurrence.** Never materialise future rows. A task recurring daily for five years would be 1,825 rows, and editing it would be agony. Instead:

- `tasks` holds one row with a recurrence rule (iCalendar RRULE semantics).
- Occurrences for the visible date window are generated in memory on read.
- `task_occurrences` holds rows **only** where an occurrence deviates from the rule: it was completed, skipped, rescheduled, or edited. One row per exception, not per occurrence.

So a daily habit completed 400 times has 1 task row + 400 tiny occurrence rows, and changing the time changes one row.

### 2.2 Core tables

```sql
-- ---------- identity ----------
create table profiles (
  id            uuid primary key references auth.users on delete cascade,
  display_name  text,
  avatar_url    text,
  timezone      text not null default 'America/New_York',
  week_starts   smallint not null default 0,   -- 0 Sun, 1 Mon
  created_at    timestamptz not null default now()
);

create table user_preferences (
  user_id            uuid primary key references auth.users on delete cascade,
  theme              text not null default 'system',   -- system | light | dark
  theme_name         text not null default 'graphite',
  accent             text not null default '#3F6B5B',
  card_opacity       numeric(3,2) not null default 0.90,
  card_blur          smallint not null default 12,
  radius             smallint not null default 14,
  font_scale         numeric(3,2) not null default 1.00,
  clock_24h          boolean not null default false,
  date_format        text not null default 'D MMMM YYYY',
  weather_location   jsonb,          -- {label, lat, lon}
  news_topics        text[] not null default '{ai,security,apple}',
  default_priority   text not null default 'normal',
  default_reminders  jsonb not null default '[]',
  updated_at         timestamptz not null default now()
);

-- ---------- taxonomy ----------
create table categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  name       text not null,
  color      text not null default '#3F6B5B',
  icon       text,
  position   integer not null default 0,
  unique (user_id, name)
);

create table tags (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name    text not null,
  unique (user_id, name)
);

-- ---------- tasks ----------
create type task_status   as enum ('todo','in_progress','waiting','completed','cancelled');
create type task_priority as enum ('urgent','high','normal','low');

create table tasks (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users on delete cascade,
  title          text not null,
  description    text,
  body           jsonb,                      -- rich text, TipTap document
  category_id    uuid references categories on delete set null,
  status         task_status   not null default 'todo',
  priority       task_priority not null default 'normal',
  scheduled_date date,                       -- wall-clock intent
  start_time     time,
  end_time       time,
  due_date       date,
  estimate_min   integer,
  is_inbox       boolean not null default false,
  -- recurrence, null for one-off tasks
  rrule          text,                       -- 'FREQ=WEEKLY;BYDAY=TU,TH'
  recur_start    date,
  recur_until    date,
  -- absolute moments
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint recurring_needs_start check (rrule is null or recur_start is not null)
);

create index tasks_user_date  on tasks (user_id, scheduled_date) where status <> 'completed';
create index tasks_user_due   on tasks (user_id, due_date)       where status <> 'completed';
create index tasks_recurring  on tasks (user_id) where rrule is not null;
create index tasks_inbox      on tasks (user_id) where is_inbox;
create index tasks_search     on tasks using gin (
  to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,''))
);

-- exceptions only, never one row per occurrence
create table task_occurrences (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references tasks on delete cascade,
  user_id         uuid not null references auth.users on delete cascade,
  occurrence_date date not null,
  status          task_status,
  completed_at    timestamptz,
  moved_to_date   date,
  start_time      time,
  note            text,
  unique (task_id, occurrence_date)
);
create index occ_user_date on task_occurrences (user_id, occurrence_date);

create table subtasks (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references tasks on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  title        text not null,
  is_done      boolean not null default false,
  position     integer not null default 0,
  completed_at timestamptz
);

create table task_tags (
  task_id uuid references tasks on delete cascade,
  tag_id  uuid references tags  on delete cascade,
  primary key (task_id, tag_id)
);

-- ---------- notes ----------
create table notes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  title        text,
  body         jsonb not null default '{}',
  category_id  uuid references categories on delete set null,
  is_pinned    boolean not null default false,
  is_favorite  boolean not null default false,
  source_task  uuid references tasks on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index notes_search on notes using gin (to_tsvector('english', coalesce(title,'')));

create table note_tags (
  note_id uuid references notes on delete cascade,
  tag_id  uuid references tags  on delete cascade,
  primary key (note_id, tag_id)
);

-- ---------- reminders, one table for tasks and notes ----------
create type reminder_target as enum ('task','note');

create table reminders (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users on delete cascade,
  target_type     reminder_target not null,
  task_id         uuid references tasks on delete cascade,
  note_id         uuid references notes on delete cascade,
  occurrence_date date,                       -- which instance, for recurring
  offset_minutes  integer not null default 0, -- 0 = at the time, 120 = two hours before
  fire_at         timestamptz not null,       -- computed absolute moment
  channel         text not null default 'push',
  sent_at         timestamptz,
  dismissed_at    timestamptz,
  created_at      timestamptz not null default now(),
  constraint one_target check (
    (target_type = 'task' and task_id is not null and note_id is null) or
    (target_type = 'note' and note_id is not null and task_id is null)
  )
);
create index reminders_due on reminders (fire_at) where sent_at is null;

create table push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);

-- ---------- goals and habits ----------
create table goals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  title       text not null,
  description text,
  area        text,                 -- education, career, financial, fitness, family, personal
  target_date date,
  progress    smallint not null default 0 check (progress between 0 and 100),
  is_archived boolean not null default false,
  created_at  timestamptz not null default now()
);

create table goal_milestones (
  id          uuid primary key default gen_random_uuid(),
  goal_id     uuid not null references goals on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  title       text not null,
  target_date date,
  done_at     timestamptz,
  position    integer not null default 0
);

create table goal_tasks (
  goal_id uuid references goals on delete cascade,
  task_id uuid references tasks on delete cascade,
  primary key (goal_id, task_id)
);

create table habits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  title       text not null,
  color       text not null default '#3F6B5B',
  target_days smallint[] not null default '{0,1,2,3,4,5,6}',
  is_archived boolean not null default false,
  created_at  timestamptz not null default now()
);

create table habit_entries (
  habit_id  uuid references habits on delete cascade,
  user_id   uuid not null references auth.users on delete cascade,
  entry_date date not null,
  done      boolean not null default true,
  primary key (habit_id, entry_date)
);

-- ---------- photos and attachments ----------
create table photo_albums (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  name          text not null,
  is_slideshow  boolean not null default false,
  created_at    timestamptz not null default now()
);

create table photos (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  album_id     uuid references photo_albums on delete set null,
  storage_path text not null,
  width        integer,
  height       integer,
  is_favorite  boolean not null default false,
  position     integer not null default 0,
  created_at   timestamptz not null default now()
);

create table attachments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  task_id      uuid references tasks on delete cascade,
  note_id      uuid references notes on delete cascade,
  storage_path text not null,
  filename     text not null,
  mime_type    text,
  size_bytes   bigint,
  created_at   timestamptz not null default now()
);

-- ---------- dashboard ----------
create table dashboard_layouts (
  user_id    uuid primary key references auth.users on delete cascade,
  breakpoint text not null default 'lg',
  widgets    jsonb not null default '[]',   -- [{key,x,y,w,h,visible,settings}]
  updated_at timestamptz not null default now()
);

-- ---------- history ----------
create table activity_history (
  id          bigserial primary key,
  user_id     uuid not null references auth.users on delete cascade,
  entity_type text not null,
  entity_id   uuid,
  action      text not null,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index activity_recent on activity_history (user_id, created_at desc);

create table ai_action_history (
  id           bigserial primary key,
  user_id      uuid not null references auth.users on delete cascade,
  prompt       text not null,
  proposed     jsonb not null,
  approved     boolean,
  applied_at   timestamptz,
  created_at   timestamptz not null default now()
);
```

`activity_history` and `ai_action_history` get a monthly cleanup job so they never grow unbounded.

---

## 3. Security and RLS

**Rule: RLS enabled on every table, no exceptions, verified by a test.**

```sql
alter table tasks enable row level security;

create policy "own tasks" on tasks
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

The same policy shape applies to every table carrying `user_id`. Child tables that don't naturally carry one (`subtasks`, `task_tags`, `goal_tasks`) carry it anyway — denormalised on purpose, because a policy that joins to the parent is slower and easier to get wrong.

**Storage.** Two private buckets, `photos` and `attachments`. Object paths are prefixed with the owner's uuid, and the storage policy checks that prefix:

```sql
create policy "own photos" on storage.objects
  for all using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

Images are served through short-lived signed URLs, generated server-side. No bucket is ever public.

**Secrets.** `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `VAPID_PRIVATE_KEY` exist only as Vercel environment variables and are read only in Route Handlers and cron jobs. The browser bundle gets `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which are designed to be public and are useless without a valid session because of RLS. `.env.local` is gitignored from the first commit. I'll add a CI check that fails the build if a service key pattern appears in client code.

**Auth.** Supabase Auth, email and password, with email confirmation on. Sign-ups disabled in the Supabase dashboard after your account exists, so the app isn't open to the internet. Family accounts later are just additional users — RLS already isolates them.

---

## 4. Folder structure

```
myday/
├── src/
│   ├── app/
│   │   ├── (auth)/login/page.tsx
│   │   ├── (app)/
│   │   │   ├── layout.tsx            sidebar + bottom nav shell
│   │   │   ├── page.tsx              dashboard
│   │   │   ├── today/page.tsx
│   │   │   ├── tasks/page.tsx
│   │   │   ├── calendar/page.tsx
│   │   │   ├── notes/[[...id]]/page.tsx
│   │   │   ├── goals/page.tsx
│   │   │   ├── habits/page.tsx
│   │   │   ├── inbox/page.tsx
│   │   │   ├── search/page.tsx
│   │   │   └── settings/[section]/page.tsx
│   │   ├── api/
│   │   │   ├── ai/route.ts
│   │   │   ├── news/route.ts
│   │   │   ├── weather/route.ts
│   │   │   ├── push/subscribe/route.ts
│   │   │   └── cron/reminders/route.ts
│   │   ├── manifest.ts
│   │   └── layout.tsx
│   ├── components/
│   │   ├── ui/                       shadcn primitives
│   │   ├── dashboard/                hero, widgets, grid, customise mode
│   │   ├── tasks/                    row, editor, quick-add, filters
│   │   ├── notes/                    editor, list, note card
│   │   ├── calendar/                 day, week, month, drag layer
│   │   ├── photos/                   slideshow, album manager, uploader
│   │   └── shell/                    sidebar, bottom-nav, command palette
│   ├── lib/
│   │   ├── supabase/                 browser.ts, server.ts, middleware.ts
│   │   ├── recurrence/               rrule expansion, occurrence merge
│   │   ├── time/                     timezone-safe date helpers
│   │   ├── reminders/                fire_at computation
│   │   ├── ai/                       prompt, tool schemas, proposal types
│   │   └── validation/               zod schemas shared by forms and actions
│   ├── server/actions/               task.ts, note.ts, goal.ts, prefs.ts
│   ├── types/database.ts             generated from Supabase
│   └── styles/themes.css             theme tokens
├── supabase/migrations/              timestamped .sql files
├── public/icons/                     PWA icons
├── tests/                            vitest unit + playwright e2e
└── .github/workflows/ci.yml
```

---

## 5. Major components

**Shell** — `AppShell`, `Sidebar`, `BottomNav`, `CommandPalette` (Ctrl/⌘+K), `QuickAddDialog`, `ThemeProvider`.

**Dashboard** — `HeroPanel` (clock, greeting, date, weather, counts, photo backdrop), `PhotoSlideshow`, `WidgetGrid`, `CustomiseBar`, and one component per widget: `TodayTasksWidget`, `ScheduleWidget`, `QuickNotesWidget`, `CalendarWidget`, `UpcomingWidget`, `RemindersWidget`, `WeatherWidget`, `TechNewsWidget`, `GoalsWidget`, `HabitsWidget`, `WeeklyProgressWidget`, `OverdueWidget`, `QuoteWidget`, `StatsWidget`.

Every widget implements the same contract, which is what makes the grid work:

```ts
interface WidgetDef {
  key: string;
  title: string;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  Component: React.ComponentType<{ settings: Json }>;
  Settings?: React.ComponentType<{ settings: Json; onChange(s: Json): void }>;
}
```

**Tasks** — `TaskRow`, `TaskList`, `TaskEditorSheet`, `SubtaskList`, `RecurrenceEditor`, `ReminderEditor`, `PriorityPicker`, `NaturalLanguageInput`, `TaskFilters`.

**Notes** — `NoteEditor` (TipTap), `NoteList`, `NoteCard`, `NoteToTaskDialog`.

**Calendar** — `CalendarDay`, `CalendarWeek`, `CalendarMonth`, `DragScheduleLayer`, `TimeGrid`.

**AI** — `AssistantPanel`, `ProposalCard` (renders a diff and holds the Apply button).

---

## 6. API and server architecture

**Writes go through Server Actions**, each one: validate with zod → check ownership → write → `revalidatePath` → append to `activity_history`. No hand-rolled REST layer to keep in sync.

**Route Handlers** exist only where a secret or streaming is needed:

| Route                      | Purpose                   | Notes                                               |
| -------------------------- | ------------------------- | --------------------------------------------------- |
| `POST /api/ai`             | Claude assistant          | streams; returns proposals, never writes directly   |
| `GET /api/news`            | tech headlines            | server-side RSS fetch + parse, cached 30 min        |
| `GET /api/weather`         | current + high/low + rain | Open-Meteo, no API key needed, cached 15 min        |
| `POST /api/push/subscribe` | store a push subscription |                                                     |
| `GET /api/cron/reminders`  | fire due reminders        | Vercel Cron every 5 min, protected by `CRON_SECRET` |

**Reading occurrences** — the one piece of real logic. For a date window:

1. Fetch non-recurring tasks in range (indexed).
2. Fetch recurring task rules for the user (a small set).
3. Expand each rule across the window in the user's timezone.
4. Left-join `task_occurrences` to apply completions, skips and moves.
5. Merge, sort, return.

This lives in `lib/recurrence/` as pure functions with unit tests, and is the first thing I'll write tests for.

---

## 7. Notification architecture

```
Vercel Cron ──5 min──▶ /api/cron/reminders
                         │ select * from reminders
                         │ where sent_at is null and fire_at <= now()+5min
                         │ (index-backed, cheap)
                         ▼
                       web-push ──▶ each push_subscription
                         │
                         ▼
                       mark sent_at, drop dead subscriptions (410 Gone)
```

`fire_at` is recomputed whenever the task time, recurrence rule, or the user's timezone changes. For recurring tasks, only the **next** occurrence's reminder row exists at any moment; firing it creates the following one. That keeps the table small and honest.

**What works where.** Desktop Chrome/Edge/Firefox: reliable. Android: reliable. **iPhone and iPad: only when MYDAY is installed to the home screen** (iOS 16.4+), and iOS may delay a notification by minutes — that is Apple's behaviour, not a bug I can fix. Email reminders are the reliable backstop if you want them later; that would need a Resend or Postmark account.

In-app, a lightweight poll surfaces due reminders while a tab is open, so you're never dependent on push alone.

---

## 8. AI architecture

Strictly server-side, and **structurally incapable of silent writes**.

```
You type a request
   │
   ▼
POST /api/ai  ── builds a scoped context, never your whole database:
   │             today ± 14 days, overdue items, goals, matching notes
   ▼
Claude with tool definitions: create_task, reschedule_task, complete_task,
   │  create_note, split_note_into_tasks, plan_day, summarise_week
   ▼
Returns a PROPOSAL object — a list of intended changes. Nothing is written.
   │
   ▼
ProposalCard renders it as a readable diff
   │
   ├── you press Apply  ──▶ Server Action executes, writes ai_action_history
   └── you press Discard ─▶ nothing happens
```

The tool layer has no write path to the database at all. The AI returns intent; a Server Action you triggered does the writing. Even a confused model cannot delete your data.

**Privacy.** No note or task content leaves the server unless you invoke an AI feature. The assistant is a page you open, not a background process. Natural-language quick-add tries a local parser first (chrono-style date parsing); Claude is only called when the local parse is ambiguous, and the interpretation is always shown before saving.

---

## 9. Deployment architecture

```
local / my sandbox ──▶ GitHub repo ──▶ Vercel
                          │              ├─ push to main      → production
                          │              └─ pull request      → preview URL
                          ▼
                     GitHub Actions CI
                     lint · tsc · vitest · next build
```

**Environments**

|            | Supabase project | Vercel                    |
| ---------- | ---------------- | ------------------------- |
| Production | `myday-prod`     | production, custom domain |
| Preview    | `myday-dev`      | preview deployments       |

Separate Supabase projects, so a bad migration can never touch your real data.

**Domain.** `myday.acharyaandcollc.com` → CNAME to Vercel. Cloudflare DNS record set to **DNS only** (grey cloud); Vercel terminates TLS itself, and proxying on top causes redirect loops.

**Migrations.** Plain SQL files in `supabase/migrations/`, applied with the Supabase CLI. Every schema change is a new file, never an edit to an old one.

### 9.4 Continuity — how we keep this a long-term project

I don't remember previous conversations. The repo is the memory.

1. The GitHub repo is public (it holds no secrets — `.env.local` is gitignored and all keys live in Vercel).
2. The repo carries `ARCHITECTURE.md` (this file), `PROGRESS.md` (what's done, what's next, decisions made and why), and `CLAUDE.md` (the standing instruction from your master prompt).
3. Each new session, you open with: **"Clone https://github.com/YOU/myday, read PROGRESS.md, then do X."** I clone it, read the state, and continue from the real code rather than a description of it.
4. I finish each session by updating `PROGRESS.md` and handing you the changed files to commit.

This turns "you must handle all" into something that actually survives my lack of memory.

---

## 10. Desktop dashboard wireframe

```
┌──────────────┬────────────────────────────────────────────────────────────┐
│  MYDAY       │ ░░░ family photo, blurred, dark overlay ░░░░░░░░░░░░░░░░░░ │
│              │                                                            │
│  Today    7  │   Good Afternoon, Prakash              ☁ 72°  H78 L61      │
│  Inbox    2  │                                                            │
│  Tasks       │   3:28 PM                                                  │
│  Calendar    │   Friday, 11 September 2026                                │
│  Notes       │                                                            │
│  Goals       │   7 tasks today · 3 done · 2 reminders          [+ Quick]  │
│  Habits      ├────────────────────────────────────────────────────────────┤
│  ──────────  │ ┌───────────────────────┐ ┌──────────────┐ ┌─────────────┐ │
│  Work        │ │ TODAY'S TASKS         │ │ SCHEDULE     │ │ WEATHER     │ │
│  Personal    │ │ ▢ 9:30 Standup        │ │ 10:00 ▓▓▓▓   │ │  72° Clear  │ │
│  Family      │ │ ▣ 11:00 Invoice   ✓   │ │ 11:00 ▓▓     │ │  Rain 10%   │ │
│  Study       │ │ ▢ 14:00 Call Robert   │ │ 14:00 ▓▓▓    │ ├─────────────┤ │
│  ──────────  │ │ ▢ Pay mortgage        │ │ 18:00 ▓▓▓▓   │ │ HABITS      │ │
│  Completed   │ │ …3 more               │ │              │ │ ●●●○●●● 5   │ │
│  Settings    │ └───────────────────────┘ └──────────────┘ └─────────────┘ │
│              │ ┌───────────────────────┐ ┌───────────────────────────────┐│
│              │ │ OVERDUE          (2)  │ │ TECH NEWS                     ││
│              │ │ ! Review invoice      │ │ • Anthropic ships …  2h  Ars  ││
│              │ │ ! Call supplier       │ │ • NVIDIA reports …   5h  Rtrs ││
│              │ └───────────────────────┘ └───────────────────────────────┘│
│              │ ┌───────────────────────┐ ┌───────────────────────────────┐│
│  ◯ Prakash   │ │ GOALS                 │ │ QUICK NOTES                   ││
│              │ │ Python  ████████░░ 78%│ │ Ask supplier re S25           ││
└──────────────┴─┴───────────────────────┴─┴───────────────────────────────┴┘
                                                      [ Customise dashboard ]
```

## 11. Mobile dashboard wireframe

```
┌───────────────────────────┐
│ ░ photo ░░░░░░░░░░░░░░░░░ │
│                           │
│  Good Afternoon           │
│  3:28 PM                  │
│  Fri 11 Sep    ☁ 72°      │
│                           │
│  7 today · 3 done         │
├───────────────────────────┤
│  TODAY                    │
│  ┌─────────────────────┐  │
│  │ ▢  9:30  Standup    │  │
│  │         work        │  │
│  ├─────────────────────┤  │
│  │ ▣ 11:00  Invoice  ✓ │  │
│  ├─────────────────────┤  │
│  │ ▢ 14:00  Call Robert│  │
│  └─────────────────────┘  │
│                           │
│  OVERDUE             (2)  │
│  ┌─────────────────────┐  │
│  │ ! Review invoice    │  │
│  └─────────────────────┘  │
│                           │
│  ▾ swipe for more widgets │
├───────────────────────────┤
│ Today  Tasks (+) Cal  More│
└───────────────────────────┘
```

Mobile is a separate composition, not a squeezed desktop: single column, widgets stack in your chosen order, the hero collapses to a compact bar on scroll, swipe right on a task completes it, swipe left opens actions, and the `+` opens Quick Add with the keyboard already up.

---

## 12. Implementation checklist

Each phase ends with: app runs, lint clean, `tsc` clean, tests pass, production build succeeds, `PROGRESS.md` updated, work committed.

**Phase 1 — foundation**

- [ ] `create-next-app` with TypeScript, Tailwind 4, App Router
- [ ] shadcn/ui, base tokens, light/dark provider
- [ ] ESLint + Prettier + strict tsconfig
- [ ] Vitest + Playwright scaffolding
- [ ] GitHub repo, CI workflow, first green build
- [ ] Responsive shell: sidebar, bottom nav, empty routes

**Phase 2 — data and auth**

- [ ] Supabase projects (you create; I write the config)
- [ ] Migration 001: profiles, preferences, categories, tags
- [ ] Migration 002: tasks, occurrences, subtasks, reminders
- [ ] RLS policies on every table + a test proving isolation
- [ ] Login page, session middleware, protected routes
- [ ] Generated database types

**Phase 3 — tasks**

- [ ] Task CRUD server actions + zod schemas
- [ ] Today view, All Tasks, filters, sorting
- [ ] Task editor sheet, subtasks, priorities, categories
- [ ] Complete / uncomplete with optimistic UI
- [ ] Quick Add with Ctrl+K and local date parsing

**Phase 4 — recurrence and reminders**

- [ ] `lib/recurrence` with full unit tests, DST cases included
- [ ] Recurrence editor UI
- [ ] Occurrence exceptions: complete, skip, move one instance
- [ ] Reminder rows, `fire_at` computation, multiple reminders
- [ ] Overdue and Upcoming views
- [ ] CSV import, compatible with the old app's export

**Phase 5 — notes** · TipTap editor, tags, pin/favourite, note→task, full-text search
**Phase 6 — calendar** · day/week/month, drag to reschedule, integration seam for Google Calendar
**Phase 7 — dashboard** · hero, widget grid, customise mode, layout persistence
**Phase 8 — photos** · storage bucket, upload, albums, slideshow with Ken Burns, readability overlay
**Phase 9 — themes** · theme presets, accent picker, radius/blur/opacity/font scale
**Phase 10 — weather and news** · Open-Meteo widget, RSS pipeline, topic settings
**Phase 11 — goals and habits** · goals with milestones, habit streaks, dashboard widgets
**Phase 12 — PWA** · manifest, icons, service worker, web push, install flow, iOS notes
**Phase 13 — AI** · assistant panel, tool schemas, proposal/approval flow, action history
**Phase 14 — hardening** · RLS audit, performance pass with seeded data, accessibility pass, e2e suite
**Phase 15 — production** · prod Supabase, Vercel project, domain, monitoring, backup/export

---

## Open questions before Phase 1

1. **Do you approve this architecture?** Anything you want changed, say so now — schema changes are cheap today and expensive in Phase 6.
2. **Accounts you already have:** GitHub? Vercel? Supabase? Anthropic API? I'll write exact sign-up steps for the missing ones.
3. **Domain:** `myday.acharyaandcollc.com`, or something else? And do we keep `task.acharyaandcollc.com` running in the meantime?
4. **Default look.** You said not everything purple. My proposal is a calm graphite base with a deep green accent, plus Midnight, Minimal White, Ocean, Forest, Sunset and Glass as presets, all recolourable. Say if you'd rather start somewhere else.
5. **Timezone and weather city** — I've assumed America/New_York and Gaithersburg, Maryland. Correct?
