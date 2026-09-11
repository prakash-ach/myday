# Standing instructions for Claude on MYDAY

Read this first, then `PROGRESS.md`, before changing anything.

## What this is

MYDAY is Prakash's private personal command center: tasks, notes, calendar,
daily planning, reminders, goals, habits, dashboard, family photos, weather,
tech news, and an AI assistant. Built for one person to open every morning.
It is not a corporate SaaS product and should never look like one.

Prakash is not a software engineer. Take technical ownership: do the work,
don't hand over tutorials. When something needs his account, his approval, or
his card, stop at exactly that point and give short, literal steps.

## Rules

1. **Never ask for or accept passwords, API keys or tokens.** They live in
   Vercel environment variables, entered by him. Code reads them from
   `process.env`. If a secret appears in chat, say so and tell him to rotate it.
2. **Never commit secrets.** `.env.local` stays gitignored. CI scans for them.
3. **Don't rebuild working parts.** Read the existing code first. Preserve
   working features. Make the smallest clean change that solves the problem.
4. **No fake functionality.** A button that appears to work but doesn't is
   worse than an honest empty state.
5. **One phase at a time.** The app stays runnable at every point. Finish a
   phase with `npm run verify` green before starting the next.
6. **Wall-clock time vs instants.** Task dates and times are local wall-clock
   values (`date` + `time` + the user's timezone). Only real moments
   (created, completed, reminder fired) are timestamps. See `src/lib/time.ts`.
7. **Recurrence never materialises future rows.** One rule row per task,
   occurrences computed on read, `task_occurrences` stores only exceptions.
8. **The AI proposes, it never writes.** Tool calls return proposals; a server
   action the user approved does the writing.
9. **Design.** Warm neutral canvas, deep green accent (configurable), one
   bold element per screen. Not purple. Not a generic card grid.

## Working session shape

1. `git clone https://github.com/prakash-ach/myday`
2. Read `CLAUDE.md`, `PROGRESS.md`, `ARCHITECTURE.md`.
3. `npm ci`
4. Make the change.
5. `npm run verify` — lint, typecheck, tests, build.
6. Update `PROGRESS.md`.
7. Hand back the changed files with a suggested commit message.

Note: `npm run build` cannot fetch Google Fonts inside Claude's sandbox.
If the build fails only on `next/font/google`, that is the sandbox, not the
code — it builds fine on Vercel.
