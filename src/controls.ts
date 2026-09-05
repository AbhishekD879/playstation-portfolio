// "How do I play this?" — one answer per engine and device. Desktop keys and
// what the mouse does, whether a controller just works, what appears on touch
// and which way to hold the phone. Pure data + a lookup, so a test can prove
// every system and every web game has an answer. Shown as the Controls card
// (src/emulator/ControlsCard.tsx): automatically the first time a system
// boots, then one tap ("controls" / "?") away.
//
// EmulatorJS 4.2.3 keyboard defaults (RetroPad → key): B=X · A=Z · Y=S · X=A ·
// L=Q · R=E · L2=Tab · R2=R · Select=V · Start=Enter · d-pad=arrows ·
// left stick F/H (x) T/G (y) · right stick J/L (x) I/K (y). The cards below
// translate that into each console's own button names.

export type Orientation = "landscape" | "either";

export interface ControlScheme {
  keys: readonly (readonly [string, string])[];  // [key(s), what it does] — desktop keyboard
  mouse?: string;                                // what the mouse does, when it does anything
  pad: string;                                   // controller story
  touch: string;                                 // what a phone/tablet shows and how to play
  orientation: Orientation;                      // how to hold a phone
  rebind?: string;                               // where to change the bindings
  tip?: string;                                  // one line that saves a session of guessing
}

const EJS_PAD = "Plug in a controller and it just works — player one is the first pad that presses a button; Nintendo-style A/B and PlayStation ✕/○ land on the right face buttons.";
const EJS_TOUCH = "A virtual gamepad appears over the game (toggle it under the emulator menu → Settings → Virtual Gamepad).";
const EJS_REBIND = "Emulator menu (hover the bottom of the game) → Control Settings.";
const DPAD: readonly [string, string] = ["← ↑ → ↓", "d-pad"];
const START_SELECT: readonly (readonly [string, string])[] = [["Enter", "Start"], ["V", "Select"]];
const LSTICK: readonly [string, string] = ["F · H · T · G", "left stick (left · right · up · down)"];
const RSTICK: readonly [string, string] = ["J · L · I · K", "right stick (left · right · up · down)"];

const ejs = (keys: ControlScheme["keys"], orientation: Orientation, extra: Partial<ControlScheme> = {}): ControlScheme => ({
  keys, pad: EJS_PAD, touch: EJS_TOUCH, orientation, rebind: EJS_REBIND, ...extra,
});

const NINTENDO_AB: readonly (readonly [string, string])[] = [DPAD, ["Z", "A"], ["X", "B"], ...START_SELECT];
const PS_FACE: readonly (readonly [string, string])[] = [DPAD, ["X", "✕ Cross"], ["Z", "○ Circle"], ["S", "□ Square"], ["A", "△ Triangle"]];

