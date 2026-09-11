# MYDAY

A personal command center. Tasks, notes, calendar, goals, habits and the day
ahead, in one place that's worth opening every morning.

## Running it

```bash
npm ci
cp .env.example .env.local   # fill in once Supabase is connected
npm run dev                  # http://localhost:3000
```

## Scripts

|                  |                                             |
| ---------------- | ------------------------------------------- |
| `npm run dev`    | development server                          |
| `npm run verify` | lint, typecheck, tests and production build |
| `npm run test`   | unit tests                                  |
| `npm run format` | Prettier across the repo                    |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · Supabase ·
Vercel. No secrets in the repository; everything sensitive is a Vercel
environment variable.

## Documents

- `ARCHITECTURE.md` — system design, database schema, security model, wireframes
- `PROGRESS.md` — what's built, what's next, decisions and why
- `CLAUDE.md` — standing instructions for AI sessions
