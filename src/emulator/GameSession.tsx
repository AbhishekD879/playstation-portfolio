// The disc drive. EmulatorJS mounts in the top document (iframes lose gamepad
// focus). One disc per page load — ejecting restarts the console, which is
// what a real console does anyway. ROMs are blob URLs; nothing is uploaded.
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import gsap from "gsap";
import { bumpPlays, isLinked, resolveGameFile, type GameRecord } from "../gamesdb";
import { setNavEnabled } from "../input";
import { holdWakeLock } from "../wakelock";
import { EJS_CONFIG, PSP_CONFIG, setBridgePaused, setPrimaryIndex, startBridge, stopBridge } from "../gamepadBridge";
import { biosZipFor } from "../bios";
import { SYSTEMS } from "../systems";
import { startHost, type HostHandle } from "../ps2mp/webrtc";
import { newPartyCode } from "../party/net";
import { ejsCanvas, ejsSimulateInput, makeRetroInjector, type RetroInjector } from "../retromp";
import { claimGamepadPress, startLocalPad2 } from "../ps2mp/input";
import { setShareLabel } from "../xmb/ShareBar";

declare global {
  interface Window {
    EJS_player?: string;
    EJS_core?: string;
    EJS_biosUrl?: string | File;
    EJS_gameUrl?: string;
    EJS_gameName?: string;
    EJS_pathtodata?: string;
    EJS_language?: string;
    EJS_threads?: boolean;
    EJS_startOnLoaded?: boolean;
    EJS_backgroundColor?: string;
    EJS_emulator?: { pauseMainLoop?: () => void };
  }
}

// EmulatorJS is pinned ("stable" shifts under you) and language is forced —
// auto-detected locales like en-GB have no CDN translation and crash the loader.
const EJS_VERSION = "4.2.3";