export const SCHEMES: Record<string, ControlScheme> = {
  // —— Nintendo ——
  nes: ejs(NINTENDO_AB, "landscape"),
  snes: ejs([DPAD, ["Z", "A"], ["X", "B"], ["A", "X"], ["S", "Y"], ["Q", "L"], ["E", "R"], ...START_SELECT], "landscape"),
  gb: ejs(NINTENDO_AB, "either", { touch: `${EJS_TOUCH} Upright works well for the Game Boy screen.` }),
  gba: ejs([DPAD, ["Z", "A"], ["X", "B"], ["Q", "L"], ["E", "R"], ...START_SELECT], "either"),
  nds: ejs([DPAD, ["Z", "A"], ["X", "B"], ["A", "X"], ["S", "Y"], ["Q", "L"], ["E", "R"], ...START_SELECT], "either",
    { mouse: "Click and drag on the lower screen — that is the stylus.", touch: `${EJS_TOUCH} Tap the lower screen directly as the stylus.` }),
  n64: ejs([DPAD, LSTICK, ["Z", "A"], ["X", "B"], ["Tab", "Z trigger"], ["Q", "L"], ["E", "R"], ["J · L · I · K", "C buttons"], ["Enter", "Start"]], "landscape",
    { tip: "Most N64 games walk with the analog stick — that is F/H/T/G on the keyboard, or the left stick on a pad." }),
  vb: ejs([DPAD, ["Z", "A"], ["X", "B"], ["Q", "L"], ["E", "R"], ["J · L · I · K", "right d-pad"], ...START_SELECT], "landscape"),
  // —— Sony ——
  psx: ejs([...PS_FACE, ["Q", "L1"], ["E", "R1"], ["Tab", "L2"], ["R", "R2"], LSTICK, RSTICK, ...START_SELECT], "landscape"),
  psp: ejs([...PS_FACE, ["Q", "L"], ["E", "R"], ["F · H · T · G", "analog nub"], ...START_SELECT], "landscape"),
  ps2: {
    keys: [DPAD, ["Z", "✕ Cross"], ["X", "○ Circle"], ["A", "□ Square"], ["S", "△ Triangle"], ["1 · 8", "L1 · R1"], ["2 · 9", "L2 · R2"], ["3 · 0", "L3 · R3"], ["F · H · T · G", "left stick"], ["J · L · I · K", "right stick"], ["Enter", "Start"], ["Backspace", "Select"]],
    pad: "A controller works out of the box, mapped like a DualShock; a second pad joins as player two.",
    touch: "An on-screen pad (d-pad left, face buttons right, Start/Select in the middle) appears on phones and tablets.",
    orientation: "landscape",
    rebind: "Fixed layout — the emulator's own menu is not exposed in this build.",
  },
  // —— Sega ——
  segaMD: ejs([DPAD, ["S", "A"], ["X", "B"], ["Z", "C"], ["Q", "X"], ["A", "Y"], ["E", "Z"], ["Enter", "Start"], ["V", "Mode"]], "landscape"),
  sega32x: ejs([DPAD, ["S", "A"], ["X", "B"], ["Z", "C"], ["Q", "X"], ["A", "Y"], ["E", "Z"], ["Enter", "Start"], ["V", "Mode"]], "landscape"),
  segaCD: ejs([DPAD, ["S", "A"], ["X", "B"], ["Z", "C"], ["Enter", "Start"], ["V", "Mode"]], "landscape"),
  segaMS: ejs([DPAD, ["X", "button 1"], ["Z", "button 2"], ["Enter", "Pause"]], "landscape"),
  segaGG: ejs([DPAD, ["X", "button 1"], ["Z", "button 2"], ["Enter", "Start"]], "either"),
  segaSaturn: ejs([DPAD, ["S", "A"], ["X", "B"], ["Z", "C"], ["Q", "X"], ["A", "Y"], ["E", "Z"], ["Tab", "L"], ["R", "R"], ["Enter", "Start"]], "landscape"),
  dreamcast: ejs([DPAD, ["Z", "A"], ["X", "B"], ["S", "X"], ["A", "Y"], ["Tab", "L trigger"], ["R", "R trigger"], LSTICK, ["Enter", "Start"]], "landscape"),
  // —— arcade ——
  arcade: ejs([DPAD, ["Z · X · S · A · Q · E", "buttons 1–6"], ["V", "insert coin"], ["Enter", "Start (player 1)"]], "landscape",
    { tip: "Nothing happens until you insert a coin: press V, then Enter." }),
  mame: ejs([DPAD, ["Z · X · S · A · Q · E", "buttons 1–6"], ["V", "insert coin"], ["Enter", "Start (player 1)"]], "landscape",
    { tip: "Nothing happens until you insert a coin: press V, then Enter." }),
  // —— other consoles ——
  atari2600: ejs([DPAD, ["X", "fire"], ["Enter", "Game Reset (start)"], ["V", "Game Select"]], "landscape",
    { tip: "Many 2600 games start with Game Reset — that is Enter here." }),
  atari5200: ejs([DPAD, ["X", "fire"], ["Z", "second button"], ["Enter", "Start"], ["V", "Select"]], "landscape"),
  atari7800: ejs([DPAD, ["X", "button 1"], ["Z", "button 2"], ["Enter", "Reset / start"], ["V", "Select"]], "landscape"),
  lynx: ejs([DPAD, ["Z", "A"], ["X", "B"], ["Q", "Option 1"], ["E", "Option 2"], ["Enter", "Pause"]], "either"),
  jaguar: ejs([DPAD, ["Z", "A"], ["X", "B"], ["S", "C"], ["Enter", "Pause"], ["V", "Option"]], "landscape"),
  pce: ejs([DPAD, ["Z", "I"], ["X", "II"], ["Enter", "Run"], ["V", "Select"]], "landscape"),
  pcfx: ejs([DPAD, ["Z", "I"], ["X", "II"], ["S", "III"], ["A", "IV"], ["Q", "V"], ["E", "VI"], ["Enter", "Run"], ["V", "Select"]], "landscape"),
  ngp: ejs([DPAD, ["X", "A"], ["Z", "B"], ["Enter", "Option"]], "either"),
  ws: ejs([["← ↑ → ↓", "X pad"], ["J · L · I · K", "Y pad"], ["Z", "A"], ["X", "B"], ["Enter", "Start"]], "either",
    { tip: "Vertical games use the second pad (J · L · I · K) — rotate the phone if the picture is sideways." }),
  coleco: ejs([DPAD, ["X", "left fire"], ["Z", "right fire"], ["Enter", "1 (start)"], ["V", "#"], ["1–9 · 0", "keypad"]], "landscape"),
  "3do": ejs([DPAD, ["Z", "A"], ["X", "B"], ["S", "C"], ["Q", "L"], ["E", "R"], ["Enter", "P (pause)"], ["V", "X (stop)"]], "landscape"),
  // —— computers ——
  c64: ejs([DPAD, ["X", "joystick fire"], ["your keyboard", "the C64's keys — type normally"], ["V", "on-screen keyboard"], ["Enter", "Return"]], "landscape",
    { mouse: "Not used.", tip: "Most games say “press fire” or a key to start; joystick is port 2 on the arrows + X." }),
  amiga: ejs([DPAD, ["X", "joystick fire"], ["your keyboard", "the Amiga's keys"], ["V", "on-screen keyboard"]], "landscape",
    { mouse: "Moves the Workbench pointer.", tip: "Games boot from the disk automatically; give the AROS ROM a few seconds." }),
  zx: ejs([["your keyboard", "the Spectrum's keys — type normally"], DPAD, ["X", "fire (Kempston joystick)"], ["V", "on-screen keyboard"]], "landscape",
    { tip: "Many tapes want a key like “1” or “P” to start — the loading screen tells you which." }),
  cpc: ejs([["your keyboard", "the CPC's keys — type normally"], DPAD, ["X", "joystick fire"], ["V", "on-screen keyboard"]], "landscape"),
  x86: {
    keys: [["your keyboard", "goes straight to the PC"], ["Esc / Ctrl / Alt", "as on a real PC"]],
    mouse: "Click the screen once to hand it your mouse; Esc releases it.",
    pad: "No controller — this is a PC.",
    touch: "Tap the ⌨ keyboard button to type; drag on the screen to move the pointer.",
    orientation: "landscape",
  },
  // —— mobile ——
  palm: {
    keys: [["your keyboard", "types into the Palm (Graffiti area not needed)"], ["← ↑ → ↓", "d-pad on devices that have one"]],
    mouse: "Click and drag on the screen — that is the stylus.",
    pad: "Not used.",
    touch: "Tap and drag on the screen exactly like the stylus; the device's hard buttons are drawn below it.",
    orientation: "either",
  },
  j2me: {
    keys: [["← ↑ → ↓", "phone d-pad"], ["Enter", "select / fire (5)"], ["0–9 · * · #", "phone keypad"], ["Q · W", "left / right soft keys"]],
    pad: "Not used.",
    touch: "A phone keypad is drawn under the screen; tap the screen for touch-enabled games.",
    orientation: "either",
    tip: "Java ME opens in its own tab; close the tab to come back.",
  },
  // —— fantasy ——
  wasm4: {
    keys: [["← ↑ → ↓", "d-pad"], ["X", "button 1"], ["Z", "button 2"], ["2 · 3 · 4", "players two to four take the pad"]],
    pad: "A controller works out of the box.",
    touch: "A virtual gamepad appears under the picture.",
    orientation: "either",
    tip: "Two buttons only — X and Z are the whole controller.",
  },
  // —— web games under PC Games ——
  micropolis: {
    keys: [["Esc", "close a dialog"]],
    mouse: "Everything is the mouse: pick a tool on the left, click and drag on the map, scroll to zoom.",
    pad: "Not used.",
    touch: "Tap to build, drag the map, pinch to zoom.",
    orientation: "landscape",
  },
  jazz: {
    keys: [["← →", "run"], ["↑ ↓", "look up / crouch"], ["Space", "jump / swim"], ["Alt", "fire"], ["right Ctrl", "change weapon"], ["1 · 2 · 3", "blaster · toaster · missiles"], ["Enter · Esc", "menus"], ["P", "pause"]],
    pad: "Not used in this build.",
    touch: "Keyboard only — pair a keyboard or play on a computer.",
    orientation: "landscape",
    rebind: "In-game menu → Setup Options → Controls.",
  },
  jazz2: {
    keys: [["← ↑ → ↓", "move"], ["Space", "jump"], ["V", "fire"], ["C", "change weapon"], ["X", "run"], ["Enter", "select / menus"], ["Esc", "menu"]],
    pad: "A controller works.",
    touch: "On-screen controls are drawn by the game.",
    orientation: "landscape",
    rebind: "Options → Controls in the game (these are its defaults).",
  },
  wolf: {
    keys: [["← ↑ → ↓", "move and turn"], ["Ctrl", "fire"], ["Space", "open doors"], ["Shift", "run"], ["Alt", "strafe"], ["1 – 4", "weapons"], ["Esc", "menu"]],
    mouse: "Click the picture to capture the mouse: turn and fire.",
    pad: "Not used.",
    touch: "Keyboard only — pair a keyboard or play on a computer.",
    orientation: "landscape",
  },
  quake: {
    keys: [["W A S D · ← ↑ → ↓", "move"], ["Ctrl", "fire"], ["Space", "jump"], ["Tab", "scores"], ["Esc", "menu"], ["1 – 8", "weapons"]],
    mouse: "Click the picture to capture the mouse: look and fire.",
    pad: "Not used.",
    touch: "Tick “touch controls” on the start screen for on-screen buttons.",
    orientation: "landscape",
  },
  openttd: {
    keys: [["Esc", "close windows"], ["F1 – F12", "toolbar shortcuts"], ["Space", "pause"]],
    mouse: "Left click selects and builds, right-drag scrolls the map, wheel zooms.",
    pad: "Not used.",
    touch: "Tap to click, drag to scroll, pinch to zoom.",
    orientation: "landscape",
  },
  diablo: {
    keys: [["1 – 8", "belt items"], ["S", "spellbook"], ["I", "inventory"], ["C", "character"], ["Q", "quests"], ["Esc", "menu"]],
    mouse: "Left click walks and attacks, right click casts the chosen spell, shift-click attacks in place.",
    pad: "Not used in this build.",
    touch: "Keyboard and mouse only — play on a computer.",
    orientation: "landscape",
  },
};

