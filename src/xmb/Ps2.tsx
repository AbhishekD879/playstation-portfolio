// PlayStation 2 — Play! (jpd002/Play-, BSD) SELF-HOSTED at /play/, driven by
// our own PlayStation-style UI: disc-insert screen, spinning-disc load, full-
// bleed canvas, Xbox-pad → PS2 mapping via the gamepad bridge (same-origin
// iframe, so synthesized keys reach the emulator). ISOs are read locally.
import ControlsCard from "../emulator/ControlsCard";
import { hasSeenControls } from "../controls";
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import InputProbe from "./InputProbe";
import PadLadder from "./PadLadder";
import { freedPads, reconcileSeats, remoteSlots, type SeatMap } from "../ps2/netSeats";
import { logInput } from "../inputLog";
import * as sfx from "../audio";
import { setNavEnabled } from "../input";
import { startBridge, stopBridge, touchKey, PS2_CONFIG } from "../gamepadBridge";
import { holdWakeLock } from "../wakelock";
import TouchPad, { type TB } from "./TouchPad";
import DiagOverlay from "./DiagOverlay";
import { Icon } from "./icons";
import { makeRoomCode, startHost, startJoinerResilient, type HostHandle, type ResilientJoiner } from "../ps2mp/webrtc";
import { captureLocalInput, makeInjector, type PadState } from "../ps2mp/input";
import { bumpPlays, resolveGameFile, type GameRecord } from "../gamesdb";
import { clockDen, engineUrl, readClock, readEngine, readRes,
         type Ps2Clock, type Ps2Res } from "../ps2/engineChoice";
import { readVariant, variantUrl } from "../ps2/engineVariants";
import { readVolume, writeVolume, volumePercent } from "../ps2/gameVolume";
import { read as readCounters, sample as sampleCounters, type Counters, type Reading }
  from "../ps2/enginePerf";
import Ps2EngineLab from "./Ps2EngineLab";
import { readTitleId } from "../ps2compat";
import Ps2TuningPick from "./Ps2TuningPick";
import { tunedCoreAvailable, tunedCoreUrl } from "../ps2/tunedCores";
import { activeOverride, effectiveChoice, type TunedChoice } from "../ps2/tunedChoice";
import { buildGameConfigXml, elfNameFor, loadOverrides, overridesFor, type Ps2Override } from "../ps2knobs";
import { frameGen, upscale } from "../theme";
import PartyPanel, { type MicState } from "./PartyPanel";
import { buildRoster, cleanName, cleanText, confirmLine, lineId, pushLine, type ChatLine, type Member } from "../ps2mp/party";
import { partyNameAsked } from "../ps2mp/partyName";
import PartyName from "./PartyName";
import { createHostVoice, createJoinerVoice, openMic, type HostVoice, type JoinerVoice } from "../ps2mp/voice";
import { loadProfiles } from "../profiles";

type Stage = "insert" | "reading" | "playing" | "error";

