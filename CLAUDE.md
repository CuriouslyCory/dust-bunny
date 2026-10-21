# Dust Bunny

A three.js roguelike where the player is a dust bunny that grows by absorbing floor debris while avoiding cleaning hazards. Built with Vite + TypeScript, deployed as a static site (plus optional serverless API) on Vercel.

## Commands

- `pnpm dev`: Vite dev server (`/?debug&autostart&seed=x` for debug hooks)
- `pnpm build`: `tsc --noEmit && vite build` → `dist/`
- `pnpm test`: Vitest unit tests (`pnpm typecheck` for types only)
- `pnpm sim`: headless balance bot that prints Tier timings

Read `docs/architecture.md` first. It covers the module map, game loop, events, extension points (Hazards, Pickups, Perks, screens, models) and debug hooks.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `CuriouslyCory/dust-bunny`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
