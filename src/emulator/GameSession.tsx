// The disc drive. EmulatorJS mounts in the top document (iframes lose gamepad
// focus). One disc per page load — ejecting restarts the console, which is
// what a real console does anyway. ROMs are blob URLs; nothing is uploaded.
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import gsap from "gsap";
import { bumpPlays, isLinked, resolveGameFile, type GameRecord } from "../gamesdb";
import { setNavEnabled } from "../input";
import { EJS_CONFIG, startBridge, stopBridge } from "../gamepadBridge";

declare global {
  interface Window {
    EJS_player?: string;
    EJS_core?: string;
    EJS_gameUrl?: string;
    EJS_gameName?: string;
    EJS_pathtodata?: string;
    EJS_language?: string;
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
    window.EJS_player = "#ejs-mount";
    window.EJS_core = props.game.core;
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
      if (el) { clearInterval(findEjs); startBridge(el, () => {}, EJS_CONFIG); }
    }, 500);

    onCleanup(() => { clearTimeout(timer); clearInterval(findEjs); stopBridge(); });
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
      <button class="session-eject" onClick={eject} title="Eject disc & restart console">⏏ EJECT</button>
    </div>
  );
}
