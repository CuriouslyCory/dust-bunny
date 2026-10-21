# Dust Bunny

A three.js roguelike in the browser. You are a dust bunny rolling across a house floor: absorb Debris smaller than you to grow through five Tiers, avoid the cleaning Hazards until you can absorb them too, and absorb the Robo-Vac 9000. That opens the front door: roll out into the neighborhood, grow through two more Tiers among yard ornaments, bikes and parked cars, and absorb the Street Sweeper. That lifts the road barrier to the city: roll downtown among taxis, buses and skyscrapers, and finally absorb the Garbage Truck. Built with Vite + TypeScript; see `docs/design.md` for the game design.

## Controls

- Move: WASD / arrow keys, or click and hold to roll towards the cursor
- Dash: Space / Shift
- Pause: Esc / P
- Mute: M
- Touch: drag on the left side to steer (virtual joystick); tap the right side or the Dash button to dash

## Local development

Requires Node 22+ and pnpm.

```sh
pnpm install
pnpm dev          # http://localhost:5173 (add ?debug&autostart&seed=x for debug hooks)
pnpm test         # Vitest unit tests
pnpm build        # type-check (game + api) and build to dist/
pnpm sim          # headless balance bot
```

`pnpm dev` serves only the game. The leaderboard API isn't available there, so the game uses a local leaderboard stored in `localStorage` and labels it "Local only". To run the API locally, use `vercel dev` with `DATABASE_URL` set (see `.env.example`).

Project structure, the game loop, events and extension points are documented in `docs/architecture.md`.

## Leaderboard API

`api/leaderboard.ts` is a Vercel function backed by Neon Postgres (`@neondatabase/serverless`):

- `GET /api/leaderboard[?character=lint|tumble|zap]` returns `{ entries }`, the top 20.
- `POST /api/leaderboard` with `{ name, character, difficulty, maxRadius, debrisAbsorbed, tierReached, durationMs, victory, score }` returns `201 { entry, rank, nameCensored }`. The server validates the fields, recomputes the score (`src/shared/score.ts`, × the Difficulty's multiplier: Casual 1, Arcade 1.25, Hardcore 1.6; a missing `difficulty` counts as Casual), and rate-limits by hashed IP. All Difficulties share one board; each entry carries its `difficulty`. Errors come back as JSON `{ error, message, field? }`.

The table is created on first request, and columns added since (`difficulty`) are added to an existing table the same way. `db/schema.sql` contains the same DDL if you want to apply it by hand.

## Deploying to Vercel

1. Import the GitHub repo into Vercel (Add New → Project). `vercel.json` sets the framework (Vite), `pnpm build` and the `dist` output, so no other settings are needed.
2. Add a database: in the project open **Storage → Marketplace → Neon → Connect**, create (or pick) a database and connect it to the project's environments. The integration sets `DATABASE_URL`. If you use an existing Neon project instead, add `DATABASE_URL` (the pooled connection string) under **Settings → Environment Variables**.
3. Optionally set `LEADERBOARD_IP_SALT` to a random string, and `SITE_URL` (e.g. `https://dustbunny.example`) if the site is served from a custom domain. Social-card image URLs are made absolute at build time from `SITE_URL`, falling back to Vercel's production domain.
4. Deploy (or redeploy after adding the env vars). If `DATABASE_URL` is missing, the API returns 503 and the game falls back to the local leaderboard.
