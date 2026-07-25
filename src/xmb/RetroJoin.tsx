// Player two for retro netplay. Runs NO emulator: it watches the host's video
// and streams controller state back, which the host injects as player 2 through
// EmulatorJS's simulateInput. That means a phone or a weak laptop can play SNES
// co-op with someone who has the ROM — the joiner needs no game file at all.
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { startJoiner, type JoinerHandle } from "../ps2mp/webrtc";
import { captureLocalInput } from "../ps2mp/input";
import { setNavEnabled } from "../input";
import TouchPad from "./TouchPad";
import { Icon } from "./icons";
import * as sfx from "../audio";

export default function RetroJoin(props: { onClose: () => void; code?: string }) {
  const [stage, setStage] = createSignal<"code" | "connecting" | "live">(props.code ? "connecting" : "code");
  const [status, setStatus] = createSignal("");
  const [code, setCode] = createSignal(props.code ?? "");
  let joiner: JoinerHandle | null = null;
  let stopCapture: (() => void) | null = null;
  let video: HTMLVideoElement | undefined;

  const join = (c: string) => {
    const room = c.trim().toUpperCase();
    if (!room) return;
    sfx.confirm?.();
    setCode(room); setStage("connecting"); setStatus("connecting…");
    setNavEnabled(false); // the pad belongs to the remote game now
    joiner = startJoiner({
      room,
      onStream: (s) => {
        setStage("live"); setStatus("");
        if (video) { video.srcObject = s; video.play().catch(() => {}); }
      },
      onStatus: (st) => setStatus(st),
    });
    // the same capture the PS2 joiner uses — one controller vocabulary for both
    stopCapture = captureLocalInput((st) => joiner?.sendInput({ t: "input", down: st.down, axes: st.axes }));
  };

  const leave = () => {
    sfx.back?.();
    stopCapture?.(); stopCapture = null;
    joiner?.stop(); joiner = null;
    setNavEnabled(true);
    props.onClose();
  };

  onMount(() => {
    if (props.code) join(props.code);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") leave(); };
    addEventListener("keydown", esc);
    onCleanup(() => { removeEventListener("keydown", esc); stopCapture?.(); joiner?.stop(); setNavEnabled(true); });
  });

  // the touch pad synthesises the very keys captureLocalInput already listens for
  const key = (on: boolean, code2: string) =>
    dispatchEvent(new KeyboardEvent(on ? "keydown" : "keyup", { code: code2, bubbles: true }));
  const DPAD = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };
  const FACE: Record<number, string> = { 0: "KeyZ", 1: "KeyX", 2: "KeyA", 3: "KeyS" };

  return (
    <div class="bg-root pad-focus-scope">
      <div class="bg-head">
        <div class="panel-tag">RETRO · PLAYER TWO</div>
        <Show when={stage() === "live"}><div class="bg-turn mine">connected</div></Show>
        <button class="ps-act" onClick={leave}><span class="btn-o" /> leave</button>
      </div>

      <Show when={stage() === "code"}>
        <div class="bg-lobby">
          <div class="bg-lobby-head">
            <div class="panel-tag">JOIN A GAME</div>
            <p>Your friend hosts the game on their console and reads you the room code. You don't need the game file — their console runs it and streams the picture here.</p>
          </div>
          <div class="bg-rows">
            <div class="bg-grow bg-grow-join">
              <span class="bg-grow-ic"><Icon name="gamepad" /></span>
              <span class="bg-grow-head">
                <span class="bg-grow-name">Room code</span>
                <span class="bg-grow-sub">4 characters, shown on the host's screen</span>
              </span>
              <span class="bg-grow-acts">
                <input class="bg-codein" placeholder="CODE" maxlength={8} autocomplete="off" autocapitalize="characters"
                  onInput={(e) => setCode(e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") join(code()); }} />
                <button class="ps-act" disabled={!code()} onClick={() => join(code())}>Join</button>
              </span>
            </div>
          </div>
          <div class="ps-legend"><span><span class="btn-x" /> join</span><span><span class="btn-o" /> back</span></div>
        </div>
      </Show>

      <Show when={stage() !== "code"}>
        <div class="ps2-join-view">
          <video ref={video} class="ps2-join-video" classList={{ live: stage() === "live" }} autoplay playsinline muted />
          <Show when={stage() !== "live"}>
            <div class="bg-connecting">
              <div class="bg-spinner" />
              <p>Joining room {code()}… {status()}</p>
              <button class="ps-act" onClick={leave}><span class="btn-o" /> cancel</button>
            </div>
          </Show>
          <Show when={stage() === "live"}>
            <TouchPad
              dpad={(d, on) => key(on, DPAD[d])}
              face={[
                { label: "X", cls: "gp-n", press: (on: boolean) => key(on, FACE[3]) },
                { label: "Y", cls: "gp-w", press: (on: boolean) => key(on, FACE[2]) },
                { label: "A", cls: "gp-e", press: (on: boolean) => key(on, FACE[1]) },
                { label: "B", cls: "gp-s", press: (on: boolean) => key(on, FACE[0]) },
              ]}
              pills={[
                { label: "SELECT", press: (on: boolean) => key(on, "Backspace") },
                { label: "START", press: (on: boolean) => key(on, "Enter") },
              ]}
              shoulderL={[{ label: "L", press: (on: boolean) => key(on, "KeyQ") }]}
              shoulderR={[{ label: "R", press: (on: boolean) => key(on, "KeyW") }]}
            />
          </Show>
        </div>
      </Show>
    </div>
  );
}