export default function GameSession(props: { game: GameRecord; profileId: string }) {
  const [reading, setReading] = createSignal(true);
  // "permission" → linked file needs a fresh grant; "missing" → file moved
  const [blocked, setBlocked] = createSignal<"permission" | "missing" | null>(null);
  let disc!: HTMLDivElement;
  let started = false;

  // —— netplay: up to FOUR players ————————————————————————————————————————
  // We stream this emulator's canvas and inject each joiner's controller
  // through EmulatorJS's own simulateInput. Only one emulator ever runs, so no
  // screen can desync. Same rig as PS2 multiplayer.
  //
  // ★ Why four and not more: EmulatorJS itself tops out at four controllers —
  // its control map is `{0:{},1:{},2:{},3:{}}` and its bindings UI builds
  // exactly four player tabs. That matches the hardware anyway (an SNES/N64
  // multitap is 4), so four is the real ceiling, not a number we picked.
  // Anyone beyond the fourth can still join as a WATCHER, which costs no slot.
  const MAX_PLAYERS = 4;                 // includes the host
  const [mpCode, setMpCode] = createSignal("");
  const [mpPeers, setMpPeers] = createSignal(0);
  const [mpNote, setMpNote] = createSignal("");
  const [watchers, setWatchers] = createSignal(0);
  const [listed, setListed] = createSignal(false);
  let hostH: HostHandle | null = null;
  // joinerId → { player index (1-3), injector }. Seats are assigned on arrival
  // and RELEASED on leave, so the next joiner reuses the free pad rather than
  // being handed a fifth one that no core would listen to.
  const seats = new Map<string, { slot: number; inj: RetroInjector }>();

  function releaseSeats() {
    for (const s of seats.values()) s.inj.release();
    seats.clear();
  }

  // One room serves both audiences: players get an input channel, watchers
  // don't. `broadcast` only decides whether the room is ADVERTISED on Console
  // TV — a private room is still watchable by anyone you hand the code to.
  function hostRoom(broadcast: boolean) {
    const canvas = ejsCanvas();
    const sim = ejsSimulateInput();
    if (!canvas || !sim) { setMpNote("the game is still loading — try again in a moment"); return; }
    if (!(canvas as any).captureStream) { setMpNote("this browser can't share the screen"); return; }
    const code = newPartyCode();
    setMpCode(code); setMpNote(""); setListed(broadcast);
    hostH = startHost({
      room: code,
      max: MAX_PLAYERS - 1,              // the host holds player one
      stream: (canvas as any).captureStream(30) as MediaStream,
      listing: broadcast ? { title: props.game.name, kind: props.game.core } : undefined,
      onJoinerInput: (id, data: any) => {
        if (data?.t !== "input") return;
        const seat = seats.get(id);
        if (!seat) return;               // a watcher, or a seat we couldn't grant
        seat.inj.applyState({ down: data.down ?? [], axes: data.axes ?? { lx: 0, ly: 0, rx: 0, ry: 0 } });
      },
      onJoinerChange: (ids) => {
        // drop anyone who left, freeing their pad
        for (const [id, s] of [...seats]) {
          if (!ids.includes(id)) { s.inj.release(); seats.delete(id) }
        }
        // seat anyone new in the lowest free pad
        for (const id of ids) {
          if (seats.has(id)) continue;
          const taken = new Set([...seats.values()].map((s) => s.slot));
          let slot = 1;
          while (slot < MAX_PLAYERS && taken.has(slot)) slot++;
          if (slot >= MAX_PLAYERS) continue;   // full: they stay connected but padless
          seats.set(id, { slot, inj: makeRetroInjector(sim, slot) }); // 0-based: 1 = player two
        }
        setMpPeers(seats.size);
      },
      onWatcherChange: setWatchers,
      onStatus: (st) => setMpNote(st),
    });
  }
  const hostTwoPlayer = () => hostRoom(false);
  const hostBroadcast = () => hostRoom(true);

  // —— local couch co-op: extra physical pads on THIS machine ————————————
  // Player one keeps the normal pad→keyboard bridge (EmulatorJS's own port 0);
  // players two to four are polled straight off their gamepad and pushed into
  // the same per-player injectors the netplay host uses. Each player claims a
  // pad with a button press, which is also the moment the Gamepad API first
  // admits that controller exists.
  const claimed: number[] = [];                     // gamepad indices already taken
  const [couch, setCouch] = createSignal(0);        // extra local pads, 0-3
  const [couchNote, setCouchNote] = createSignal("");
  let stopCouch: (() => void)[] = [];
  let cancelClaim: (() => void) | null = null;

  function endCouch() {
    cancelClaim?.(); cancelClaim = null;
    for (const s of stopCouch) s();
    stopCouch = [];
    claimed.length = 0;
    setPrimaryIndex(null);          // player one may use any pad again
    setBridgePaused(false);
    setCouch(0); setCouchNote("");
  }

  async function addLocalPlayer() {
    const sim = ejsSimulateInput();
    if (!sim) { setCouchNote("boot a game first"); return }
    const slot = couch() + 1;                        // 1..3 → players two to four
    if (slot >= MAX_PLAYERS) { setCouchNote(`${MAX_PLAYERS} players is the core's limit`); return }
    // ★ Player one's bridge listens to EVERY pad by default, so before a second
    // player exists we must pin it to one controller — otherwise the new pad
    // would drive both players at once. Player one claims first, exactly once.
    setBridgePaused(true);                           // freeze P1 during the claim
    try {
      if (!claimed.length) {
        setCouchNote("player 1: press any button on YOUR controller…");
        const c1 = claimGamepadPress(null);
        cancelClaim = c1.cancel;
        const p1 = await c1.promise;
        claimed.push(p1);
        setPrimaryIndex(p1);                         // lock port 0 to player one
      }
      setCouchNote(`player ${slot + 1}: press any button on your controller…`);
      const claim = claimGamepadPress(claimed);
      cancelClaim = claim.cancel;
      const idx = await claim.promise;
      cancelClaim = null;
      claimed.push(idx);
      const inj = makeRetroInjector(sim, slot);
      stopCouch.push(startLocalPad2(() => idx, inj));
      setCouch(slot);
      setCouchNote("");
    } catch {
      cancelClaim = null;
      setCouchNote("");                              // cancelled — no harm done
    } finally {
      setBridgePaused(false);                        // player one plays again either way
    }
  }

  function stopHosting() {
    hostH?.stop(); hostH = null;
    releaseSeats();
    setMpCode(""); setMpPeers(0); setMpNote(""); setWatchers(0); setListed(false);
  }

  // resolve the ROM (streaming from disk for linked games) then hand it to EJS
  async function boot(request: boolean) {
    let file: Blob;
    try {
      file = await resolveGameFile(props.game, { request });
    } catch (e: any) {
      setBlocked(e?.cause === "permission" ? "permission" : "missing");
      return;
    }
    if (started) return;
    started = true;
    setBlocked(null);
    bumpPlays(props.game.id);

    const blobUrl = URL.createObjectURL(file);
    // firmware the player supplied for this system, as one zip (see bios.ts);
    // EmulatorJS unpacks it beside the ROM with each file's real name
    const bios = await biosZipFor(props.game.core).catch(() => null);
    window.EJS_player = "#ejs-mount";
    // the registry knows when the CDN alias differs from our id (ZX Spectrum → fuse)
    window.EJS_core = SYSTEMS[props.game.core]?.ejsCore ?? props.game.core;
    if (bios) window.EJS_biosUrl = bios;
    // PSP (PPSSPP) needs SharedArrayBuffer threads — we ship COOP/COEP so the
    // top document is cross-origin isolated. Harmless/unused for lighter cores.
    window.EJS_threads = props.game.core === "psp";
    window.EJS_gameUrl = blobUrl;
    window.EJS_gameName = props.game.name.replace(/\.[^.]+$/, "");
    window.EJS_pathtodata = `https://cdn.emulatorjs.org/${EJS_VERSION}/data/`;
    window.EJS_language = "en-US";
    window.EJS_startOnLoaded = true;
    window.EJS_backgroundColor = "#000208";

    const s = document.createElement("script");
    s.src = `https://cdn.emulatorjs.org/${EJS_VERSION}/data/loader.js`;
    document.body.appendChild(s);
    setReading(false);
  }

  onMount(() => {
    setNavEnabled(false);
    const releaseLock = holdWakeLock(); // the screen stays on while the disc spins
    onCleanup(releaseLock);
    // stamp Share clips with the game, not the app ("Chrono Trigger", not "Retro")
    setShareLabel(props.game.name);
    onCleanup(() => setShareLabel(""));
    gsap.to(disc, { rotation: 720, duration: 2.2, ease: "power2.inOut", repeat: -1 });
    // brief spin, then boot. For a granted/copied game this is seamless; a
    // lapsed link falls through to the grant button (needs a user gesture).
    const timer = setTimeout(() => boot(true), 2000);

    // Controller support: EmulatorJS listens for KEYBOARD input on its own
    // .ejs_parent element (and its native gamepad handler chokes on phantom
    // duplicate pads), so once that element exists, run the pad→keyboard
    // bridge straight onto it with EJS's default bindings.
    const findEjs = setInterval(() => {
      const el = document.querySelector(".ejs_parent");
      if (el) { clearInterval(findEjs); startBridge(el, () => {}, props.game.core === "psp" ? PSP_CONFIG : EJS_CONFIG); }
    }, 500);

    onCleanup(() => { clearTimeout(timer); clearInterval(findEjs); stopBridge(); stopHosting(); endCouch(); });
  });

  function eject() {
    // EmulatorJS can't re-init in-page → restart the console straight to the XMB
    sessionStorage.setItem("asp.resume", props.profileId);
    location.reload();
  }

  return (
    <div class="session">
      <Show when={reading()}>
        <div class="session-reading">
          <div class="session-disc" ref={disc}>
            <div class="session-disc-hole" />
          </div>
          <Show when={!blocked()} fallback={
            <>
              <div class="session-reading-text">
                {blocked() === "permission" ? "This game lives on your disk" : "That file has moved"}
              </div>
              <div class="session-reading-name">{props.game.name}</div>
              <Show when={blocked() === "permission"} fallback={
                <div class="session-grant-hint">Open the Game Library and press R on it to re-link the file.</div>
              }>
                <button class="ps2-launch" onClick={() => boot(true)}>▶ &nbsp;Grant disk access & play</button>
                <div class="session-grant-hint">{isLinked(props.game) ? "Linked games stream from your drive — one click and it's yours." : ""}</div>
              </Show>
            </>
          }>
            <div class="session-reading-text">Reading disc…</div>
            <div class="session-reading-name">{props.game.name}</div>
          </Show>
        </div>
      </Show>
      <div id="ejs-mount" />
      <Show when={!reading()}>
        <div class="session-mp">
          <Show when={!mpCode()} fallback={
            <>
              <span class="session-mp-code">
                ROOM <b>{mpCode()}</b> · {mpPeers()
                  ? `${mpPeers() + 1} of ${MAX_PLAYERS} players`
                  : `waiting for players — up to ${MAX_PLAYERS}`}
                <Show when={listed()}> · on Console TV</Show>
                <Show when={watchers() > 0}> · {watchers()} watching</Show>
              </span>
              <button class="ps-act" onClick={() => void navigator.clipboard?.writeText(`${location.origin}${location.pathname}?tv=${mpCode()}`)}>
                copy watch link
              </button>
              <button class="ps-act" onClick={stopHosting}>stop</button>
            </>
          }>
            <button class="ps-act" onClick={hostTwoPlayer}>play online (up to {MAX_PLAYERS})</button>
            <button class="ps-act" onClick={hostBroadcast}>let people watch</button>
            <Show when={couch() === 0} fallback={
              <>
                <span class="session-mp-code">{couch() + 1} players on this screen</span>
                <Show when={couch() < MAX_PLAYERS - 1}>
                  <button class="ps-act" onClick={() => void addLocalPlayer()}>add another pad</button>
                </Show>
                <button class="ps-act" onClick={endCouch}>solo again</button>
              </>
            }>
              <button class="ps-act" onClick={() => void addLocalPlayer()}>add a controller here</button>
            </Show>
            <Show when={couchNote()}><span class="session-mp-note">{couchNote()}</span></Show>
          </Show>
          <Show when={mpNote()}><span class="session-mp-note">{mpNote()}</span></Show>
        </div>
      </Show>
      <button class="session-eject" onClick={eject} title="Eject disc & restart console">⏏ EJECT</button>
    </div>
  );
}
