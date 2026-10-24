---
status: accepted
---

# The server credits a signed-in player's Run, once, through a ledger

A Run is credited when its Fluff and lifetime stats (`MetaProgress.awardRun`) are added to the player's progress. Until now, for a signed-in player, *who* credits a Run was decided by several separate client rules (ADR 0002, "Known limits"): the Account generation, waiting out this page's uploads, the take confirmation before an ending, the title read epoch, and the synced-copy rule. Each closed one race and together they left four open: a lost answer left a Run uncredited; an offline End run past the timeout trusted the device, so a Run could be credited on two devices; the server remembered only the last Run that ended; and an offline unpause racing another device's new Run dropped the Run uncredited.

Two problems were tangled: **authority** (may this Run be credited, and by whom) and **idempotency** (apply the credit exactly once to a progress copy). They are now separate:

- **Authority is the server's.** A `run_credits` row, unique per `(user_id, run_key)`, is the only thing that means "this Run is credited". It is written when the device holding the Run claims its ending (`POST /api/run-credit`), or when the server itself replaces or abandons a stored copy. Nothing on the client decides it any more.
- **Idempotency lives in the progress copy.** `creditedRuns`, the newest Run keys whose credit a copy holds, is a field of the device save and of the cloud save (`Progress`). It is written in the same update as the Fluff it accounts for and adopted together with it, so whichever copy wins the cloud save's whole-copy merge carries the right set. Any device may apply any ledger row; `awardRun` is a no-op for a key the copy already lists.

The client still computes the Fluff from the Run's stats (`fluffForRun`) and the cloud save still carries it. The server stores only `reason` and a bounded stats subset.

Players without an Account are unchanged: they credit locally (now keyed by Run key, so the results screen and the `runEnded` listener can't credit twice).

## Data model

```sql
CREATE TABLE IF NOT EXISTS run_credits (
  id          bigserial   PRIMARY KEY,
  user_id     text        NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  run_key     text        NOT NULL,
  lease       text,                 -- the lease the Run ended under (the replaced copy's, for a replace)
  reason      text        NOT NULL CHECK (reason IN ('died', 'victory', 'quit')),
  stats       jsonb       NOT NULL, -- CreditStats (src/shared/runCredit.ts)
  credited_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, run_key)
);
CREATE INDEX IF NOT EXISTS run_credits_user_idx ON run_credits (user_id, id DESC);
ALTER TABLE player_progress ADD COLUMN IF NOT EXISTS credited_runs jsonb;  -- NULL: a row from before the ledger
```

Applied lazily by `ensureSchema` (`server/schema.ts`; the probe checks `run_credits`, its index and `credited_runs`) and mirrored in `db/schema.sql`. `saved_runs.ended_at` stays, for clients from before the ledger; the new path treats "ended" as "in the ledger" first.

`CreditStats` is what crediting reads: `maxRadius`, `debrisAbsorbed`, `tierReached` (required, bounded), and if present `characterId`, `difficulty`, `area`, the `*Cleared` flags that are true, and `areas` (≤ 16 of `{ area, radiusIn, maxRadius, debrisAbsorbed, cleared }`). `pickCreditStats` takes it out of a full `RunStats` or a stored snapshot's `stats`; a claim whose stats lack the three numbers is a 400.

## API

**`POST /api/run-credit`** body `{ runKey, lease, prevLease?, reason: 'died' | 'victory' | 'quit', stats }` (≤ 8 KB)
- `200 { credit: RunCredit, created: boolean }` with `RunCredit = { id, runKey, reason, stats, creditedAt }`.
- `409 carried_on`: the saved Run row holds `runKey` under a lease that is neither `lease` nor `prevLease`, and it hasn't ended. Nothing is written.
- `409 run_ended`: the row says `runKey` ended but the ledger has no row for it (a client from before the ledger ended and credited it itself). Nothing is written.
- 400 `invalid`, 401, 405, 413, 503 as the other functions.

Under the player's `saved_runs` row lock: a ledger row for `runKey` already there is returned, `created: false`, whatever the lease and whoever asks (a retry after a lost answer, or another device's claim for a Run already credited). Otherwise, if the row holds `runKey` under the caller's lease it is marked ended (snapshot cleared, `ended_at`), as DELETE did. If the row holds another Run, or none, nobody else can have this Run, so it is credited and recorded as the ended Run on an empty row (a Run still going on the row is left alone), as DELETE did. Then the row is inserted. A claim is therefore safe to send any number of times, from any device.

