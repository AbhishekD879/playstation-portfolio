// Counter-Strike 1.6 — the classic, running IN the browser (Xash3D-FWGS wasm).
// Bring-your-own game files (valve/ + cstrike/ from your own copy, zipped);
// cached in OPFS after the first pick, never uploaded. Play offline (YaPB bots
// ship in the wasm), HOST a match for friends (this tab runs a real listen
// server; traffic rides WebRTC DataChannels through the console's existing
// signaling worker + TURN), or JOIN a friend's room by code. Desktop-only —
// the engine has no touch support yet.
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import * as sfx from "../audio";
import { setNavEnabled } from "../input";
import type { Xash3D } from "xash3d-fwgs";
import type { CsHostHandle, CsJoinHandle } from "../cs/cs";

type Phase = "setup" | "boot" | "game";
type Mode = "offline" | "host" | "join";

export default function CsApp(props: { onClose: () => void }) {
  const [phase, setPhase] = createSignal<Phase>("setup");
  const [mode, setMode] = createSignal<Mode>("offline");
  const [hasFiles, setHasFiles] = createSignal<boolean | null>(null);
  const [progress, setProgress] = createSignal("");
  const [status, setStatus] = createSignal("");
  const [players, setPlayers] = createSignal(0);
  const [room, setRoom] = createSignal("");
  const [joinCode, setJoinCode] = createSignal("");
  const [error, setError] = createSignal("");
  let canvas!: HTMLCanvasElement;
  let fileInput!: HTMLInputElement;
  let engine: Xash3D | null = null;
  let mp: CsHostHandle | CsJoinHandle | null = null;
  let pickedFile: File | null = null;

  const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;

  onMount(() => {
    setNavEnabled(false); // the engine owns the keyboard; UI is pointer-driven
    void import("../cs/cs").then((m) => m.cachedZip().then((f) => { pickedFile = f; setHasFiles(!!f); }));
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && phase() === "setup") { sfx.back?.(); props.onClose(); } };
    addEventListener("keydown", esc);
    const size = () => { if (canvas) { canvas.width = innerWidth; canvas.height = innerHeight; } };
    size();
    addEventListener("resize", size);
    onCleanup(() => {
      setNavEnabled(true);
      removeEventListener("keydown", esc);
      removeEventListener("resize", size);
      mp?.stop();
      try { engine?.quit(); } catch { /* engine already gone */ }
    });
  });

  async function pickFile(f: File) {
    setError("");
    pickedFile = f;
    setHasFiles(true);
    sfx.confirm?.();
    const cs = await import("../cs/cs");
    void cs.cacheZip(f).then((ok) => { if (!ok) setStatus("couldn't cache the zip (low disk) — kept for this session only"); });
  }

  async function play(m: Mode) {
    if (!pickedFile) { setError("Pick your valve.zip first."); return; }
    if (m === "join" && joinCode().trim().length < 4) { setError("Enter the room code your friend shared."); return; }
    setError("");
    setMode(m);
    setPhase("boot");
    sfx.confirm?.();
    const cs = await import("../cs/cs");
    try {
      let wireNet: ((x: Xash3D) => void) | undefined;
      let afterBoot: ((x: Xash3D) => void) | undefined;

      if (m === "host") {
        const code = cs.newRoomCode(); // bare [A-Z0-9] — the signaling worker's room regex forbids separators
        setRoom(code);
        const h = cs.csHost(code, setStatus, setPlayers);
        wireNet = h.wireNet;
        mp = h.handle;
        afterBoot = (x) => { x.Cmd_ExecuteString("sv_lan 1"); x.Cmd_ExecuteString("maxplayers 8"); x.Cmd_ExecuteString("map de_dust2"); };
      } else if (m === "join") {
        let booted: Xash3D | null = null;
        let netReady = false;
        const tryConnect = () => { if (booted && netReady) booted.Cmd_ExecuteString("connect 127.0.0.1:8080"); };
        const j = cs.csJoin(joinCode().trim().toUpperCase(), setStatus, () => { netReady = true; tryConnect(); });
        wireNet = j.wireNet;
        mp = j.handle;
        afterBoot = (x) => { booted = x; tryConnect(); };
      }

      engine = await cs.bootCs({ canvas, zip: pickedFile, onProgress: setProgress, net: wireNet });
      setPhase("game");
      afterBoot?.(engine);
    } catch (e) {
      setPhase("setup");
      mp?.stop(); mp = null;
      setError(`Couldn't start: ${String((e as Error)?.message ?? e).slice(0, 140)}`);
      sfx.deny?.();
    }
  }

  const cmd = (c: string) => { try { engine?.Cmd_ExecuteString(c); } catch { /* engine gone */ } };

  return (
    <div class="csapp">
      <canvas ref={canvas} class="csapp-canvas" classList={{ hidden: phase() !== "game" }} />

      <Show when={phase() === "setup"}>
        <div class="csapp-setup">
          <div class="csapp-head">
            <div>
              <div class="panel-tag">COUNTER-STRIKE 1.6 — IN YOUR BROWSER · EXPERIMENTAL</div>
              <div class="csapp-sub">The real GoldSrc classic on the open Xash3D engine (WebAssembly). Your game files stay on this device.</div>
            </div>
            <button class="ps-act" onClick={() => { sfx.back?.(); props.onClose(); }}><span class="btn-o" /> back</button>
          </div>

          <Show when={touch}>
            <div class="csapp-warn">⚠ Desktop only for now — the engine needs a keyboard and mouse (no touch controls yet). You can still set up files here.</div>
          </Show>

          <div class="csapp-files" classList={{ ok: !!hasFiles() }}>
            <div class="csapp-files-status">{hasFiles() === null ? "Checking for saved game files…" : hasFiles() ? "✓ Game files ready (saved on this device)" : "① Bring your game files"}</div>
            <Show when={!hasFiles()}>
              <p class="csapp-note">
                CS 1.6's assets belong to Valve, so you bring your own copy: zip the <b>valve</b> and <b>cstrike</b> folders from your Counter-Strike install
                (Steam → right-click Counter-Strike → Manage → Browse local files) into one <b>valve.zip</b>, then pick it here. It's cached on this device — one time, never uploaded.
              </p>
            </Show>
            <div class="csapp-files-acts">
              <label class="ps2-launch csapp-pick" for="cs-zip">{hasFiles() ? "⏏ replace files…" : "📁 pick valve.zip"}</label>
              <Show when={hasFiles()}>
                <button class="ps-act" onClick={() => { void import("../cs/cs").then((m) => m.clearCache()); pickedFile = null; setHasFiles(false); sfx.tickV?.(); }}>remove saved files</button>
              </Show>
            </div>
            <input id="cs-zip" class="rpg-file-input" type="file" ref={fileInput} accept=".zip,application/zip"
              onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (f) void pickFile(f); }} />
          </div>

          <div class="csapp-modes" classList={{ dim: !hasFiles() }}>
            <div class="csapp-files-status">② Choose how to play</div>
            <div class="csapp-mode-grid">
              <button class="csapp-mode" disabled={!hasFiles()} onClick={() => void play("offline")}>
                <span class="csapp-mode-ico">🎯</span>
                <span class="csapp-mode-name">Play offline</span>
                <span class="csapp-mode-sub">Solo or vs YaPB bots — zero servers, instant</span>
              </button>
              <button class="csapp-mode" disabled={!hasFiles()} onClick={() => void play("host")}>
                <span class="csapp-mode-ico">📡</span>
                <span class="csapp-mode-name">Host a match</span>
                <span class="csapp-mode-sub">This tab becomes the server — share a room code, up to 7 friends (8 players) join over WebRTC</span>
              </button>
              <div class="csapp-mode csapp-mode-join" classList={{ off: !hasFiles() }}>
                <span class="csapp-mode-ico">🔑</span>
                <span class="csapp-mode-name">Join a match</span>
                <input class="csapp-code" placeholder="ROOM CODE" maxlength="6" value={joinCode()}
                  onInput={(e) => setJoinCode(e.currentTarget.value.toUpperCase())}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && hasFiles()) void play("join"); }} />
                <button class="ps-act" disabled={!hasFiles()} onClick={() => void play("join")}>join →</button>
              </div>
            </div>
            <div class="csapp-mp-note">Multiplayer is peer-to-peer (host's tab must stay open & focused) — experimental, friends both need their own game files.</div>
          </div>

          <Show when={error()}><div class="rpg-error">⚠ {error()}</div></Show>
          <Show when={status() && !error()}><div class="csapp-status">{status()}</div></Show>

          <div class="csapp-credits">
            Engine: <a href="https://github.com/FWGS/xash3d-fwgs" target="_blank" rel="noopener">Xash3D-FWGS</a> (GPLv3) ·
            <a href="https://github.com/Velaron/cs16-client" target="_blank" rel="noopener"> cs16-client</a> (GPLv2+) ·
            wasm port <a href="https://github.com/yohimik/webxash3d-fwgs" target="_blank" rel="noopener">webxash3d-fwgs</a> (MIT) ·
            bots <a href="https://github.com/yapb/yapb" target="_blank" rel="noopener">YaPB</a> (MIT). Game content © Valve — bring your own.
          </div>
        </div>
      </Show>

      <Show when={phase() === "boot"}>
        <div class="csapp-boot">
          <div class="csapp-boot-title">COUNTER-STRIKE 1.6</div>
          <div class="csapp-boot-msg">{progress()}</div>
          <Show when={mode() === "host" && room()}>
            <div class="csapp-room">room code <b>{room()}</b></div>
          </Show>
          <Show when={status()}><div class="csapp-status">{status()}</div></Show>
        </div>
      </Show>

      <Show when={phase() === "game"}>
        <div class="csapp-bar">
          <Show when={mode() === "host"}>
            <span class="csapp-room-pill">room <b>{room()}</b> · {players()} joined</span>
            <button class="ps-act" onClick={() => cmd("yb add")}>+ bot</button>
          </Show>
          <Show when={mode() === "offline"}>
            <button class="ps-act" onClick={() => cmd("map de_dust2")}>de_dust2</button>
            <button class="ps-act" onClick={() => cmd("yb add")}>+ bot</button>
          </Show>
          <Show when={mode() === "join" && status()}><span class="csapp-room-pill">{status()}</span></Show>
          <button class="ps-act" onClick={() => { const el = document.querySelector(".csapp") as HTMLElement; void el?.requestFullscreen?.().catch(() => {}); }}>⛶</button>
          <button class="ps-act" onClick={() => { sfx.back?.(); props.onClose(); }}>✕ quit</button>
        </div>
      </Show>
    </div>
  );
}
