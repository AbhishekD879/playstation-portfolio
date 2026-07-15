// Flash Arcade — Ruffle (WASM Flash emulator) + the Internet Archive's Flash
// collection, searched live. Games stream straight into memory and vanish when
// you leave; visitors can also run their own .swf files. Nothing is stored.
import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { searchArchive, findSwf, type IAItem } from "../apps";
import type { NavAction } from "../input";
import * as sfx from "../audio";
import { setNavEnabled } from "../input";
import { startBridge, stopBridge } from "../gamepadBridge";
import TileGrid, { COLS } from "./TileGrid";

declare global {
  interface Window { RufflePlayer?: { newest: () => { createPlayer: () => any } } }
}

export default function Flash(props: { onClose: () => void; bind: (nav: (a: NavAction) => void) => void }) {
  const [items, setItems] = createSignal<IAItem[] | null>(null);
  const [q, setQ] = createSignal("");
  const [sel, setSel] = createSignal(0);
  const [playing, setPlaying] = createSignal<string | null>(null); // title while in-game (local swf)
  const [embed, setEmbed] = createSignal<IAItem | null>(null); // archive game via their player
  const [loading, setLoading] = createSignal("");
  const [fsKey, setFsKey] = createSignal(1); // bump → remount iframe at new size
  let input!: HTMLInputElement;
  let mount!: HTMLDivElement;
  let player: any = null;
  let fileInput!: HTMLInputElement;
  let container!: HTMLDivElement;
  let searchSeq = 0;

  // real fullscreen (whole monitor, hides browser chrome). Called from the
  // play click/keypress so it counts as a user gesture; silently ignored if
  // the browser refuses.
  const goFullscreen = () => {
    const el = container as any;
    if (document.fullscreenElement) return;
    (el.requestFullscreen?.({ navigationUI: "hide" }) ?? el.webkitRequestFullscreen?.())?.catch?.(() => {});
  };
  const exitFullscreen = () => {
    if (document.fullscreenElement) (document.exitFullscreen?.() ?? (document as any).webkitExitFullscreen?.())?.catch?.(() => {});
  };

  async function runSearch(query: string) {
    const seq = ++searchSeq;
    const r = await searchArchive("softwarelibrary_flash_games", query).catch(() => []);
    if (seq === searchSeq) { setItems(r); setSel(0); }
  }

  onMount(() => {
    // ruffle runtime from CDN
    if (!window.RufflePlayer) {
      const s = document.createElement("script");
      s.src = "https://unpkg.com/@ruffle-rs/ruffle";
      document.body.appendChild(s);
    }
    runSearch("");
    setTimeout(() => input?.focus(), 60);
    // the archive player sizes its canvas on load; entering/leaving fullscreen
    // changes the container, so remount the iframe to re-init at the new size
    const onFs = () => { if (embed()) setFsKey((k) => k + 1); };
    document.addEventListener("fullscreenchange", onFs);
    onCleanup(() => document.removeEventListener("fullscreenchange", onFs));
  });
  onCleanup(() => { stopGame(); exitFullscreen(); });

  function stopGame() {
    stopBridge();
    player?.remove?.();
    player = null;
    setPlaying(null);
    setNavEnabled(true);
    exitFullscreen();
  }

  async function play(item: IAItem) {
    // Pull the .swf via archive's CORS endpoint and run it in OUR Ruffle so we
    // control the canvas size (it fills). If that fails, fall back to archive's
    // own embed player (smaller, but always works).
    sfx.confirm();
    goFullscreen(); // still inside the click/keypress gesture
    setPlaying(item.title);
    setLoading(`Loading ${item.title}…`);
    try {
      const url = await findSwf(item.id);
      if (!url) throw new Error("no swf");
      const buf = await (await fetch(url)).arrayBuffer();
      if (playing() !== item.title) return; // user backed out mid-load
      startRuffle(buf, item.title);
    } catch {
      setPlaying(null);
      setLoading("");
      setEmbed(item); // graceful fallback to archive's embed player
    }
  }

  function startRuffle(data: ArrayBuffer, title: string) {
    if (!window.RufflePlayer) { setLoading("Ruffle is still loading — try again in a second."); return; }
    setLoading("");
    goFullscreen();
    setPlaying(title);
    setNavEnabled(false); // the game owns the keyboard
    player = window.RufflePlayer.newest().createPlayer();
    player.style.width = "100%";
    player.style.height = "100%";
    mount.appendChild(player);
    // scale up to fill the stage, letterboxed to the game's aspect
    player.ruffle().load({ data, scale: "showAll", letterbox: "on", quality: "high", autoplay: "on", allowScriptAccess: false });
    player.focus?.();
    // route a physical controller into Ruffle (arrows / Z / X / Space)
    startBridge(player, () => { sfx.back(); stopGame(); });
  }

  const move = (d: number) => {
    const n = items()?.length ?? 0;
    if (!n) return;
    setSel(Math.max(0, Math.min(n - 1, sel() + d)));
    sfx.tickV();
  };

  props.bind((a) => {
    if (embed()) {
      if (a === "back") { sfx.back(); exitFullscreen(); setEmbed(null); }
      return;
    }
    if (playing()) return; // esc handled by the quit button; keys belong to the game
    if (a === "left") move(-1);
    if (a === "right") move(1);
    if (a === "up") move(-3);
    if (a === "down") move(3);
    if (a === "confirm") { const it = items()?.[sel()]; if (it) play(it); }
    if (a === "back") { sfx.back(); props.onClose(); }
  });

  return (
    <div class="guide flash" ref={container}>
      <Show when={embed()}>
        <div class="flash-play">
          <div class="flash-bar">
            <span class="flash-now">▶ {embed()!.title}</span>
            <span class="flash-bar-btns">
              <button class="ghost-btn" onClick={goFullscreen}>⛶ full screen</button>
              <button class="ghost-btn" onClick={() => { sfx.back(); exitFullscreen(); setEmbed(null); }}>⏏ quit</button>
            </span>
          </div>
          <div class="flash-stage">
            {/* keyed on fsKey so it remounts (and re-sizes its canvas) each
                time we enter/leave fullscreen */}
            <Show when={fsKey()} keyed>
              <iframe credentialless={true}
                src={`https://archive.org/embed/${embed()!.id}?fs=${fsKey()}`}
                allow="autoplay; fullscreen"
                title={embed()!.title}
              />
            </Show>
          </div>
        </div>
      </Show>
      <Show
        when={!playing() && !embed()}
        fallback={
          <Show when={playing()}>
            <div class="flash-play">
              <div class="flash-bar">
                <span class="flash-now">▶ {playing()}</span>
                <span class="flash-bar-btns">
                  <button class="ghost-btn" onClick={goFullscreen}>⛶ full screen</button>
                  <button class="ghost-btn" onClick={() => { sfx.back(); stopGame(); }}>⏏ quit</button>
                </span>
              </div>
              <div class="flash-stage" ref={mount}>
                <Show when={loading()}><div class="fullapp-status">{loading()}</div></Show>
              </div>
            </div>
          </Show>
        }
      >
        <div class="guide-head">
          <div>
            <div class="panel-tag">FLASH ARCADE — LIVE FROM THE INTERNET ARCHIVE · RUFFLE WASM</div>
            <input
              ref={input}
              class="guide-search"
              placeholder="Search flash games…"
              value={q()}
              onInput={(e) => { setQ(e.currentTarget.value); runSearch(e.currentTarget.value); }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "ArrowDown") { e.preventDefault(); e.currentTarget.blur(); }
                if (e.key === "Enter") { const it = items()?.[sel()]; if (it) play(it); }
                if (e.key === "Escape") { sfx.back(); props.onClose(); }
              }}
            />
          </div>
          <div class="guide-count">
            <button class="ghost-btn" onClick={() => fileInput.click()}>run your own .swf</button>
          </div>
        </div>
        <Show when={items()} fallback={<div class="guide-loading">Rummaging through the archive…</div>}>
          <TileGrid
            tiles={items()!.map((it) => ({ img: `https://archive.org/services/img/${it.id}`, title: it.title }))}
            sel={sel()}
            cols={3}
            fallback="⚡"
            onPick={(i) => { setSel(i); play(items()![i]); }}
            onHover={(i) => setSel(i)}
          />
        </Show>
        <Show when={loading()}><div class="fullapp-status">{loading()}</div></Show>
        <div class="panel-hint guide-hint">
          games stream to memory & vanish on exit — nothing is installed · <span class="btn-x" /> play · <span class="btn-o" /> back
        </div>
        <input
          type="file" ref={fileInput} hidden accept=".swf"
          onChange={async (e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (f) startRuffle(await f.arrayBuffer(), f.name);
          }}
        />
      </Show>
    </div>
  );
}