**`GET /api/run-credit?limit=20`** → `200 { credits: RunCredit[] }`, newest first, at most 50.

**`PUT /api/saved-run`** gains `ledger?: boolean` and `credits: RunCredit[]` in its 200 answer:
- A `runKey` in the ledger is refused with `409 run_ended`, whatever the row holds now.
- With `ledger: true`, replacing a different stored Run records that Run in the ledger as a quit, with its stored snapshot's stats, in the same transaction; the row comes back in `credits` (and still in `replaced`). Without the flag nothing is recorded and the caller credits `replaced` itself, as before.

`DELETE /api/saved-run` is unchanged and no longer used by ledger clients. `TODO(adr-0003)`: once every client sends `ledger`, drop `replaced` crediting and DELETE.

**`PUT /api/progress`** stores `creditedRuns` with the copy; a body without it keeps the stored set (like `loadouts`), and a row without one leaves it out of the answer.

### The `ledger: true` flag, and deploys

Vercel swaps the build under open tabs (ADR 0001). A tab from before the ledger credits a replaced Run from `replaced`, locally; if the server also wrote a ledger row for it, a new tab's sweep would credit it again. So the server writes a ledger row on a replace only when the uploading client says it credits through the ledger. Old tabs never claim, so their ended Runs never reach the ledger either.

## The client (the spec for src/meta)

