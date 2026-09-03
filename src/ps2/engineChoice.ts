// Which of the two shipped Play! builds boots.
//
//   advanced  /play-mt/  — our fork. Up to six players, and the codegen fixes
//                          without which any game that installs a TLB exception
//                          handler (Shadow of the Colossus) dies mid-boot.
//   native    /play/     — upstream, unmodified. Two players, no speed counters.
//
// The choice is read once when the player mounts, because changing it re-sets the
// iframe's src and reloading the frame mid-session strands the input bridge on a
// canvas from a destroyed document. So it is picked on PS2 home, BEFORE a disc
// spins, and remembered — never asked again while a game is running.

export type Ps2Engine = "advanced" | "native";

const KEY = "asp.ps2.engine";

/** URL wins over the stored choice, so a test or a bug report can pin an engine.
 *  Both the old spellings (?engine=stock|multitap) and the UI's own names work. */
export function readEngine(search = location.search): Ps2Engine {
  const q = new URLSearchParams(search).get("engine");
  if (q === "stock" || q === "native") return "native";
  if (q === "multitap" || q === "advanced") return "advanced";
  try {
    if (localStorage.getItem(KEY) === "native") return "native";
  } catch {
    /* private mode — fall through to the default */
  }
  return "advanced";
}

export function writeEngine(e: Ps2Engine): void {
  try { localStorage.setItem(KEY, e); } catch { /* nothing to do if storage is blocked */ }
}

export const engineUrl = (e: Ps2Engine) => (e === "native" ? "/play/index.html" : "/play-mt/index.html");

// —— performance: EE clock scale ————————————————————————————————————————
//
// The PCSX2-style underclock, via the scaling Play! already ships for its
// arcade drivers. Fewer emulated CPU cycles per frame means a host that only
// manages 40% real-time reaches near-full speed; the game's own framerate drops
// instead, like a struggling real PS2. Measured on Shadow of the Colossus:
// full = 32–47% speed (slow motion), half = 48–78%, third = 70–98%.
//
// Advanced engine only — the native build has no setEeFreqScale binding, and
// the boot page guards the call, so on native this is silently a no-op.

export type Ps2Clock = "full" | "half" | "third";

const CLOCK_KEY = "asp.ps2.eeclock";

/** The EE frequency-scale denominator handed to Module.setEeFreqScale(1, den). */
export const clockDen = (c: Ps2Clock) => (c === "half" ? 2 : c === "third" ? 3 : 1);

export function readClock(search = location.search): Ps2Clock {
  const q = new URLSearchParams(search).get("eeclock");
  if (q === "2" || q === "half") return "half";
  if (q === "3" || q === "third") return "third";
  if (q === "1" || q === "full") return "full";
  try {
    const v = localStorage.getItem(CLOCK_KEY);
    if (v === "half" || v === "third") return v;
  } catch {
    /* private mode — fall through to the default */
  }
  return "full";
}

export function writeClock(c: Ps2Clock): void {
  try { localStorage.setItem(CLOCK_KEY, c); } catch { /* nothing to do if storage is blocked */ }
}

// —— internal render resolution ————————————————————————————————————————————
// The GS draws every framebuffer at N× the PS2's native size, so a 512×448 game
// becomes a clean 1024×896 or 1536×1344 picture — the same lever PCSX2 exposes.
// Advanced engine only: the binding lives in our fork (setResolutionFactor) and
// the boot page guards the call, so on native this is silently 1×. Read once at
// mount like the clock; the fork applies changes live, but re-reading here
// would mean re-setting the iframe src, which restarts the game.

export type Ps2Res = 1 | 2 | 3;

const RES_KEY = "asp.ps2.res";

export function readRes(search = location.search): Ps2Res {
  const q = new URLSearchParams(search).get("res");
  if (q === "2" || q === "3") return Number(q) as Ps2Res;
  if (q === "1") return 1;
  try {
    const v = localStorage.getItem(RES_KEY);
    if (v === "2" || v === "3") return Number(v) as Ps2Res;
  } catch {
    /* private mode — fall through to the default */
  }
  return 1;
}

export function writeRes(r: Ps2Res): void {
  try { localStorage.setItem(RES_KEY, String(r)); } catch { /* nothing to do if storage is blocked */ }
}
