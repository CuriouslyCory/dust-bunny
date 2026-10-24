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
- **Delete the row when the Run ends.** Rejected for the same reason: a device that fell behind could store a Run another device already ended and credited, and it would be offered (and credited) again. The row stays, marked ended and without a snapshot, until another Run is stored over it, and a late upload of the ended Run gets a 409. A delete for a Run the row doesn't hold yet (abandoned before its upload arrived) leaves the same record.

## Consequences

- One saved Run per Account, as there is one per browser. Saving a different Run over it counts the replaced one as a quit, whichever device does it.
- A Run is credited once: by the device that ends it, or by whoever abandons or replaces it. A device that loses a Run disposes it without `runEnded`.
- A copy of the Account's Run that the server had confirmed (mirrored into the slot by the title, say) is never credited by the device alone, because another device may be playing it by now. Replaced in the slot (pause, Save & quit), it is credited only from the server's answer to the replacing upload, which hands back a stored copy only if nobody had taken it. Abandoned by a new Run's start, it is credited only once the server confirms it deleted the row under the copy's lease.
- The title's read of the server is redone if it overlapped this page's Resume or New run, which send their take or delete outside the upload queue. A stale read could otherwise put back a Run just credited or taken.
- End run and Quit to title from pause credit the Run, so for a signed-in player they wait for the server take (with a short timeout when offline). So does a Run that ends by itself (died, victory) while that take is unconfirmed: `runEnded` waits, and if the take is refused the Run is not credited and the page steps aside.

## Known limits

Crediting is decided by several local rules on the client: the Account generation (`gen`), waiting out this page's own uploads (`settledTag`), the take confirmation before an ending (`confirmHeld` / `gateRunEnding`), the title read epoch, and the synced-copy rule above. No single server-side rule enforces it. Each rule closes one race, but a new interleaving of them can open another, and the known ones left are these narrow races:

- **A lost answer leaves a Run uncredited.** If the answer to an upload that replaces a server-confirmed copy never arrives, the replaced Run goes uncredited: one Run's Fluff is lost rather than credited twice. The same applies to a delete that abandons one. Both happen when the tab closes with the request still on its way, or when a retry lands after the first attempt already did.
- **Offline End run trusts the device.** End run, or a natural ending, waits for an unconfirmed take only up to a timeout. Offline past it, the device's word is taken, so a Run another device took in that window can be credited on both.
- **The server remembers only the last Run that ended.** A device that fell behind on Run A, while A ended and another Run B was stored from another device, can still store A over B when it reconnects (B counts as a quit). It needs offline play across a whole other Run's start.
- **Offline unpause vs another device's new Run.** A device unpauses while offline, so its take back is still waiting, and meanwhile another device stores a different Run over the Account's slot. When the first device reconnects, its Run is dropped uncredited. It needs offline play and a new Run on another device in the same window.

The follow-up that would end this whole class is to make the server the single authority for crediting. A Run would be credited only when the server confirms that this lease ended it, or that it replaced or deleted a stored copy (ideally with the credit recorded server-side, once per Run key). Clients would then no longer decide it from local state.
