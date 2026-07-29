# PS2 multitap — the console side

The emulator work lives in a **separate repository**:
**https://github.com/AbhishekD879/Play- · branch `multitap`**
— a true GitHub fork of [jpd002/Play-](https://github.com/jpd002/Play-), so
lineage is visible, `git fetch upstream` works out of the box, and the clean
patches (P1–P4) can be offered upstream with one click.
Local clone: `~/src/Play-` (`origin` = the fork, `upstream` = jpd002). Its `docs/` holds the spec, the patch register and
the upstream sync runbook. Nothing in this repo needs the emulator source — only
its build output.

## What lives here

| Path | Role |
|---|---|
| `public/play/` | **STOCK** engine — unmodified upstream. Two controllers. Never edit. |
| `public/play-mt/` | **FORK** engine — built `Play.js` + `Play.wasm` + `index.html` + `LICENSE`. Up to six players. |
| `src/ps2/engineRouter.ts` | Picks which engine boots, with fallback to stock |
| `src/ps2/players.ts` | Seat model: who is in which controller slot |

## Routing

Decided **once, before the disc boots** — the wasm module and its VM are built at
page load, and a game latches its controller-slot count during init.

- 1–2 players → `stock`
- 3–6 players → `multitap`
- fork missing or failing → **fall back to stock**, capped at 2

So a bad fork build degrades to "6-player unavailable", never "PS2 broken".

## Pad numbering

With a tap present the flat pad index is `port * 4 + slot`:

| Player | Pad index | Port | Slot | Config name |
|---|---|---|---|---|
| 1 | 0 | 0 | 0 | `input.pad1` |
| 2 | 1 | 0 | 1 | `input.pad2` |
| 3 | 2 | 0 | 2 | `input.pad3` |
| 4 | 3 | 0 | 3 | `input.pad4` |
| 5 | 4 | 1 | 0 | `input.pad5` |
| 6 | 5 | 1 | 1 | `input.pad6` |

Six players therefore needs a tap on **both** ports (4 + 2). Player 2 keeps the
same keyIds it has on the stock engine, so the existing 2-player injector works
against either build unchanged.

## Updating the engine

```bash
cd ~/src/Play-                      # branch: multitap
emcmake cmake --preset wasm-ninja
cmake --build --preset wasm-ninja-release
cp build_cmake/build/wasm-ninja/Source/ui_js/Release/Play.{js,wasm} \
   <this repo>/public/play-mt/
```

`public/play-mt/index.html` is **ours**, not upstream's — it writes the 6-pad
input profile and calls `setMultitapEnabled` before boot. Do not overwrite it
from the fork.

## Party — roster, chat, voice

Everyone in an online room can see who joined, type to each other, and talk.
Files: `src/ps2mp/party.ts` (protocol + pure logic, self-checked by
`party.test.ts`), `src/ps2mp/voice.ts` (audio), `src/xmb/PartyPanel.tsx` (the
column), wired in `src/xmb/Ps2.tsx`.

Three rules the implementation depends on:

1. **One channel.** Roster and chat ride the existing input data channel. A
   second channel could be open while input is not, giving two answers to "is
   this player connected".
2. **The host is the only authority.** Joiners send `hello` / `say` / `mic`; the
   host stamps, cleans and fans out `roster` / `said` / `you`. The roster is
   derived from the seat map that already routes input (`ps2/netSeats.ts`), so
   the list on screen cannot disagree with which pad a player is holding.
3. **The host is an audio mixer, not a forwarder.** Each joiner gets a
   `MediaStreamAudioDestinationNode` created at connect time, added alongside the
   video in the *first* offer, carrying everyone except that joiner. Joining,
   leaving, muting and unmuting are edges in a WebAudio graph — the peer
   connection carrying the game never renegotiates.

Two things that are load-bearing and look removable:

- A joiner's mic goes on the transceiver **the offer created**, adopted after
  `setRemoteDescription`. Adding one earlier puts an m-line in the answer that
  the offer never had, which breaks every host that offers no audio — the phone
  controller and retro netplay both do.
- The host attaches each remote stream to a real `<audio>` element. Chrome does
  not decode a remote peer-connection track that only feeds WebAudio, so without
  it the mixes are silent and every meter reads zero on a live track.

## Testing it without a human

The two real ways to insert a disc — `showOpenFilePicker` and a library record —
cannot be driven from an automated browser. `import.meta.env.DEV` adds
`#devdisc`, a hidden file input that boots straight into the PS2 app, bypassing
the library so a 4GB ISO is never copied into IndexedDB:

```js
// Playwright, against `npm run dev`
await page.locator('#devdisc').evaluate(el => el.dataset.players = '3');
await page.locator('#devdisc').setInputFiles('/path/to/game.iso');
// ~30s later: playing. Then "Play online" hosts, and .party-code holds the code.
```

`window.__voice.dump()` (host) reports the audio graph — context state, sources,
mixes, live levels, track states — and `window.__pcs` is a bounded ring of live
`RTCPeerConnection`s for `getStats()`. Both DEV-only, both stripped from
production builds.

## The Online screen, rebuilt

Every control follows one rule: **the console's own button glyph, then a verb,
then the object** — so a control reads as a sentence about what will happen. The
row that read `WWE SmackDown! Here Comes th…   HOST` was three ambiguous things
at once: a title cut off mid-word, and a dim label that could have been a status
or a button.

| Piece | Where | Note |
|---|---|---|
| `SeatPicker` | `src/xmb/SeatPicker.tsx` | quantity as the headline, seats as sockets, port seam + braces |
| `seatPlan()` | `src/ps2/seatPlan.ts` | the port arithmetic, self-checked; mirrors `tapsFor()` |
| `.oact` rows | `src/styles.css` | glyph · verb · object, with the facts dimmed on the right |
| room row | `Online.tsx` | occupancy as numbered pads, watchers column, two actions |
| invite | `Online.tsx` | code + link, minted before the room exists |
| `#/room/CODE` | `XMB.tsx` `parseRouteHash` | opens straight into the room as a player |

Three things that are easy to get wrong here:

- **The seat split is not always 4|2.** Two players sit on the console's own two
  ports with a pad each and no multitap — which is what `tapsFor()` already
  encoded. Above two, a multitap on port 1 carries 1–4 and port 2 takes 5–6.
  `seatPlan()` is the single source for both the drawing and the sentence.
- **The directory's `seats`/`max` count REMOTE seats only.** The host is in
  neither number, so drawing just those made an occupied room look empty. The row
  draws pad 1 explicitly and always taken.
- **`:empty` does not match an empty string.** `{n > 0 ? "…" : ""}` still renders
  a text node, so the watchers cell held a grid column open and pushed a line
  into every room row. Use `<Show>` and render nothing.

Responsive: verified 1440 / 1024 / 768 / 430 / 390 / 360 / 320 with no horizontal
scroll at any width. The seat braces get their widths from the same two custom
properties the seats do (`--seat`, `--seat-gap`), so they stay glued to the seats
at any size and either split — no magic numbers to drift.