**`awardRun(e: { runKey: string; reason: RunEndReason; stats: CreditStats }): RunAward | null`** returns null when `runKey` is already in `creditedRuns`. The check and the write happen inside one `store.update`, so two tabs applying the same credit (SaveStore read-modify-write, #51) can't both add it. `creditedRuns` keeps the newest `CREDITED_RUNS_MAX` (100) keys. `SaveData.creditedRuns: string[]` is additive (sanitised default `[]`, no `SAVE_VERSION` bump); `Progress.creditedRuns?` likewise, missing meaning unknown. `progressOf` includes it; `adopt` copies it in the same update as `fluff` and `stats`. The `awarded` WeakMap goes.

**Who credits, and when the player sees Fluff.**
- Signed out: locally, at once.
- Signed in, Run the server was never told about (no upload of it was ever queued while signed in, or it is `localOnly`): locally, at once, *and* a claim is recorded (its answer is then a no-op). Sound because no other device can hold a Run the server never saw. This is the common Run.
- Signed in, Run the server knows: deferred to the server's answer. The results screen does not block: it renders `+X Fluff` from `fluffForRun` at once, marked pending while the claim is outstanding, and updates the total when the credit lands (`fluffAwarded` gains `pending: boolean`; it fires again with `pending: false`). Online that is usually under a second; offline it reads "added when you're back online". Provisional crediting with a later revoke was rejected: it would subtract Fluff possibly spent and lower `totalFluffEarned`, which also flips the cloud merge.
- The device slot's replace (pause, Save & quit over another Run), New run's abandon, and the title's "server copy wins" branch all become claims with `reason: 'quit'` for a signed-in Account copy. The server's answer credits or refuses.

**The durable claim queue** (`src/meta/runCredits.ts`, key `dust-bunny:run-credits:v1`): `{ version: 1, claims: PendingClaim[] }`, `PendingClaim = { userId, runKey, lease, prevLease?, reason, stats, at }`. A claim is written before its request goes out and removed on a definite answer (200 or 409); it is replayed on page load, when the browser comes back online, after an Account switch to its `userId`, and flushed with `keepalive` on `pagehide`. Claims for another Account wait. A newer `version` is left untouched (ADR 0001). Two tabs replaying one claim is harmless (the server returns one row; `creditedRuns` applies it once).

**The sweep** applies ledger rows the copy missed (a lost answer to a replace; another device's replace; a Run the merge dropped): `GET /api/run-credit` (20 newest), apply each row whose key is not in `creditedRuns`. It runs from `syncTitle` after this page's work has settled, and after the queue drains following a network error. 100 remembered against 20 fetched keeps a once-applied row from being applied again after its key aged out.

**With the cloud save's merge.** The merge replaces a whole copy (the one with more `totalFluffEarned` wins). Double counting would need a copy holding a credit's Fluff without its key, which `awardRun` and `adopt` make impossible by writing both together. The reverse is a gain: today two devices crediting different Runs offline lose the loser's Run in the merge; now its ledger row is missing from the winning copy's `creditedRuns`, so the next sweep applies it.

**Redundant rules to delete:** `confirmHeld`, `unconfirmed`, `lostKeys`, `gateRunEnding`, `Run.endGate` and its gate in `Run.end`, the "Checking your Run…" toast, the `confirmHeld` step in `Game.endRun` (the cross-tab `handoff.takeBack()` stays), `creditsReplacedOnDevice`, `creditsOnServer`, the branching in `abandonSavedRun`, `prevLocalKey`, the `end` Op and its `credit`, the `replaced` crediting in `send` (apply the answer's `credits` instead), the `awardRun` branch in `syncTitle`, `SavedRunApi.end`, `MetaProgress.awarded`. `gen`, `titleEpoch`, `settledTag`, the `synced` tag and `lose()` stay: they decide who *plays* a Run and what the slot mirrors, not credit.

## The four races

1. **A lost answer.** The replace or abandon already wrote the ledger row; the device's durable claim, or the next sweep, gets the same row and applies it. Closed.
2. **Offline End run past the timeout.** No timeout and no device's word: the claim waits for the server, which checks the lease. A Run another device took is refused and not credited here. Closed; Fluff is deferred while offline.
3. **Only the last ended Run remembered.** PUT consults the ledger, so a late upload of A is refused whatever the row holds. Closed.
4. **Offline unpause vs another device's new Run.** B's upload replaces A's stored copy and records A as a quit; A's take is refused on reconnect and it steps aside (what it played since unpausing is still lost, as ADR 0002 accepts), but A's Run is credited once, by the sweep, rather than dropped. Closed as "credited, not dropped".

## Considered options

- **The server applies the credit to `player_progress` itself.** Rejected: it needs `fluffForRun` on the server, a row that may not exist yet (a device signing in with local progress would then win the merge and drop the credit), and Fluff would arrive by the sync round-trip rather than at once.
- **Award provisionally, reconcile later.** Rejected (above): revoking is lossy and fights the merge.
- **A server-side "applied" mark instead of `creditedRuns`.** Rejected: an ack can be lost like any answer, and the mark must travel with the copy the credit went into, which only a field in the copy does.
- **An id cursor in `Progress` instead of the 100/20 ratio.** Rejected for now: a claim applied directly can't advance a cursor past rows it never fetched.

## Consequences

- A paused-then-finished Run's Fluff, for a signed-in player, is confirmed by the server; offline it is shown as pending and lands on reconnect. Every other Run is credited at once as before.
- The ledger is a complete history of credited Runs per Account, so a device that falls behind by any number of Runs is refused, not just by one.
- The save and the cloud save grow by at most ~4 KB (`creditedRuns`).
- Out of scope: Fluff arithmetic on the server; gating leaderboard posts on credit; migrating Runs ended before the ledger (their tombstones stay); Keepsake credits.

## Test plan

Server (`server/api.test.ts`, against a throwaway `postgres:16` via `TEST_DATABASE_URL`): claim by the holder (200, `created`, row ended, picked stats); a retry and another lease's claim return the same row; another device's claim while held → 409 and nothing written; a never-uploaded Run → 200 without touching a stored Run; a Run an old client ended → 409 `run_ended`; replace with and without `ledger`; a ledgered Run refused on PUT whatever the row holds; racing claims create one row; the list's order and bounds; body validation and the 8 KB cap; `credited_runs` kept when an upload omits it; the schema probe false → DDL → true.

Client (`src/meta/accountRun.test.ts` with its `FakeServer` extended with a ledger, plus `meta.test.ts`, `cloudSave.test.ts`, `runCredits.test.ts`): one test per race; a lost claim answer credits once; two devices sweeping one row credit once; `awardRun` idempotent by key, capped; `adopt` carries `creditedRuns`; the merge-loss repair; the queue's replay on load, other-Account claims waiting, a newer version untouched.
