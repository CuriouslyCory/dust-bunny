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

Without a `.env`, `pnpm dev` serves only the game: there are no accounts and the game uses a local leaderboard stored in `localStorage`, labelled "Local only". Copy `.env.example` to `.env` and set `DATABASE_URL` (ideally a Neon branch, not production) and `BETTER_AUTH_SECRET`, and `pnpm dev` also serves the functions in `api/` (leaderboard, accounts, cloud save). Sign-in needs at least one provider's client id and secret, with `http://localhost:5173/api/auth/callback/<provider>` registered as a redirect URI. `TEST_DATABASE_URL=… pnpm test server` runs the API integration tests against a database; use a throwaway branch.

Project structure, the game loop, events and extension points are documented in `docs/architecture.md`.

## API

Vercel functions in `api/`, backed by Neon Postgres (`pg` with a pool, shared code in `server/`):

- `GET /api/leaderboard[?character=lint|tumble|zap]` returns `{ entries }`, the top 20.
- `POST /api/leaderboard` with `{ name, character, difficulty, maxRadius, debrisAbsorbed, tierReached, durationMs, victory, score }` returns `201 { entry, rank, nameCensored }`. The server validates the fields, recomputes the score (`src/shared/score.ts`, × the Difficulty's multiplier: Casual 1, Arcade 1.25, Hardcore 1.6; a missing `difficulty` counts as Casual), and rate-limits by hashed IP. All Difficulties share one board; each entry carries its `difficulty`, and `verified: true` when it was posted while signed in (otherwise it is anonymous). Errors come back as JSON `{ error, message, field? }`.
- `/api/auth/*`: accounts, through [Better Auth](https://better-auth.com) with Google and Discord sign-in (self-hosted, because Neon's managed Auth has no Discord). `GET /api/auth/providers` says which providers are configured.
- `GET /api/progress` / `PUT /api/progress`: the signed-in player's cloud save (Fluff, Upgrades, lifetime stats). A `PUT` with less lifetime Fluff than the stored copy is refused and the stored copy returned.

Tables are created on first request, and columns added since (`difficulty`, `user_id`) are added to an existing table the same way. `db/schema.sql` contains the same DDL if you want to apply it by hand.

## Deploying to Vercel

1. Import the GitHub repo into Vercel (Add New → Project). `vercel.json` sets the framework (Vite), `pnpm build` and the `dist` output, so no other settings are needed.
2. Add a database: in the project open **Storage → Marketplace → Neon → Connect**, create (or pick) a database and connect it to the project's environments. The integration sets `DATABASE_URL`. If you use an existing Neon project instead, add `DATABASE_URL` (the pooled connection string) under **Settings → Environment Variables**.
3. Accounts: set `BETTER_AUTH_SECRET` (`openssl rand -base64 32`), `BETTER_AUTH_URL` (the production origin, e.g. `https://dustbunny.example`) and the OAuth apps' `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`. Register `<origin>/api/auth/callback/google` and `<origin>/api/auth/callback/discord` as redirect URIs with each provider. A provider without both values is hidden; without the secret, accounts are off and everyone plays anonymously. See `.env.example`.
4. Optionally set `LEADERBOARD_IP_SALT` to a random string, and `SITE_URL` (e.g. `https://dustbunny.example`) if the site is served from a custom domain. Social-card image URLs are made absolute at build time from `SITE_URL`, falling back to Vercel's production domain.
5. Deploy (or redeploy after adding the env vars). If `DATABASE_URL` is missing, the API returns 503 and the game falls back to the local leaderboard.

### Preview database cleanup

When the Vercel integration creates a Neon branch named `preview/<git-branch>`,
[cleanup-neon.yml](.github/workflows/cleanup-neon.yml) deletes it when a same-repository
PR is merged or closed, or when its remote Git branch is deleted (even without a PR).
Tag deletions and fork PRs are ignored. The workflow only targets the exact preview
name, refuses default/protected database branches, and succeeds if the branch is
already gone. `production` and `vercel-dev` are outside its naming scope.

To enable it, merge the workflow into `main` and configure **GitHub repository
Settings → Secrets and variables → Actions**:

- Repository **variable** `NEON_PROJECT_ID`: the Vercel-connected Neon project's ID,
  from **Neon → Project Settings**.
- Repository **secret** `NEON_API_KEY`: a Neon API key with access to that project,
  from **Neon → Account Settings → API Keys**.

Missing configuration or Neon API errors fail the workflow so cleanup failures are
visible in Actions. It runs trusted base-branch code on PR closure and never checks
out the PR head. No database migrations or production deployment changes are needed.

Existing stale preview branches need a one-time cleanup in Neon; old merge/delete
events are not replayed. Deleting a preview database leaves retained Vercel preview
URLs unable to connect to it. See [Neon's preview cleanup guide](https://neon.com/docs/guides/vercel-branch-cleanup).