// family fallbacks for systems added later without a card of their own
const FAMILY_DEFAULT: Record<string, string> = { nintendo: "nes", sony: "psx", sega: "segaMD", arcade: "arcade", consoles: "atari7800", computers: "c64", mobile: "palm", fantasy: "wasm4" };

/** The card for a system, app or web game — never empty: unknown ids fall back by family, then to the generic RetroPad layout. */
export const schemeFor = (id: string, family?: string): ControlScheme =>
  SCHEMES[id] ?? SCHEMES[FAMILY_DEFAULT[family ?? ""] ?? ""] ?? ejs([DPAD, ["Z", "A"], ["X", "B"], ["A · S", "X · Y"], ["Q · E", "L · R"], ...START_SELECT], "landscape");

/** touch device? (the codebase's rule: maxTouchPoints, not pointer:coarse — a mouse plugged into a tablet must not hide the touch story) */
export const isTouchDevice = () => typeof navigator !== "undefined" && (navigator.maxTouchPoints ?? 0) > 0;

const SEEN = "asp.controls.seen";
const readSeen = (): string[] => { try { return JSON.parse(localStorage.getItem(SEEN) ?? "[]"); } catch { return []; } };
export const hasSeenControls = (id: string) => readSeen().includes(id);
export const markControlsSeen = (id: string) => { try { localStorage.setItem(SEEN, JSON.stringify([...new Set([...readSeen(), id])])); } catch (e) { console.warn("controls seen", e); } };
