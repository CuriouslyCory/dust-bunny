---
status: accepted
---

# Saved player data always has a migration path

Anything the game keeps for a player must survive a code change: the device save (`dust-bunny:save:v1`), the saved Run (the Save & quit slot, and its server copy once a paused Run can be picked up on another device), and the cloud save. A change to its shape that an older reader would misread (renaming, removing or retyping a field, or changing what a value means) bumps that data's version and adds a migration from every earlier version, tested against a stored example of the old shape. Adding a field with a sanitised default stays additive and needs no bump. Code that finds data from an *older* version migrates it; it never drops it or resets it. Code that finds data from a *newer* version (an old tab still open after a deploy, or a device running a cached build) leaves it untouched: no rewrite, no downgrade, no delete. Whatever it can't use is treated as unavailable until that page runs the newer build.

We decided this because Vercel deploys swap the build under players who still have the old one open. With saves shared between tabs and a paused Run moving between devices, two builds reading and writing the same data is a normal situation, not a rare one. Fluff, Hoards and a Run in progress are what players come back for, so losing them to a deploy costs far more than writing a migration.

## Considered options

- **Discard data from another version** (what `parseRunSnapshot` does today). Rejected: every snapshot version bump would silently cost each player with a saved Run that Run, and its Fluff would never be credited.
- **Force open tabs to reload on a new deploy.** Not enough on its own: offline devices and cached builds still meet newer data. It may still be added later to shorten the window.

## Consequences

Every value the game keeps in localStorage goes through one module, `VersionedStore` (`src/meta/versionedStore.ts`): the caller gives the key, the current version, a parse function and the migration steps, and the module runs the migrations, reads a newer version as far as it is understood without ever writing it, keeps a write storage refuses in memory, and reports `ok`, `newer` or `unavailable`. The device save, the saved Run slot, the known Runs, the Run credit claims and the credited Runs mirror all use it, so the rule is written and tested once.

Current code that didn't meet this, and how it was fixed or what remains:

- `migrate()` in `src/meta/save.ts` read a newer save as v1, which dropped fields it didn't know, and the next `save()` wrote that back. (Done, issue #66: `SaveStore` is on `VersionedStore`; with a newer save stored, `update`, `updateIf` and `save` refuse and say `newer`, the stored value is left byte for byte, and the player sees a banner saying nothing in that tab is saved until they reload. The cloud save neither connects nor uploads from such a tab.)
- The saved Run has `SNAPSHOT_VERSION` but no migration. Another version reads as no saved Run, and the slot deletes it (`src/meta/suspendedRun.ts`). A snapshot from an older version needs a migration step; one from a newer version must be left in the slot (and on the server). (Done with the Account's saved Run, ADR 0002: `migrateRunSnapshot` in `src/shared/savedRun.ts`, and the slot and server leave a newer one alone.)
- The cloud save (`Progress`, `src/shared/progress.ts`) has no version field. It changes additively today: `loadouts` is an example, where a copy without it means "unknown" and the other side's are kept. The server also converts old Hoard keys on read and write. Its first breaking change must add a version field, and the server, which always runs the newest build, migrates stored rows when it reads them.