export default function Ps2(props: {
  /** how many controllers to boot with — chosen on the PS2 home screen */
  players?: number; onClose: () => void; profileId: string; initialGame?: GameRecord; /** true = open the code box; a 4-char code = join that room straight away */
  initialJoin?: boolean | string;
  /** the room's game, so the connecting screen can name it */
  initialJoinTitle?: string;
  /** picked "host this" on the Online screen — open the room as soon as it boots */
  autoHost?: boolean;
  /** listed in Open rooms, decided on the Online screen before the room exists */
  isPublic?: boolean;
  /** the room's code, minted on the Online screen so the invite link exists
   *  before anyone is in the room to receive it */
  roomCode?: string;
  /** the name chosen on this device, or "" to fall back to the profile's */
  partyName?: string;
  onPartyName?: (n: string) => void }) {
  const isDesktop = matchMedia("(pointer: fine)").matches && innerWidth >= 900 && typeof WebAssembly === "object";
  const isolated = (globalThis as any).crossOriginIsolated === true;
  const canEmulate = isDesktop && isolated;
  const saveKey = `ps2:${props.profileId}`; // one memory card per profile
  const [stage, setStage] = createSignal<Stage>("insert");
  // —— how many controllers this session boots with ————————————————————————
  // Chosen on the insert screen, BEFORE the disc gesture, so insert() and the
  // boot path stay byte-identical to the 2-player build that works. An earlier
  // attempt put this in a step BETWEEN the disc and the boot; that broke player
  // one, so the rule now is: never add anything to the boot gesture.
  // ★ UNPARKED: the fork is now the default engine.
  //
  // It was kept out of every default path until proven against a real game,
  // because it had repeatedly broken player one. That condition is met: six
  // players verified on a real SmackDown disc, and player one verified booting
  // and taking input on this build.
  //
  // What forced the change is that the fork carries codegen fixes the stock
  // build does not — the extern-function registrations for the TLB set, without
  // which any game that installs a TLB exception handler (Shadow of the
  // Colossus) dies mid-boot on a module the browser rejects. While stock was the
  // 1-2 player default, that fix was unreachable in normal use and those games
  // simply would not boot. ?engine=stock still forces upstream for comparison.
  const q = new URLSearchParams(location.search);
  // Read ONCE at mount, deliberately NOT reactive. Re-setting the iframe's src
  // reloads the frame, which would strand the input bridge on a canvas from a
  // destroyed document — so the choice is made on PS2 home before a disc spins,
  // and by the time this component exists the answer is already settled.
  const engine = readEngine();
  // Internal resolution and the drawing-buffer flag travel in the frame URL and
  // are read once with everything else. res= is honoured only by the fork
  // (stock has no such binding and ignores it). keepbuf=1 asks the emulator page
  // to keep its WebGL drawing buffer readable, which the upscaler and motion
  // smoothing need to copy frames out of the frame — it costs a per-frame copy,
  // so it is only requested when one of them is actually on.
  const wantsFrames = upscale() !== "off" || frameGen() !== "off";
  // Read once at mount, like the engine. All three are chosen under Emulator on
  // PS2 home — every launch passes through that screen, and each has to be
  // settled before a disc spins. Signals rather than consts only because
  // routeAndBoot rebuilds the frame URL on every insert and reads them through
  // engineSrc(); nothing in the player writes them.
  const [resNow] = createSignal<Ps2Res>(readRes());
  const [variant] = createSignal(readVariant());
  const coreQuery = () => (engine === "advanced" ? `?res=${resNow()}${wantsFrames ? "&keepbuf=1" : ""}` : "");
  // Every variant is a fork build in its own directory, and
  // variantUrl(DEFAULT_VARIANT) is the shared core's own path — so on the
  // default this composes to exactly the URL it always was.
  const engineSrc = () =>
    engine === "advanced"
      ? `${variantUrl(variant())}${coreQuery()}`
      : engineUrl(engine);
  // The shared core is what the frame loads while the user picks a disc. A disc
  // we have tuned re-points it once, at insert — see routeAndBoot.
  const [frameSrc, setFrameSrc] = createSignal(engineSrc());
  // What we know about the disc that just went in, for the tuning picker.
  // Bumped when a tuning choice changes, to force the frame to reload even
  // when its URL is otherwise identical.
  const [bootNonce, setBootNonce] = createSignal(0);
  const [tuning, setTuning] = createSignal<
    { id: string; over: Ps2Override; choice: TunedChoice } | null
  >(null);
  // Settled on PS2 home before this component exists; latched at boot.
  const [clockNow] = createSignal<Ps2Clock>(readClock());
  const eeClockDen = () => clockDen(clockNow());
  void loadOverrides(); // warm the per-game table before a disc arrives
  // A normal boot is still 1 player; the fork only enables a tap above two, so
  // one- and two-player sessions behave exactly as they did on stock.
  // Prop first (the PS2 home picker), URL as an override for testing.
  const players = () => Math.max(1, Math.min(6, Number(q.get("players")) || props.players || 1));
  const [mtInfo, setMtInfo] = createSignal("");
  const [linkBlock, setLinkBlock] = createSignal<"permission" | "missing" | null>(null);
  const [disc, setDisc] = createSignal<File | null>(null);
  const [err, setErr] = createSignal("");
  let frame!: HTMLIFrameElement;
  let fileInput!: HTMLInputElement;
  let container!: HTMLDivElement;
  let pending: File | null = null;
  let ready = false;
  let saveTimer: ReturnType<typeof setInterval> | null = null;
  let onSaved: ((count: number) => void) | null = null;
  let releaseLock: (() => void) | null = null;
  const requestSave = () => frame?.contentWindow?.postMessage({ type: "play-save", saveKey }, location.origin);
  const [saveNote, setSaveNote] = createSignal("");
  const [help, setHelp] = createSignal(false); // "how to play": opens once after the first boot, then from the bar
  const [showDiag, setShowDiag] = createSignal(false); // diagnostics/share-log panel

  // —— speed readout ————————————————————————————————————————————————————
  // Two numbers, because they answer different questions and either one alone
  // misleads. FPS is how often the game presents a frame; SPEED is how fast the
  // emulated machine is running against a real PS2's field rate. A 30fps title
  // at full speed reads "30 FPS · 100%", while a 60fps title struggling reads
  // "30 FPS · 50%" — same FPS, completely different problem. Both come from
  // counters the advanced build exports; the native build has neither.
  // The sampler reads the module's cumulative counters once a second and hands
  // the pair to enginePerf.read, which is where the rate and percentage maths
  // lives — including the cases that otherwise produce a believable wrong
  // number, like a counter reset by booting a disc.
  const [perf, setPerf] = createSignal<Reading | null>(null);
  const [showPerf, setShowPerf] = createSignal((() => {
    try { return localStorage.getItem("asp.ps2.fps") === "1"; } catch { return false; }
  })());
  let perfTimer: ReturnType<typeof setInterval> | null = null;
  let perfPrev: Counters | null = null;
  /** same-origin iframe, so the module is directly reachable */
  const engineModule = () => (frame?.contentWindow as { __mod?: unknown } | null)?.__mod ?? null;
  const stopPerf = () => {
    if (perfTimer) clearInterval(perfTimer);
    perfTimer = null; perfPrev = null; setPerf(null);
  };
  const startPerf = () => {
    if (perfTimer) return;
    perfPrev = null;
    perfTimer = setInterval(() => {
      const s = sampleCounters(engineModule(), performance.now());
      if (!s) { setPerf(null); perfPrev = null; return; }  // native engine, or not booted yet
      // Rates need two samples; the first only establishes the baseline. A null
      // reading means the counters reset under us, so the NEXT interval starts
      // from this sample rather than from the pre-reset one.
      if (perfPrev) setPerf(readCounters(perfPrev, s) ?? null);
      perfPrev = s;
    }, 1000);
  };
  const togglePerf = () => {
    sfx.tickH();
    const on = !showPerf();
    setShowPerf(on);
    try { localStorage.setItem("asp.ps2.fps", on ? "1" : "0"); } catch {}
  };
  createEffect(() => {
    // Runs whenever a game is playing on the fork, because the panel is now a
    // click away at all times and an empty one the first second after opening
    // it reads as broken. One sample a second costs nothing.
    if (stage() === "playing" && engine === "advanced") startPerf();
    else if (showPerf() && stage() === "playing") startPerf();
    else stopPerf();
  });
  onCleanup(stopPerf);

  // —— the engine lab's knobs ————————————————————————————————————————————
  // Everything here talks to the module directly, and every call is guarded:
  // these bindings exist only on the fork, and a variant deployed by hand may
  // be an older build that lacks one.
  // The engine boots with the limiter ON; nothing reads it back, so this
  // mirrors what we have set rather than claiming to know the engine's mind.
  // —— how loud the game is, for whoever is listening ————————————————————
  //
  // Two sliders, never one. The host's moves a gain on the SPEAKER branch
  // inside the emulator page; the stream to joiners leaves at full level and
  // each joiner sets their own on the element playing it. A host turning the
  // game down to hear friends on a voice call must not reach into the room and
  // quieten it for everyone watching.
  const [gameVol, setGameVol] = createSignal(readVolume("host"));
  const applyGameVol = (v: number) => {
    const g = writeVolume("host", v);
    setGameVol(g);
    (frame?.contentWindow as { __setGameVolume?: (v: number) => void } | null)
      ?.__setGameVolume?.(g);
  };
  const [remoteVol, setRemoteVol] = createSignal(readVolume("joiner"));
  const applyRemoteVol = (v: number) => {
    const g = writeVolume("joiner", v);
    setRemoteVol(g);
    if (joinVideo) joinVideo.volume = g;
  };

  const [frameLimit, setFrameLimit] = createSignal(true);
  const applyFrameLimit = (on: boolean) => {
    const m = engineModule() as { setFrameLimit?: (on: boolean) => void } | null;
    m?.setFrameLimit?.(on);
    setFrameLimit(on);
  };


  // —— multiplayer (host-authoritative WebRTC streaming) ————————————————————
  // Host: streams the emulator canvas to a joiner and injects the joiner's
  // input as controller port 2. Joiner: watches the stream and sends input —
  // no emulator runs on the joiner. See ../ps2mp.
  type MpRole = "none" | "host" | "joiner";
  const [mpRole, setMpRole] = createSignal<MpRole>("none");
  const [mpCode, setMpCode] = createSignal("");
  const [mpStatus, setMpStatus] = createSignal("");
  const [mpPlayers, setMpPlayers] = createSignal(0);
  // ★ Decided on the Online screen, before anyone arrives — it used to be a pair
  // of tabs on a panel over the running game, which is after everybody has
  // already found the room or failed to. One home for the decision.
  const mpPublic = () => props.isPublic !== false;
  const [rejoin, setRejoin] = createSignal("");          // reconnect banner
  const [joinTitle, setJoinTitle] = createSignal("");     // what we are joining

  // —— party: who joined, what they said, who is talking ————————————————————
  // Rides the input data channel (see ../ps2mp/party.ts). The host is the only
  // authority: joiners send, the host stamps and fans out, so nobody's screen
  // can disagree about who is in the room.
  const [members, setMembers] = createSignal<Member[]>([]);
  const [chat, setChat] = createSignal<ChatLine[]>([]);
  const [mic, setMic] = createSignal<MicState>(navigator.mediaDevices ? "off" : "unsupported");
  const [myLevel, setMyLevel] = createSignal(0);
  const [roomCap, setRoomCap] = createSignal(2);
  // Whether the column still has a name to ask for. A signal because
  // localStorage is not reactive — reading partyNameAsked() in the view left the
  // answered prompt sitting in the column forever.
  const [askName, setAskName] = createSignal(!partyNameAsked());
  // The host mints joiner ids, so a joiner can't know which roster row is its
  // own until told. One message at channel-open beats matching on name, which
  // two players called "ABHI" would get wrong.
  const [meId, setMeId] = createSignal("host");
  // Open when it is useful and not before: the code board owns the empty room,
  // this column owns the room once there is somebody to talk to.
  const [chatOverride, setChatOverride] = createSignal<boolean | null>(null);
  // On a phone the column is a bottom sheet, and the bottom is where the touch
  // pad lives — so there it opens only when asked for.
  const isPhone = matchMedia("(max-width: 720px)").matches;
  const chatOpen = () => chatOverride()
    ?? (!isPhone && (mpRole() === "host" ? mpPlayers() > 0 : joinStage() === "live"));
  // What the room calls you. Owned by the console (XMB) so a rename made here,
  // on the connecting screen, is the same name the Online screen shows.
  const profileName = () => cleanName(loadProfiles().find((p) => p.id === props.profileId)?.name);
  const myName = () => cleanName(props.partyName || profileName());
  let hostVoice: HostVoice | null = null;
  let joinerVoice: JoinerVoice | null = null;
  let micStream: MediaStream | null = null;
  let levelTimer: ReturnType<typeof setInterval> | undefined;
  const jNames = new Map<string, string>();   // joiner id -> name
  const jMics = new Map<string, boolean>();   // joiner id -> mic open
  let voiceAudio: HTMLAudioElement | undefined; // joiner: the host's mix

  // ★ WHEN the party board is on screen — the whole design question here.
  //
  // Empty room: it is the only thing that matters, because the host is reading
  // the code out. Someone in: the GAME is the point, so it docks to a slim rail
  // and stops covering the picture. Manual override wins over both, so a host
  // can pull it back up mid-match to read the code to a straggler.
  const [partyOverride, setPartyOverride] = createSignal<boolean | null>(null);
  const partyOpen = () => partyOverride() ?? mpPlayers() === 0;
  /** Seat occupancy for the ladder: you on pad 0, joiners on their own pads. */
  const partySlots = () => [
    { player: 1, taken: true, label: "you" },
    ...[...netSeats().entries()].map(([id, pad]) => ({ player: pad + 1, taken: true, label: id.slice(0, 4), remote: true })),
  ];
  const seatsFree = () => {
    const free = players() - 1 - mpPlayers();
    return free > 0 ? `${free} open` : "full";
  };
  const [joinStage, setJoinStage] = createSignal<"" | "code" | "connecting" | "live">("");
  const [joinInput, setJoinInput] = createSignal("");
  let hostHandle: HostHandle | null = null;
  let joinerHandle: ResilientJoiner | null = null;
  let stopCapture: (() => void) | null = null;
  let injector: ReturnType<typeof makeInjector> | null = null;
  // ★ One injector PER remote pad. The previous code held a single injector on
  // __p2codes and discarded the joiner id, so every remote player drove player
  // two no matter how many connected. __padcodes[n] — multitap engine only —
  // gives each pad its own distinct key set.
  const netInjectors = new Map<number, ReturnType<typeof makeInjector>>();
  const [netSeats, setNetSeats] = createSignal<SeatMap>(new Map());
  let joinVideo: HTMLVideoElement | undefined;

  // The code is handed down from the Online screen when there is one, so the
  // link you copied before hosting is the link people actually arrive on.
  const genCode = () => props.roomCode || makeRoomCode();

  // —— on-screen touch pad (local play: bridge keys · joiner: window keys) ——
  const [analog, setAnalog] = createSignal(false); // d-pad drives d-pad or left stick
  const DPAD = { up: PS2_CONFIG.map[12], down: PS2_CONFIG.map[13], left: PS2_CONFIG.map[14], right: PS2_CONFIG.map[15] };
  const STICK = { up: PS2_CONFIG.axes[1].neg, down: PS2_CONFIG.axes[1].pos, left: PS2_CONFIG.axes[0].neg, right: PS2_CONFIG.axes[0].pos };
  const toggleAnalog = () => { // release both key sets so nothing sticks across the flip
    [DPAD, STICK].forEach((s) => Object.values(s).forEach((d) => touchKey(false, d)));
    setAnalog(!analog());
  };
  const psFace = (press: (i: number, on: boolean) => void): TB[] => [
    { label: <Icon name="triangle" />, cls: "gp-n", press: (on) => press(3, on) },
    { label: <Icon name="square" />, cls: "gp-w", press: (on) => press(2, on) },
    { label: <Icon name="circle" />, cls: "gp-e", press: (on) => press(1, on) },
    { label: <Icon name="cross" />, cls: "gp-s", press: (on) => press(0, on) },
  ];
  // joiner: synthesize the keys captureLocalInput() already listens for
  const joinKey = (on: boolean, code: string) =>
    window.dispatchEvent(new KeyboardEvent(on ? "keydown" : "keyup", { code, bubbles: true, cancelable: true }));
  const JOIN_DPAD = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };
  const JOIN_FACE: Record<number, string> = { 0: "KeyZ", 1: "KeyX", 2: "KeyA", 3: "KeyS" };

  // —— host side of the party ————————————————————————————————————————————
  // Roster is rebuilt from netSeats(), the SAME map that routes input, so the
  // list on screen can never claim a pad the game isn't actually giving them.
  let lastRoster = "";
  const pushRoster = (force = false) => {
    const levels = hostVoice?.levels() ?? new Map<string, number>();
    const list = buildRoster({
      hostName: myName(), hostMic: mic() === "on", hostLevel: levels.get("host") ?? 0,
      seats: netSeats(), names: jNames, mics: jMics, levels,
    });
    // Quantise the level before deciding to send. A ring only has a few visible
    // thicknesses, so a room where nobody talks sends nothing at all, and a
    // room where somebody does sends a handful of small frames a second.
    const key = JSON.stringify(list.map((m) => [m.id, m.name, m.pad, !!m.mic, Math.round((m.level ?? 0) * 4)]));
    if (!force && key === lastRoster) return;
    lastRoster = key;
    setMembers(list);
    hostHandle?.broadcast({ t: "roster", members: list, cap: players() });
  };

  /** Host says a line: it is authoritative the moment it exists locally. */
  // ★ A departure is announced on a delay, and a return inside it cancels both
  // lines. Reconnecting is normal — a phone changing wifi, a laptop waking —
  // and announcing it turns a two-second blip into "X left" / "X joined"
  // scrolling past. Held names stay in jNames so the return is not mistaken
  // for a new arrival either.
  const LEAVE_GRACE_MS = 6000;
  const leaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const cancelPendingLeave = (id: string) => {
    const t = leaveTimers.get(id);
    if (t === undefined) return false;
    clearTimeout(t);
    leaveTimers.delete(id);
    return true;                      // they were only gone for a moment
  };

  const hostSay = (from: string, text: string, system = false) => {
    const line: ChatLine = { id: lineId(), from, text, at: Date.now(), system: system || undefined };
    setChat((l) => pushLine(l, line));
    hostHandle?.broadcast({ t: "said", from, text, at: line.at, system });
  };

  function hostGame() {
    const canvas = frame.contentDocument?.getElementById("outputCanvas") as HTMLCanvasElement | null;
    const win = frame.contentWindow as any;
    if (!canvas || !win?.__p2codes || !(canvas as any).captureStream) { setMpStatus("emulator not ready — boot a game first"); return; }
    sfx.confirm();
    const stream = (canvas as any).captureStream(30) as MediaStream;
    // ★ The game's sound, as its own track alongside the picture.
    //
    // A canvas has no audio, so captureStream gives video and nothing else —
    // which meant a joiner watched in silence and only ever heard the game as
    // bleed through the host's microphone, after echo cancellation and noise
    // suppression had finished mangling it. The emulator page tees its WebAudio
    // output into a MediaStream for us (see __gameAudio there).
    //
    // It goes into the SAME MediaStream as the video on purpose: startHost adds
    // every track of this stream to the connection, and the joiner attaches
    // that one stream to its <video>, which plays the audio with it. No second
    // element, no way to mix the two up with the voice mix, and nothing about
    // the voice path changes.
    const gameAudio = (win.__gameAudio?.() as MediaStream | null | undefined) ?? null;
    for (const t of gameAudio?.getAudioTracks() ?? []) stream.addTrack(t);
    // Remote capacity follows the host's chosen player count: the host is pad 0,
    // so N players leaves N-1 remote seats. Per-pad key sets exist only on the
    // multitap engine; on stock we keep the proven single-pad path.
    const padCodes = win.__padcodes as Record<number, unknown> | undefined;
    const slots = padCodes ? remoteSlots(players()) : 1;
    const padFor = (pad: number) => {
      let inj = netInjectors.get(pad);
      if (!inj) {
        const codes = padCodes ? padCodes[pad] : win.__p2codes;
        if (!codes) return null;
        inj = makeInjector(win, canvas, codes);
        netInjectors.set(pad, inj);
      }
      return inj;
    };
    const code = genCode();
    setMpCode(code); setMpRole("host"); setMpPlayers(0); setNetSeats(new Map());
    setMembers([]); setChat([]); jNames.clear(); jMics.clear(); lastRoster = "";
    hostVoice = createHostVoice();
    // 8Hz is enough for a ring that reads as speech; the read is skipped
    // entirely while every mic in the room is closed.
    levelTimer = setInterval(() => {
      if (mic() !== "on" && ![...jMics.values()].some(Boolean)) return;
      pushRoster();
      setMyLevel(hostVoice?.levels().get("host") ?? 0);
    }, 120);
    hostHandle = startHost({
      room: code, max: slots, stream,
      // ★ Public by default. A room nobody can find is a room nobody joins, and
      // the code-only flow only ever worked for two people already in a chat.
      // `listing` is what puts it in the lobby; Private omits it entirely.
      listing: mpPublic() ? { title: disc()?.name?.replace(/\.[^.]+$/, "") || "PlayStation 2", kind: "ps2" } : undefined,
      onJoinerInput: (id, data: any) => {
        // Everything a joiner can say arrives here. Text from someone else's
        // browser is cleaned before it is stored, let alone re-broadcast.
        if (data?.t === "hello") {
          const name = cleanName(data.name);
          // Came back before the grace expired: no "left" was ever printed, so
          // there is no "joined" to print either.
          const returning = cancelPendingLeave(id);
          const first = !jNames.has(id);
          jNames.set(id, name);
          if (first && !returning) hostSay(name, `${name} joined`, true);
          pushRoster(true);
          return;
        }
        if (data?.t === "say") {
          const text = cleanText(data.text);
          if (text) hostSay(jNames.get(id) ?? "Player", text);
          return;
        }
        if (data?.t === "mic") { jMics.set(id, !!data.on); pushRoster(true); return; }
        if (data?.t !== "input") return;
        const pad = netSeats().get(id);
        if (pad === undefined) return;          // connected, but over capacity
        padFor(pad)?.applyState({ down: data.down ?? [], axes: data.axes ?? { lx: 0, ly: 0, rx: 0, ry: 0 } } as PadState);
      },
      onJoinerChange: (ids) => {
        setMpPlayers(ids.length);
        const prev = netSeats();
        const next = reconcileSeats(prev, ids, slots + 1);
        // A pad nobody holds any more MUST be released, or the wrestler it was
        // driving keeps whatever button was down when that player dropped.
        for (const pad of freedPads(prev, next)) {
          netInjectors.get(pad)?.release();
          netInjectors.delete(pad);
        }
        setNetSeats(next);
      },
      onStatus: (s) => setMpStatus(s),
      // ★ Voice: the host is a MIXER, not a forwarder. This track is created
      // before the first offer and never replaced, so joining, leaving, muting
      // and unmuting never renegotiate the connection carrying the game.
      onJoinerReady: (id) => hostHandle?.send(id, { t: "you", id }),
      voiceTrackFor: (id) => hostVoice?.trackFor(id) ?? null,
      onJoinerAudio: (id, stream) => { hostVoice?.addRemote(id, stream); pushRoster(true); },
      onJoinerLeft: (id) => {
        const name = jNames.get(id);
        hostVoice?.removeRemote(id);
        jMics.delete(id);
        pushRoster(true);            // the seat frees immediately either way
        if (!name) return;
        cancelPendingLeave(id);
        leaveTimers.set(id, setTimeout(() => {
          leaveTimers.delete(id);
          // Still gone once the grace is up — now it is a real departure.
          jNames.delete(id);
          hostSay(name, `${name} left`, true);
          pushRoster(true);
        }, LEAVE_GRACE_MS));
      },
    });
  }

  function stopHost() {
    hostHandle?.stop(); hostHandle = null;
    clearInterval(levelTimer); levelTimer = undefined;
    hostVoice?.stop(); hostVoice = null;
    closeMic();
    // Pending "X left" lines must not fire into a room that no longer exists.
    for (const t of leaveTimers.values()) clearTimeout(t);
    leaveTimers.clear();
    setMembers([]); setChat([]); jNames.clear(); jMics.clear(); setChatOverride(null);
    injector?.release(); injector = null;
    for (const inj of netInjectors.values()) inj.release();
    netInjectors.clear(); setNetSeats(new Map());
    setMpRole("none"); setMpCode(""); setMpStatus(""); setMpPlayers(0);
  }

  // —— microphone ————————————————————————————————————————————————————————
  // One toggle for both roles. The stream is stopped rather than just muted on
  // close, so the browser's own recording indicator goes out — a mic that says
  // "off" on screen while the tab still shows a red dot is not off.
  function closeMic() {
    micStream?.getTracks().forEach((t) => t.stop());
    micStream = null;
    joinerVoice?.stop(); joinerVoice = null;
    hostVoice?.setLocalMic(null);
    joinerHandle?.setMic(null);
    setMic((m) => (m === "on" ? "off" : m));
    setMyLevel(0);
  }

  async function toggleMic() {
    if (mic() === "unsupported") return;
    sfx.tickH();
    if (mic() === "on") {
      closeMic();
      if (mpRole() === "host") pushRoster(true);
      else joinerHandle?.send({ t: "mic", on: false });
      return;
    }
    const stream = await openMic();
    if (!stream) { setMic("blocked"); return; }   // denied: say why, don't fail silently
    micStream = stream;
    setMic("on");
    if (mpRole() === "host") {
      hostVoice?.setLocalMic(stream);
      pushRoster(true);
    } else {
      joinerHandle?.setMic(stream.getAudioTracks()[0] ?? null);
      joinerVoice = createJoinerVoice(stream);
      joinerHandle?.send({ t: "mic", on: true });
    }
  }

  /** A new name has to reach the room, not just this screen. The host rebuilds
   *  its roster; a joiner re-sends hello, which the host already treats as
   *  idempotent (only the first one prints a "joined" line). */
  function renameMe(name: string) {
    props.onPartyName?.(name);
    if (mpRole() === "host") pushRoster(true);
    else joinerHandle?.send({ t: "hello", name: cleanName(name || profileName()) });
  }

  /** Anyone's line, said from this screen. Host stamps its own; a joiner shows
   *  it immediately as pending and the host's echo confirms it. */
  function say(text: string) {
    const clean = cleanText(text);
    if (!clean) return;
    if (mpRole() === "host") { hostSay(myName(), clean); return; }
    setChat((l) => pushLine(l, { id: lineId(), from: myName(), text: clean, at: Date.now(), pending: true }));
    joinerHandle?.send({ t: "say", text: clean });
  }

  function joinGame(code: string) {
    if (!code) return;
    // A second Join without leaving the first would leave the old session alive
    // and holding a seat — the host would show the same person twice.
    if (joinerHandle) leaveJoin();
    sfx.confirm();
    setMpRole("joiner"); setMpCode(code); setJoinStage("connecting"); setMpStatus("connecting…");
    setNavEnabled(false); // controller/keys belong to the remote game now
    joinerHandle = startJoinerResilient({
      // Survives a wifi blip or the host reloading: the session is rebuilt and
      // the seat re-allocated, rather than dumping the player back to a code box.
      onHealth: (h, n, label) => {
        setRejoin(h === "connected" ? "" : label);
        // Reconnect keeps trying, but a host who closed the room is not coming
        // back. Rather than hold someone on a frozen last frame forever, hand
        // them to Open rooms after a few tries so they can pick another game.
        // The retry loop is what keeps the session alive on screen, so leaving
        // has to stop it — closing the app alone left the handle reconnecting
        // in the background.
        if (h === "gone" && n >= 4) { setRejoin(""); leaveJoin(); props.onClose(); }
      },
      room: code,
      // Every (re)connect gets a fresh channel and a fresh mic sender, so both
      // the announcement and the live mic are re-applied here rather than
      // remembered by the transport.
      onReady: () => {
        joinerHandle?.send({ t: "hello", name: myName() });
        if (mic() === "on" && micStream) {
          joinerHandle?.setMic(micStream.getAudioTracks()[0] ?? null);
          joinerHandle?.send({ t: "mic", on: true });
        }
      },
      // The host is another browser: clean its roster and its chat on arrival,
      // exactly as the host cleans ours.
      onMessage: (data: any) => {
        if (data?.t === "you" && typeof data.id === "string") { setMeId(data.id); return; }
        if (data?.t === "roster" && Array.isArray(data.members)) {
          setRoomCap(Number(data.cap) || data.members.length);
          setMembers(data.members.slice(0, 8).map((m: any): Member => ({
            id: String(m.id ?? ""), name: cleanName(m.name), pad: Number(m.pad) || 1,
            host: !!m.host, mic: !!m.mic, level: Math.min(1, Math.max(0, Number(m.level) || 0)),
          })));
          return;
        }
        if (data?.t === "said") {
          const text = cleanText(data.text);
          if (!text) return;
          const line: ChatLine = {
            id: lineId(), from: cleanName(data.from), text,
            at: Number(data.at) || Date.now(), system: data.system ? true : undefined,
          };
          setChat((l) => confirmLine(l, line));
        }
      },
      onAudio: (stream) => {
        // Plain playback, no graph: this is already everyone-but-us, mixed.
        if (!voiceAudio) return;
        voiceAudio.srcObject = stream;
        voiceAudio.play().catch(() => { /* resumes on the next gesture */ });
      },
      onStream: (stream) => {
        setJoinStage("live"); setMpStatus("connected");
        if (joinVideo) {
          joinVideo.srcObject = stream;
          joinVideo.muted = false;
          // The host sends at full level and cannot change this — how loud the
          // game sits next to their voice is the joiner's own call.
          joinVideo.volume = remoteVol();
          joinVideo.play().catch(() => {
            // Autoplay with sound was refused. Show the game rather than
            // nothing, and say why the sound is missing.
            joinVideo!.muted = true;
            joinVideo!.play().catch(() => { /* nothing more to try */ });
            setMpStatus("connected · tap the picture for sound");
          });
        }
      },
      onStatus: (s) => setMpStatus(s),
    });
    stopCapture = captureLocalInput((state) => joinerHandle?.sendInput({ t: "input", down: state.down, axes: state.axes }));
    // Our own ring is driven locally, so it lights the instant we speak instead
    // of waiting for the host's next roster frame.
    levelTimer = setInterval(() => { if (joinerVoice) setMyLevel(joinerVoice.level()); }, 120);
  }

  function leaveJoin() {
    sfx.back();
    stopCapture?.(); stopCapture = null;
    clearInterval(levelTimer); levelTimer = undefined;
    closeMic();
    joinerHandle?.stop(); joinerHandle = null;
    setMembers([]); setChat([]); setChatOverride(null); setMeId("host");
    setJoinStage(""); setMpRole("none"); setMpCode(""); setMpStatus("");
    setNavEnabled(true);
  }

  /** The party column. One component for host and joiner: the difference
   *  between them is who is authoritative, which the panel doesn't need to know. */
  const partyColumn = () => (
    <Show when={chatOpen()}>
      <PartyPanel
        code={mpCode()}
        name={myName()}
        nameIsFallback={!props.partyName}
        onName={askName() ? renameMe : undefined}
        onNameDone={() => setAskName(false)}
        capacity={mpRole() === "host" ? players() : roomCap()}
        members={members()}
        log={chat()}
        meId={meId()}
        mic={mic()}
        talking={myLevel() > 0}
        myLevel={myLevel()}
        onSay={say}
        onToggleMic={toggleMic}
        onClose={() => setChatOverride(false)}
      />
    </Show>
  );

  // SHARE is rendered outside this app and fixed to the same corner, so the
  // signal that the column is open has to reach it at body level.
  createEffect(() => document.body.classList.toggle("party-col", chatOpen()));
  onCleanup(() => document.body.classList.remove("party-col"));

  const goFullscreen = () => {
    const el = container as any;
    if (document.fullscreenElement) return;
    (el.requestFullscreen?.({ navigationUI: "hide" }) ?? el.webkitRequestFullscreen?.())?.catch?.(() => {});
  };
  const exitFullscreen = () => {
    if (document.fullscreenElement) (document.exitFullscreen?.() ?? (document as any).webkitExitFullscreen?.())?.catch?.(() => {});
  };

  onMount(() => {
    // A code means the player picked a room from the lobby — connect, do not
    // make them retype what they just clicked.
    if (typeof props.initialJoin === "string" && props.initialJoin.length === 4) { setJoinTitle(props.initialJoinTitle || ""); joinGame(props.initialJoin); }
    else if (props.initialJoin) setJoinStage("code");
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && stage() !== "playing") props.onClose(); };
    addEventListener("keydown", esc);
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== location.origin || !e.data?.type) return;
      if (e.data.type === "play-ready") {
        ready = true;
        // Re-apply the remembered volume: the frame is new (first boot, a disc
        // change, or an engine switch) and its audio graph starts at full.
        (frame?.contentWindow as { __setGameVolume?: (v: number) => void } | null)
          ?.__setGameVolume?.(gameVol());
        if (pending) bootNow(pending);
        else if (props.initialGame) bootRecord(props.initialGame, true); // auto-boot the library pick
      }
      if (e.data.type === "play-multitap") {
        setMtInfo(`multitap: ${e.data.pads} pads for ${e.data.players} players`);
      }
      if (e.data.type === "play-booted") {
        setStage("playing");
        setNavEnabled(false); // keyboard belongs to the PS2 now
        releaseLock ??= holdWakeLock();
        // Play! registers its key listeners ON the canvas element (not the
        // document), so the bridge must dispatch straight onto it.
        const canvas = frame.contentDocument?.getElementById("outputCanvas");
        // If this ever binds to anything but the live canvas, keys vanish into
        // the parent document and the game looks dead while input "works".
        logInput(canvas ? "bridge -> outputCanvas" : "bridge -> NO CANVAS (keys will not reach the game)");
        startBridge(canvas ?? frame.contentDocument, () => {}, PS2_CONFIG);
        frame.contentWindow?.focus();
        // auto-save the memory card every 15s so progress survives a reload
        saveTimer = setInterval(requestSave, 15_000);
        if (!hasSeenControls("ps2")) setHelp(true);
        // Came here from "host this" on the Online screen. Hosting needs a
        // running emulator (it captures the canvas), so it can only happen
        // here — never in the boot gesture itself.
        if (props.autoHost && mpRole() === "none") setTimeout(hostGame, 400);
      }
      if (e.data.type === "play-error") {
        setErr(e.data.message || "The emulator refused this disc.");
        setStage("error");
      }
      if (e.data.type === "play-saved") {
        const n = e.data.count ?? 0;
        // brief on-screen confirmation so saving is never a mystery
        setSaveNote(n > 0 ? `Memory card saved · ${n} file${n === 1 ? "" : "s"}` : "Memory card empty — nothing to save yet");
        setTimeout(() => setSaveNote(""), 2600);
        onSaved?.(n); onSaved = null; // release an eject that's waiting on the flush
      }
    };
    addEventListener("message", onMsg);
    // flush the card if the tab is hidden/closed mid-game
    const onHide = () => { if (stage() === "playing") requestSave(); };
    addEventListener("pagehide", onHide);
    addEventListener("visibilitychange", onHide);
    onCleanup(() => {
      removeEventListener("keydown", esc);
      removeEventListener("message", onMsg);
      removeEventListener("pagehide", onHide);
      removeEventListener("visibilitychange", onHide);
      if (saveTimer) clearInterval(saveTimer);
      stopBridge();
      releaseLock?.();
      stopCapture?.();
      // Closing the app must also close the mic and the audio graph, or the
      // browser keeps showing this tab as recording after the game is gone.
      clearInterval(levelTimer);
      closeMic();
      hostVoice?.stop();
      hostHandle?.stop();
      joinerHandle?.stop();
      injector?.release();
      setNavEnabled(true);
      exitFullscreen();
    });
  });

  // Per-game overrides. Read the disc's own title id (three 2 KB reads, no
  // scanning), look it up, and hand the emulator both the clock this game needs
  // and any GameConfig knobs we have for it. The engine and resolution are
  // fixed at mount because changing them re-points the iframe, so only the
  // clock and the knobs can be applied per disc — which is the pair that
  // actually broke Urban Reign.
  async function bootNow(f: File) {
    pending = null;
    let den = eeClockDen();
    let gameConfigXml: string | null = null;
    try {
      const id = await readTitleId(f);
      // activeOverride, not overridesFor: declining the tuning has to decline
      // all of it — the clock and the knobs as much as the build.
      const over = id ? activeOverride(id, overridesFor(id)) : null;
      if (over?.clock) den = clockDen(over.clock);
      if (id && over?.knobs) {
        const elf = elfNameFor(id);
        if (elf) gameConfigXml = buildGameConfigXml(elf, over.knobs);
      }
    } catch { /* unreadable disc — boot it with the global settings */ }
    frame.contentWindow?.postMessage(
      { type: "play-boot", file: f, saveKey, players: players(), eeClockDen: den, gameConfigXml },
      location.origin,
    );
  }

  function insert(f: File) {
    sfx.confirm();
    setDisc(f);
    setStage("reading");
    goFullscreen(); // still inside the user gesture — must stay synchronous
    pending = f;
    void routeAndBoot(f);
  }

  /** Start this disc over under a changed tuning choice.
   *
   *  The clock, the knobs and the build are all latched when a game boots, so
   *  there is no applying any of it to a running VM. The nonce is what forces
   *  the reload: the frame URL is often identical between the two choices —
   *  only the clock or the knobs differ — and re-setting an unchanged src does
   *  nothing. The memory card is keyed independently, so the player resumes
   *  from their last save rather than the beginning. */
  function reboot(f: File) {
    pending = f;
    ready = false;
    setBootNonce((n) => n + 1);
    void routeAndBoot(f);
  }

  /** Send this disc to the build that runs it best.
   *
   *  A handful of games needed a change to the emulator itself rather than a
   *  setting, and each has its own build (ps2/tunedCores.ts). Routing happens
   *  here because the title id does not exist until a disc is in, and because
   *  re-pointing the frame is only safe before a game is running — the same
   *  play-ready handshake that boots a pending disc re-establishes the input
   *  bridge, so a reload costs a few seconds of wasm compile and nothing else.
   *
   *  Anything unrecognised, unreadable, or not actually deployed stays on the
   *  shared core. A missing tuned build must never mean a game will not start. */
  async function routeAndBoot(f: File) {
    let want = engineSrc();
    try {
      const id = await readTitleId(f);
      const known = id ? overridesFor(id) : null;
      // Remember what we have for this disc, so the player can be offered the
      // other way round — and told how far we actually checked.
      setTuning(id && known ? { id, over: known, choice: effectiveChoice(id, known) } : null);
      const core = id ? activeOverride(id, known)?.core : null;
      if (core && (await tunedCoreAvailable(core))) want = tunedCoreUrl(core) + coreQuery();
    } catch { /* unreadable disc — let the shared core read it and say why */ }

    const withNonce = bootNonce() ? `${want}${want.includes("?") ? "&" : "?"}boot=${bootNonce()}` : want;
    if (withNonce !== frameSrc()) {
      ready = false;      // the new frame's play-ready boots `pending`
      setFrameSrc(withNonce);
      return;
    }
    if (ready) bootNow(f);
    // otherwise the play-ready handler boots it
  }

  // boot a library record: stream its file (zero-copy for a multi-GB ISO —
  // handle.getFile() is disk-backed) and insert it. On a lapsed permission,
  // show the grant button; the file keeps its name so Play! detects the format.
  async function bootRecord(g: GameRecord, request: boolean) {
    let raw: Blob;
    try {
      raw = await resolveGameFile(g, { request });
    } catch (e: any) {
      setLinkBlock(e?.cause === "permission" ? "permission" : "missing");
      return;
    }
    setLinkBlock(null);
    bumpPlays(g.id);
    const file = raw instanceof File ? raw : new File([raw], g.name, { type: raw.type });
    insert(file);
  }

  function eject() {
    // Tear the room down first: a room advertising a disc that is no longer in
    // the machine is worse than no room. stopHost also unlists it.
    if (mpRole() === "host") stopHost();
    sfx.back();
    if (saveTimer) clearInterval(saveTimer);
    stopBridge();
    setNavEnabled(true);
    exitFullscreen();
    // wait for the final snapshot to actually commit before tearing down the
    // iframe (idbPut is async — closing too early would drop the last save)
    let closed = false;
    const close = () => { if (!closed) { closed = true; props.onClose(); } };
    onSaved = () => close();
    requestSave();
    setTimeout(close, 3000); // fallback if the emulator never acks
  }

  return (
    <div class="ps2" ref={container}>
      <Show
        when={canEmulate || mpRole() === "joiner" || joinStage() !== ""}
        fallback={
          <>
            <div class="ps2-head">
              <div class="panel-tag">PLAYSTATION 2 — EXPERIMENTAL</div>
              <button class="ps-act" onClick={() => { sfx.back(); props.onClose(); }}><span class="btn-o" /> back</button>
            </div>
            <div class="ps2-gate">
              <div class="ps2-big">{isDesktop ? "This host can't run the PS2 core." : "PS2 emulation needs a desktop."}</div>
              <p>{isDesktop
                ? "The emulator needs cross-origin isolation headers, which this deployment isn't sending. Try the local/dev build, or Chrome/Edge."
                : "Emulating the PlayStation 2 is enormously demanding — it needs a desktop with a real GPU and keyboard. But you CAN play here as player 2 of a 2-player game hosted on a desktop."}</p>
              <Show when={!isDesktop}>
                <button class="ps2-launch ps2-lab-btn" onClick={() => { sfx.tickH(); setJoinStage("code"); setJoinInput(""); }}><Icon name="gamepad" /> &nbsp;JOIN A 2-PLAYER GAME</button>
                <p class="ps2-warn">The host's game streams to this screen — an on-screen pad appears for your input.</p>
              </Show>
            </div>
          </>
        }
      >
        {/* emulator iframe exists from the start so the wasm warms up while
            the user picks a disc; it's invisible until playing. A JOINER runs
            no emulator — they only watch the host's stream — so skip it then
            (and never load the wasm on a host that can't emulate anyway). */}
        <InputProbe />

        <Show when={mpRole() !== "joiner" && canEmulate}>
          <iframe
            ref={frame}
            class="ps2-frame"
            classList={{ live: stage() === "playing" }}
            src={frameSrc()}
            allow="autoplay; fullscreen; gamepad; cross-origin-isolated"
            title="PlayStation 2"
          />
        </Show>

        {/* joiner view — full-bleed stream of the host's game + our input */}
        <Show when={mpRole() === "joiner"}>
          {/* Reconnect is silent until it is not: this only appears when the link
              actually drops, and names the cause so a dead host reads differently
              from a dead wifi. */}
          <Show when={rejoin()}>
            <div class="ps2-rejoin"><span class="ps2-rejoin-dot" />{rejoin()}</div>
          </Show>
          <div class="ps2-join-view">
            {/* Not muted: the stream now carries the game's audio, and this is
                what plays it. Autoplay with sound needs a gesture, and joining
                is one — onStream falls back to muted if the browser refuses, so
                a blocked autoplay costs the sound and never the picture. */}
            <video ref={joinVideo} class="ps2-join-video" classList={{ live: joinStage() === "live" }}
              autoplay playsinline
              onClick={() => {
                // The gesture the browser was waiting for. Harmless when the
                // sound is already playing.
                if (!joinVideo) return;
                joinVideo.muted = false;
                joinVideo.play().then(() => setMpStatus("connected")).catch(() => {});
              }} />
            <Show when={joinStage() === "live"}>
              {/* The joiner's own game volume. The host's slider moves their
                  speakers only — the stream arrives at full level, so this is
                  the one that decides how loud the game sits next to whoever
                  you are talking to. */}
              <label class="ps2-vol ps2-vol-join" title="Game volume (yours)">
                <span class="ps2-vol-k" classList={{ off: remoteVol() === 0 }} aria-hidden="true">
                  <Icon name="speaker" />
                </span>
                <input
                  type="range" min="0" max="100" step="5"
                  value={volumePercent(remoteVol())}
                  aria-label="Game volume"
                  onInput={(e) => applyRemoteVol(Number(e.currentTarget.value) / 100)}
                />
                <span class="ps2-vol-n">{volumePercent(remoteVol())}%</span>
              </label>
            </Show>
            <Show when={joinStage() !== "live"}>
              <div class="ps2-gate ps2-join-connecting">
                <div class="session-disc ps2-spin"><div class="session-disc-hole" /></div>
                <div class="session-reading-text">{joinTitle() ? `Joining ${joinTitle()}` : `Joining room ${mpCode()}`}…</div>
                <div class="session-reading-name">{mpStatus() || "connecting"}</div>
                {/* Asked here because a link skips the Online screen entirely.
                    The connection is already running behind this — the name is
                    announced when it lands, and again if it changes. */}
                <Show when={askName()}>
                  <PartyName name={myName()} isFallback={!props.partyName} onChange={renameMe}
                    onDone={() => setAskName(false)} inline />
                </Show>
              </div>
            </Show>
            {/* the host's voice mix — everyone in the room except us */}
            <audio ref={voiceAudio} autoplay style={{ display: "none" }} />
            <div class="ps2-bar">
              {/* the real pad, from the host's roster — "Player 2" was a guess
                  that was simply wrong for anyone past the second seat */}
              <span class="flash-now ps2-lab-btn"><Icon name="gamepad" /> Player {members().find((m) => m.id === meId())?.pad ?? 2} · room {mpCode()} · {mpStatus()}</span>
              <span class="flash-bar-btns">
                <Show when={joinStage() === "live"}>
                  <button class="ghost-btn" classList={{ on: chatOpen() }} aria-pressed={chatOpen()}
                    onClick={() => { sfx.tickH(); setChatOverride(!chatOpen()); }}>
                    Party · {members().length || 1}
                  </button>
                </Show>
                <button class="ghost-btn" onClick={leaveJoin}>⏏ leave</button>
              </span>
            </div>
            {partyColumn()}
            {/* touch pad → the same keys captureLocalInput reads from a keyboard.
                ponytail: no touch analog — the keyboard vocabulary has none */}
            <Show when={joinStage() === "live"}>
              <TouchPad
                dpad={(dir, on) => joinKey(on, JOIN_DPAD[dir])}
                face={psFace((i, on) => joinKey(on, JOIN_FACE[i]))}
                pills={[
                  { label: "SELECT", press: (on) => joinKey(on, "Backspace") },
                  { label: "START", press: (on) => joinKey(on, "Enter") },
                ]}
                shoulderL={[
                  { label: "L1", press: (on) => joinKey(on, "KeyQ") },
                  { label: "L2", press: (on) => joinKey(on, "KeyE") },
                ]}
                shoulderR={[
                  { label: "R2", press: (on) => joinKey(on, "KeyR") },
                  { label: "R1", press: (on) => joinKey(on, "KeyW") },
                ]}
              />
            </Show>
          </div>
        </Show>

        <Show when={stage() === "playing"}>
          <div class="ps2-bar">
            <span class="flash-now">▶ {disc()?.name}</span>
            <span class="flash-bar-btns">
              <Show when={mpRole() === "none"}>
                <button class="ghost-btn" onClick={hostGame}>Play online · seats {players()}</button>
              </Show>
              <Show when={mpRole() === "host"}>
                <button class="ghost-btn" classList={{ on: chatOpen() }} aria-pressed={chatOpen()}
                  onClick={() => { sfx.tickH(); setChatOverride(!chatOpen()); }}>
                  Party · {members().length || 1}
                </button>
                <button class="ghost-btn" onClick={stopHost}>Close the room</button>
              </Show>
              <button class="ghost-btn" classList={{ on: showPerf() }} aria-pressed={showPerf()}
                onClick={togglePerf}>▤ fps</button>
              {/* Live, and inline rather than behind a pill: the point is to
                  nudge it while the game is running and hear the result. Only
                  this machine's speakers — joiners set their own. */}
              <label class="ps2-vol" title="Game volume (yours only — joiners set their own)">
                <span class="ps2-vol-k" classList={{ off: gameVol() === 0 }} aria-hidden="true">
                  <Icon name="speaker" />
                </span>
                <input
                  type="range" min="0" max="100" step="5"
                  value={volumePercent(gameVol())}
                  aria-label="Game volume"
                  onInput={(e) => applyGameVol(Number(e.currentTarget.value) / 100)}
                />
                <span class="ps2-vol-n">{volumePercent(gameVol())}%</span>
              </label>
              {/* Advanced engine only: the native build exports none of the
                  counters this panel is made of, so there would be nothing to
                  show. Which BUILD of the advanced engine runs is chosen under
                  Emulator on PS2 home, with the other boot-time settings. */}
              <Show when={engine === "advanced"}>
                <Ps2EngineLab
                  reading={perf}
                  variant={variant}
                  frameLimit={frameLimit}
                  onFrameLimit={applyFrameLimit}
                />
              </Show>
              <button class="ghost-btn" onClick={() => requestSave()}>▪ save card</button>
              {/* only for a disc we have tuning for; everything else has
                  nothing to choose between, so it gets no pill. Here rather
                  than on the insert screen because that screen is gone in a
                  second or two, and because the moment a player wants this is
                  the moment a game starts misbehaving. */}
              <Show when={tuning()}>{(t) => (
                <Ps2TuningPick
                  titleId={t().id}
                  over={t().over}
                  choice={t().choice}
                  onPick={(c) => { setTuning({ ...t(), choice: c }); if (disc()) reboot(disc()!); }}
                />
              )}</Show>
              <button class="ghost-btn" onClick={() => setHelp(true)} title="How to play (?)">? controls</button>
              <ControlsCard id="ps2" title="PlayStation 2" open={help()} onClose={() => setHelp(false)} onToggle={() => setHelp(!help())} />
              <button class="ghost-btn ps2-lab-btn" classList={{ on: showDiag() }} onClick={() => setShowDiag((v) => !v)}><Icon name="info" /> diagnostics</button>
              <button class="ghost-btn" onClick={goFullscreen}>⛶ full screen</button>
              <button class="ghost-btn" onClick={eject}>⏏ eject</button>
            </span>
          </div>
          <Show when={mpRole() === "host"}>
            {/* ── THE PARTY BOARD ─────────────────────────────────────────────
                Two states, decided by the room rather than by a switch:

                  nobody in yet → OPEN. The code is the only thing that matters,
                                  because the host is reading it out loud.
                  someone in    → DOCKED to a rail. The game is the point now, so
                                  the board stops covering the picture.

                Either can be overridden by clicking, so a host can pull the code
                back up mid-match for a straggler. */}
            <Show
              when={partyOpen()}
              fallback={
                <button class="party-rail" onClick={() => setPartyOverride(true)}
                  aria-label={`Room ${mpCode()}, ${mpPlayers()} joined. Show the room code`}>
                  <span class="party-rail-k">ROOM</span>
                  <span class="party-rail-code">{mpCode()}</span>
                  <PadLadder count={players()} size="sm" slots={partySlots()} />
                  <span class="party-rail-n">{seatsFree()}</span>
                </button>
              }
            >
              <div class="party">
                <div class="party-head">
                  <span class="party-k">ROOM CODE</span>
                  <button class="ps-act party-x" onClick={() => setPartyOverride(false)}>hide</button>
                </div>
                <span class="party-code">{mpCode()}</span>
                <PadLadder count={players()} showPorts showWho slots={partySlots()} />
                <p class="party-how">
                  {mpPublic()
                    ? "Listed in Open rooms — anyone on the console can find this game. They can also type the code."
                    : "Not listed. Only people you give the code to can get in."}
                  {mpStatus() ? ` · ${mpStatus()}` : ""}
                </p>
              </div>
            </Show>
            {partyColumn()}
          </Show>
          {/* Top-right: the party rail is centred at 56px and the save note is
              bottom-centre, so this corner is free. */}
          <Show when={showPerf()}>
            <div class="ps2-perf" role="status">
              {/* perf() is also null for the first second on the advanced
                  engine, while the second sample is collected — so the reason
                  comes from the engine, not from the absence of a reading. */}
              <Show when={perf()} fallback={
                <span class="ps2-perf-na">
                  {engine === "native" ? "no speed counters on the native engine" : "measuring…"}
                </span>
              }>
                <span class="ps2-perf-n">{Math.round(perf()!.fps)}</span>
                <span class="ps2-perf-u">FPS</span>
                <i class="ps2-perf-sep" />
                <span class="ps2-perf-n">{Math.round(perf()!.speed)}</span>
                <span class="ps2-perf-u">% SPEED</span>
              </Show>
            </div>
          </Show>
          <Show when={saveNote()}><div class="ps2-savenote">{saveNote()}</div></Show>
          {/* touch pad → bridge keys into the emulator iframe. ANALOG flips the
              d-pad between digital d-pad and left-stick keys (like a DualShock) */}
          <TouchPad
            dpad={(dir, on) => touchKey(on, (analog() ? STICK : DPAD)[dir])}
            face={psFace((i, on) => touchKey(on, PS2_CONFIG.map[i]))}
            pills={[
              { label: "SELECT", press: (on) => touchKey(on, PS2_CONFIG.map[8]) },
              { label: "START", press: (on) => touchKey(on, PS2_CONFIG.map[9]) },
              { label: <>{analog() ? "● ANALOG" : "○ ANALOG"}</>, press: (on) => { if (on) toggleAnalog(); } },
            ]}
            shoulderL={[
              { label: "L1", press: (on) => touchKey(on, PS2_CONFIG.map[4]) },
              { label: "L2", press: (on) => touchKey(on, PS2_CONFIG.map[6]) },
            ]}
            shoulderR={[
              { label: "R2", press: (on) => touchKey(on, PS2_CONFIG.map[7]) },
              { label: "R1", press: (on) => touchKey(on, PS2_CONFIG.map[5]) },
            ]}
          />
        </Show>

        <Show when={stage() !== "playing" && mpRole() !== "joiner"}>
          <div class="ps2-overlay">
            <div class="ps2-head">
              <div class="panel-tag">PLAYSTATION 2 — POWERED BY PLAY! · RUNS ON THIS CONSOLE</div>
              <button class="ps-act" onClick={() => { sfx.back(); props.onClose(); }}><span class="btn-o" /> back</button>
            </div>

            {/* library pick that needs a fresh disk grant (or moved file) */}
            <Show when={stage() === "insert" && joinStage() !== "code" && linkBlock()}>
              <div class="ps2-gate">
                <div class="ps2-disc-art"><div class="ps2-disc-hole" /></div>
                <div class="ps2-big">{linkBlock() === "permission" ? "This disc lives on your drive" : "That disc has moved"}</div>
                <p>{props.initialGame?.name}</p>
                <Show when={linkBlock() === "permission"} fallback={
                  <p class="ps2-warn">Open the Game Library and press R on it to re-link the file, then boot again.</p>
                }>
                  <button class="ps2-launch" onClick={() => bootRecord(props.initialGame!, true)}>▶ &nbsp;GRANT DISK ACCESS & PLAY</button>
                  <p class="ps2-warn">Linked discs stream straight from your drive — the multi-GB ISO is never copied.</p>
                </Show>
              </div>
            </Show>

            <Show when={stage() === "insert" && joinStage() !== "code" && !linkBlock()}>
              <div class="ps2-gate">
                <div class="ps2-disc-art"><div class="ps2-disc-hole" /></div>
                <div class="ps2-big">Insert a PlayStation 2 disc</div>
                <p>A game image <b>you own</b> — .iso, .cso, .chd, .isz, .bin or .elf. It's read locally by the emulator, never uploaded. No BIOS needed.</p>
                <button class="ps2-launch" onClick={() => fileInput.click()}>⏏ &nbsp;INSERT DISC</button>
                <button class="ps2-join-btn ps2-lab-btn" onClick={() => { sfx.tickH(); setJoinStage("code"); setJoinInput(""); }}><Icon name="gamepad" /> &nbsp;JOIN A 2-PLAYER GAME</button>

                <p class="ps2-warn">Experimental core — many titles run slowly or not at all. <Icon name="gamepad" /> Xbox pad mapped: A=✕ B=◯ X=◻ Y=△ · sticks work · Start/Back = Start/Select.</p>
              </div>
            </Show>

            <Show when={stage() === "insert" && joinStage() === "code"}>
              <div class="ps2-gate">
                <div class="ps2-big">Join a 2-player game</div>
                <p>Ask the host for their 4-character room code (shown on their screen while hosting).</p>
                <input
                  class="ps2-code-input"
                  maxLength={4}
                  placeholder="CODE"
                  autofocus
                  value={joinInput()}
                  onInput={(e) => setJoinInput(e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && joinInput().length === 4) joinGame(joinInput());
                    // Backspace and Delete edit the field and nothing else. The
                    // emulator binds Backspace to SELECT and the shelf binds it
                    // to "remove game", so it must not travel any further than
                    // this input while a code is being typed.
                    if (e.key === "Backspace" || e.key === "Delete") e.stopPropagation();
                  }}
                />
                {/* A visible way back out. On a pad or a TV there is no physical
                    delete key, and the on-screen keyboard is not always what a
                    player reaches for. */}
                <button
                  class="ps2-code-clear" type="button" disabled={!joinInput()}
                  onClick={() => { sfx.back(); setJoinInput(""); }}
                >Clear</button>
                <button class="ps2-launch" disabled={joinInput().length !== 4} onClick={() => joinGame(joinInput())}>▶ &nbsp;CONNECT</button>
                <button class="ps2-join-btn" onClick={() => { sfx.back(); setJoinStage(""); }}>↩ &nbsp;BACK</button>
              </div>
            </Show>

            <Show when={stage() === "reading"}>
              <div class="ps2-gate">
                <div class="session-disc ps2-spin"><div class="session-disc-hole" /></div>
                <div class="session-reading-text">Reading disc…</div>
                <div class="session-reading-name">{disc()?.name}</div>
              </div>
            </Show>

            <Show when={stage() === "error"}>
              <div class="ps2-gate">
                <div class="ps2-big">Disc read error.</div>
                <p class="ps2-warn">{err()}</p>
                <button class="ps2-launch" onClick={() => { setStage("insert"); setErr(""); }}>↩ &nbsp;TRY ANOTHER DISC</button>
              </div>
            </Show>
          </div>
        </Show>

        {/* diagnostics + share-log for the local emulator (Play! traces via
            /diag-core.js in /play/index.html — console aborts, failed loads) */}
        <DiagOverlay frame={() => frame} label="PlayStation 2 · Play!" open={showDiag()} onClose={() => setShowDiag(false)} />

        <input
          type="file"
          ref={fileInput}
          hidden
          accept=".iso,.cso,.chd,.isz,.bin,.elf"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (f) insert(f);
          }}
        />
      </Show>
    </div>
  );
}
