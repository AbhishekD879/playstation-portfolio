# Per-game emulator builds

## Why

Most PS2 compatibility work is data: a clock, a resolution, one of Play!'s
GameConfig knobs. That lives in `src/ps2knobs.ts` and the KV table behind
`/api/ps2cfg`, and it is always the first thing to try.

Some games need a change to the emulator itself. Batman Begins hung because
Play! only reported `GIF_STAT.OPH` once a packet had been processed; that fix
was safe for everything and went into the shared core. The follow-on fix for
its glow pass is not safe for everything — it changes how *any* game that
samples its own render target draws.

Putting that in the one core every disc boots makes one game's fix every
game's risk. So a game that needs emulator changes gets its own build, from its
own branch of the fork, and only discs matched to it ever load it.

**Order of preference, always:** a knob, then a shipped-override setting, then a
tuned core. A core is the expensive option — another 2.3 MB to deploy and
another branch to rebase — and it is only worth it when nothing else can work.

## How a disc reaches its build

1. `src/ps2/tunedCores.ts` — `TUNED_CORES` lists every build that exists: its
   id, the fork branch that produces it, and why it cannot be shared.
2. An override in `src/ps2knobs.ts` or the KV table names a `core` for a title
   id. The id is validated against `TUNED_CORES` on both sides
   (`sanitiseOverride`, and again in `functions/api/ps2cfg.ts`).
3. `Ps2.tsx` → `routeAndBoot` reads the disc's title id when it is inserted,
   looks up the override, HEAD-checks that the build is really deployed, and
   re-points the emulator frame if so.

Three things follow from that, and they are the point of the design:

- **The registry is code, not data.** The core id becomes a URL the emulator
  frame loads and it arrives from a hand-edited KV blob. If it were a free
  string, a bad write would point the frame at an arbitrary path. KV only gets
  to choose among builds we already ship.
- **A missing build degrades to the shared core**, never to a blank screen —
  the same guarantee `multitapAvailable()` gives for the multitap engine.
- **Routing happens at insert, and only then.** The title id does not exist
  until a disc is in, and re-pointing the frame is safe only before a game is
  running: the `play-ready` handshake that boots a pending disc also
  re-establishes the input bridge. Swapping mid-session would strand that
  bridge on a canvas from a destroyed document.

The cost is one extra frame load — a few seconds of wasm compile — for tuned
games only.

## Adding one

On the fork (`~/src/Play-`):

```
git checkout -b tuned/<title-id> <base>      # base is what the shared core ships
# ... the change ...
emcmake cmake -S . -B build_wasm_<id> -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_PSFPLAYER=OFF -DBUILD_TESTS=OFF -DUSE_QT=OFF
cd build_wasm_<id> && ninja Play
```

In the site repo:

```
mkdir -p public/play-<id>
cp ~/src/Play-/build_wasm_<id>/Source/ui_js/Play.{js,wasm,js.symbols} public/play-<id>/
cp public/play-mt/index.html public/play-mt/worker-trap-shim.js public/play-<id>/
```

The boot page is shared verbatim — a tuned core differs in the wasm, not in the
page around it. Then add the entry to `TUNED_CORES`, add the id to the set in
`functions/api/ps2cfg.ts`, and point the title at it with a `core` override.

Record the base commit in the registry entry's `branch` field so the branch can
be rebased when the shared core moves. A tuned core that has drifted behind the
shared one is worse than no tuned core.

## Before pointing a game at a build

Compare it against the shared core **on that game**, and only route the disc if
the tuned build is actually better. Rendering more of what a game asks for is
not automatically an improvement: the Batman Begins glow build draws the effect
the shared core drops, and also saturates some frames to white, which is why no
disc points at it yet.

Watch the measurement too. Screenshot brightness across a scripted playthrough
varies enough between runs of the *same* build — it depends where the automation
ends up standing — to swamp small differences. Fix the camera or count over many
more frames before reading a change as progress.
