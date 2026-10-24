---
status: accepted
---

# A signed-in player's saved Run is kept with the Account

Until now a saved Run (Save & quit, or a paused Run) lived only in the browser's slot (`dust-bunny:suspended-run:v1`): "it stays on the device", while Fluff, Upgrades, Hoards and Loadouts followed the Account. A player who paused on a laptop got a fresh title on their phone. A signed-in player's saved Run is now also kept on the server (`saved_runs`, `api/saved-run.ts`), one per Account, and the title on any of their devices offers it. Players without an Account keep the per-browser slot exactly as before.

The device slot stays and is written first, so pausing and Save & quit never wait for the network and still work offline. The server copy is the truth when the two disagree: the title mirrors it into the slot. Who may play a Run is decided by a lease on the server row (whoever stored it or last took it). Taking it is one atomic update on that lease, so two devices can't both resume it. Taking moves the lease and keeps the row, so a device that fell behind is refused later instead of playing a second copy. Unpausing is optimistic: play goes on at once and the take runs in the background. In the rare case where another device took the Run meanwhile, this device drops its copy without crediting it and says so, and what it played since unpausing is lost. Each copy on the device is tagged with the Account it belongs to, so one player's saved Run is never offered to (or credited to) another Account on a shared device. Snapshot versions follow ADR 0001: the server migrates older snapshots and stores newer ones as they are, and an older build leaves a newer one alone.

## Considered options

- **Keep saved Runs on the device only.** Rejected: it is the one part of a signed-in player's progress that didn't follow them, and a Run in progress is what they come back for.
- **Server only, no device slot.** Rejected: pausing, closing a tab and Save & quit would depend on the network, and players without an Account need the slot anyway.
- **Unpause waits for the server take.** Rejected: unpausing must never stall on the network. A refused take after the fact is rare, and dropping a few minutes of play once is better than adding delay to every unpause.
- **Delete the row when a device takes the Run.** Rejected: a device that fell behind (offline, or its take back still waiting) could then store its stale copy again as if nothing had happened. A row with a moved lease lets the server refuse it with a 409.

## Consequences

- One saved Run per Account, as there is one per browser. Saving a different Run over it counts the replaced one as a quit, whichever device does it.
- A Run is credited once: by the device that ends it, or by whoever abandons or replaces it. A device that loses a Run disposes it without `runEnded`.
- End run and Quit to title from pause credit the Run, so for a signed-in player they wait for the server take (with a short timeout when offline).
- Known gap: say a device unpauses while offline, so its take back is still waiting, and meanwhile another device stores a different Run over the Account's slot. When the first device reconnects, its Run is dropped uncredited. It needs offline play and a new Run on another device in the same window.
