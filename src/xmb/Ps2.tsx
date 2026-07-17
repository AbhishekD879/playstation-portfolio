// PlayStation 2 — Play! (jpd002/Play-, BSD) SELF-HOSTED at /play/, driven by
// our own PlayStation-style UI: disc-insert screen, spinning-disc load, full-
// bleed canvas, Xbox-pad → PS2 mapping via the gamepad bridge (same-origin
// iframe, so synthesized keys reach the emulator). ISOs are read locally.
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import * as sfx from "../audio";
import { setNavEnabled } from "../input";
import { startBridge, stopBridge, touchKey, PS2_CONFIG } from "../gamepadBridge";
import TouchPad, { type TB } from "./TouchPad";
import { Icon } from "./icons";
import { startHost, startJoiner, type HostHandle, type JoinerHandle } from "../ps2mp/webrtc";
import { captureLocalInput, makeInjector, type PadState } from "../ps2mp/input";
import { bumpPlays, resolveGameFile, type GameRecord } from "../gamesdb";

type Stage = "insert" | "reading" | "playing" | "error";

export default function Ps2(props: { onClose: () => void; profileId: string; initialGame?: GameRecord; initialJoin?: boolean }) {
  const isDesktop = matchMedia("(pointer: fine)").matches && innerWidth >= 900 && typeof WebAssembly === "object";
  const isolated = (globalThis as any).crossOriginIsolated === true;
  const canEmulate = isDesktop && isolated;
  const saveKey = `ps2:${props.profileId}`; // one memory card per profile
  const [stage, setStage] = createSignal<Stage>("insert");
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
  const requestSave = () => frame?.contentWindow?.postMessage({ type: "play-save", saveKey }, location.origin);
  const [saveNote, setSaveNote] = createSignal("");

  // —— multiplayer (host-authoritative WebRTC streaming) ————————————————————
  // Host: streams the emulator canvas to a joiner and injects the joiner's
  // input as controller port 2. Joiner: watches the stream and sends input —
  // no emulator runs on the joiner. See ../ps2mp.
  type MpRole = "none" | "host" | "joiner";
  const [mpRole, setMpRole] = createSignal<MpRole>("none");
  const [mpCode, setMpCode] = createSignal("");
  const [mpStatus, setMpStatus] = createSignal("");
  const [mpPlayers, setMpPlayers] = createSignal(0);
  const [joinStage, setJoinStage] = createSignal<"" | "code" | "connecting" | "live">("");
  const [joinInput, setJoinInput] = createSignal("");
  let hostHandle: HostHandle | null = null;
  let joinerHandle: JoinerHandle | null = null;
  let stopCapture: (() => void) | null = null;
  let injector: ReturnType<typeof makeInjector> | null = null;
  let joinVideo: HTMLVideoElement | undefined;

  const genCode = () => {
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
    return Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join("");
  };

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

  function hostGame() {
    const canvas = frame.contentDocument?.getElementById("outputCanvas") as HTMLCanvasElement | null;
    const win = frame.contentWindow as any;
    if (!canvas || !win?.__p2codes || !(canvas as any).captureStream) { setMpStatus("emulator not ready — boot a game first"); return; }
    sfx.confirm();
    const stream = (canvas as any).captureStream(30) as MediaStream;
    injector = makeInjector(win, canvas, win.__p2codes);
    const code = genCode();
    setMpCode(code); setMpRole("host"); setMpPlayers(0);
    hostHandle = startHost({
      room: code, max: 1, stream,
      onJoinerInput: (_id, data: any) => {
        if (data?.t === "input" && injector) {
          injector.applyState({ down: data.down ?? [], axes: data.axes ?? { lx: 0, ly: 0, rx: 0, ry: 0 } } as PadState);
        }
      },
      onJoinerChange: (ids) => { setMpPlayers(ids.length); if (ids.length === 0) injector?.release(); },
      onStatus: (s) => setMpStatus(s),
    });
  }

  function stopHost() {
    hostHandle?.stop(); hostHandle = null;
    injector?.release(); injector = null;
    setMpRole("none"); setMpCode(""); setMpStatus(""); setMpPlayers(0);
  }

  function joinGame(code: string) {
    if (!code) return;
    sfx.confirm();
    setMpRole("joiner"); setMpCode(code); setJoinStage("connecting"); setMpStatus("connecting…");
    setNavEnabled(false); // controller/keys belong to the remote game now
    joinerHandle = startJoiner({
      room: code,
      onStream: (stream) => {
        setJoinStage("live"); setMpStatus("connected");
        if (joinVideo) { joinVideo.srcObject = stream; joinVideo.play().catch(() => {}); }
      },
      onStatus: (s) => setMpStatus(s),
    });
    stopCapture = captureLocalInput((state) => joinerHandle?.sendInput({ t: "input", down: state.down, axes: state.axes }));
  }

  function leaveJoin() {
    sfx.back();
    stopCapture?.(); stopCapture = null;
    joinerHandle?.stop(); joinerHandle = null;
    setJoinStage(""); setMpRole("none"); setMpCode(""); setMpStatus("");
    setNavEnabled(true);
  }

  const goFullscreen = () => {
    const el = container as any;
    if (document.fullscreenElement) return;
    (el.requestFullscreen?.({ navigationUI: "hide" }) ?? el.webkitRequestFullscreen?.())?.catch?.(() => {});
  };
  const exitFullscreen = () => {
    if (document.fullscreenElement) (document.exitFullscreen?.() ?? (document as any).webkitExitFullscreen?.())?.catch?.(() => {});
  };

  onMount(() => {
    if (props.initialJoin) setJoinStage("code"); // opened straight into "join a game"
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && stage() !== "playing") props.onClose(); };
    addEventListener("keydown", esc);
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== location.origin || !e.data?.type) return;
      if (e.data.type === "play-ready") {
        ready = true;
        if (pending) bootNow(pending);
        else if (props.initialGame) bootRecord(props.initialGame, true); // auto-boot the library pick
      }
      if (e.data.type === "play-booted") {
        setStage("playing");
        setNavEnabled(false); // keyboard belongs to the PS2 now
        // Play! registers its key listeners ON the canvas element (not the
        // document), so the bridge must dispatch straight onto it.
        startBridge(frame.contentDocument?.getElementById("outputCanvas") ?? frame.contentDocument, () => {}, PS2_CONFIG);
        frame.contentWindow?.focus();
        // auto-save the memory card every 15s so progress survives a reload
        saveTimer = setInterval(requestSave, 15_000);
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
      stopCapture?.();
      hostHandle?.stop();
      joinerHandle?.stop();
      injector?.release();
      setNavEnabled(true);
      exitFullscreen();
    });
  });

  function bootNow(f: File) {
    pending = null;
    frame.contentWindow?.postMessage({ type: "play-boot", file: f, saveKey }, location.origin);
  }

  function insert(f: File) {
    sfx.confirm();
    setDisc(f);
    setStage("reading");
    goFullscreen(); // still inside the user gesture
    pending = f;
    if (ready) bootNow(f);
    // if not ready yet, play-ready handler boots it
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
                <button class="ps2-launch" onClick={() => { sfx.tickH(); setJoinStage("code"); setJoinInput(""); }}>🎮 &nbsp;JOIN A 2-PLAYER GAME</button>
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
        <Show when={mpRole() !== "joiner" && canEmulate}>
          <iframe
            ref={frame}
            class="ps2-frame"
            classList={{ live: stage() === "playing" }}
            src="/play/index.html"
            allow="autoplay; fullscreen; gamepad; cross-origin-isolated"
            title="PlayStation 2"
          />
        </Show>

        {/* joiner view — full-bleed stream of the host's game + our input */}
        <Show when={mpRole() === "joiner"}>
          <div class="ps2-join-view">
            <video ref={joinVideo} class="ps2-join-video" classList={{ live: joinStage() === "live" }} autoplay playsinline muted />
            <Show when={joinStage() !== "live"}>
              <div class="ps2-gate ps2-join-connecting">
                <div class="session-disc ps2-spin"><div class="session-disc-hole" /></div>
                <div class="session-reading-text">Joining room {mpCode()}…</div>
                <div class="session-reading-name">{mpStatus() || "connecting"}</div>
              </div>
            </Show>
            <div class="ps2-bar">
              <span class="flash-now">🎮 Player 2 · room {mpCode()} · {mpStatus()}</span>
              <span class="flash-bar-btns">
                <button class="ghost-btn" onClick={leaveJoin}>⏏ leave</button>
              </span>
            </div>
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
                <button class="ghost-btn" onClick={hostGame}>🎮 host 2-player</button>
              </Show>
              <Show when={mpRole() === "host"}>
                <span class="ps2-mp-code">ROOM {mpCode()} · {mpPlayers() ? `player 2 connected` : "waiting for player 2…"}</span>
                <button class="ghost-btn" onClick={stopHost}>✕ stop hosting</button>
              </Show>
              <button class="ghost-btn" onClick={() => requestSave()}>▪ save card</button>
              <button class="ghost-btn" onClick={goFullscreen}>⛶ full screen</button>
              <button class="ghost-btn" onClick={eject}>⏏ eject</button>
            </span>
          </div>
          <Show when={mpRole() === "host"}>
            <div class="ps2-mp-banner">
              <b>Hosting · room code {mpCode()}</b>
              <span>On another device or an incognito window, open this console → PlayStation 2 → “Join a game”, enter <b>{mpCode()}</b>. {mpStatus()}</span>
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
                <button class="ps2-join-btn" onClick={() => { sfx.tickH(); setJoinStage("code"); setJoinInput(""); }}>🎮 &nbsp;JOIN A 2-PLAYER GAME</button>
                <p class="ps2-warn">Experimental core — many titles run slowly or not at all. 🎮 Xbox pad mapped: A=✕ B=◯ X=◻ Y=△ · sticks work · Start/Back = Start/Select.</p>
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
                  onKeyDown={(e) => { if (e.key === "Enter" && joinInput().length === 4) joinGame(joinInput()); }}
                />
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
