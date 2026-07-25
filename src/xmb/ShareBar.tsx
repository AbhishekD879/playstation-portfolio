// The console's SHARE button.
//
// Mounted once by XMB, not per app: it finds whatever canvas or video is
// currently the main view and quietly keeps the last 15 seconds. Nothing to
// arm, nothing to start — by the time you realise the thing you did was cool,
// it's already buffered. That's the whole point of a Share button, and it's why
// this can't be a "start recording" toggle.
import { Show, createEffect, createSignal, on, onCleanup } from "solid-js";
import { CLIP_SECONDS, clipName, clipSupported, findCaptureSource, shareBlob, startClipBuffer, type ClipHandle } from "../capture";
import { Icon } from "./icons";
import * as sfx from "../audio";
import { onDsCreate } from "../dualsense";

/** Apps whose main view is worth clipping. Everything else gets no Share. */
const CAPTURE_APPS = new Set([
  "doom", "doomrtx", "flash", "ps2", "cs", "pc", "scummvm",
  "rpgmaker", "renpy", "godot", "unity", "html5",
  "videoplayer", "cinema", "retrojoin", "visualizer", "board", "watchtv",
]);
/** Emulator homes launch a GameSession that owns the canvas. */
const CAPTURE_PREFIX = ["ps2home", "ps1home", "psphome", "retrohome"];

export function shareable(app: string | null) {
  return !!app && (CAPTURE_APPS.has(app) || CAPTURE_PREFIX.includes(app));
}

/** What the clip is stamped with. GameSession sets the actual game title once
 *  it boots; until then we fall back to the app's own name. */
const [gameLabel, setGameLabel] = createSignal("");
export { setGameLabel as setShareLabel };

const APP_NAMES: Record<string, string> = {
  doom: "DOOM", doomrtx: "DOOM RTX", flash: "Flash", ps2: "PlayStation 2",
  cs: "Counter-Strike 1.6", pc: "PC", scummvm: "ScummVM", rpgmaker: "RPG Maker",
  renpy: "Ren'Py", godot: "Godot", unity: "Unity", html5: "HTML5",
  videoplayer: "Video", cinema: "Cinema", retrojoin: "Player Two",
  visualizer: "Visualizer", board: "Board Games", watchtv: "Console TV",
  ps2home: "PlayStation 2", ps1home: "PlayStation", psphome: "PSP", retrohome: "Retro",
};

export default function ShareBar(props: { app: string | null }) {
  const label = () => gameLabel() || APP_NAMES[props.app ?? ""] || "AbhishekStation";
  const [buf, setBuf] = createSignal<ClipHandle | null>(null);
  const [open, setOpen] = createSignal(false);
  const [busy, setBusy] = createSignal<"" | "clip" | "gif">("");
  const [note, setNote] = createSignal("");
  const [ready, setReady] = createSignal(0);

  // Re-arm whenever the app changes. The source often doesn't exist yet (the
  // emulator is still booting), so poll briefly rather than giving up.
  createEffect(on(() => props.app, (app) => {
    buf()?.stop(); setBuf(null); setReady(0); setNote("");
    if (!app || !shareable(app) || !clipSupported()) return;

    let dead = false, tries = 0;
    const arm = async () => {
      if (dead) return;
      const src = findCaptureSource();
      if (src) {
        const h = await startClipBuffer(src, { label });
        if (dead) { h?.stop(); return }
        if (h) { setBuf(h); return }
      }
      if (++tries < 40) setTimeout(arm, 500); // ~20s of boot grace
    };
    void arm();
    onCleanup(() => { dead = true });
  }));

  // Drive the readiness meter — the ring fills over the first 15 seconds.
  createEffect(() => {
    const h = buf();
    if (!h) return;
    const t = setInterval(() => setReady(h.seconds()), 500);
    onCleanup(() => clearInterval(t));
  });

  onCleanup(() => buf()?.stop());

  const save = async (kind: "clip" | "gif") => {
    const h = buf();
    if (!h || busy()) return;
    setBusy(kind); setNote(kind === "gif" ? "building GIF…" : "saving clip…");
    try {
      const blob = kind === "gif" ? await h.saveGif() : await h.saveClip();
      if (!blob) { setNote("nothing buffered yet — play for a few seconds"); return }
      const how = await shareBlob(blob, clipName(label(), kind === "gif" ? "gif" : "webm"));
      const mb = (blob.size / 1048576).toFixed(1);
      setNote(how === "shared" ? "shared" : `saved · ${mb} MB`);
      sfx.confirm?.();
      setTimeout(() => { setOpen(false); setNote("") }, 1400);
    } catch {
      setNote("couldn't build that clip");
    } finally { setBusy("") }
  };

  // C for capture — and, on a connected DualSense, the pad's actual Create
  // button. The Gamepad API doesn't expose Create at all, so this only works
  // via WebHID; that's the whole reason the keyboard shortcut exists too.
  createEffect(() => {
    if (!buf()) return;
    const toggle = () => { setOpen((v) => !v); sfx.tickH?.() };
    const key = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "c" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t?.matches?.("input, textarea, [contenteditable]")) return;
      e.preventDefault();
      toggle();
    };
    addEventListener("keydown", key);
    onDsCreate(toggle);
    onCleanup(() => { removeEventListener("keydown", key); onDsCreate(null) });
  });

  const pct = () => Math.round((Math.min(ready(), CLIP_SECONDS) / CLIP_SECONDS) * 100);

  return (
    <Show when={buf()}>
      <button
        class="share-btn"
        classList={{ armed: ready() > 1 }}
        style={{ "--fill": `${pct()}%` }}
        title={`Share the last ${CLIP_SECONDS} seconds  (C)`}
        onClick={() => { setOpen(true); sfx.tickH?.() }}
      >
        <Icon name="share" />
        <span>SHARE</span>
      </button>

      <Show when={open()}>
        <div class="share-scrim" onClick={() => !busy() && setOpen(false)}>
          <div class="share-band" onClick={(e) => e.stopPropagation()}>
            <div class="panel-tag">SHARE · LAST {Math.round(Math.min(ready(), CLIP_SECONDS))} SECONDS</div>
            <h2>{label()}</h2>
            <p>
              The console keeps the last {CLIP_SECONDS} seconds of play in memory. Save it as a
              clip to post, or a GIF for the last 8 seconds. Nothing is uploaded — the file is
              built here and handed straight to you.
            </p>
            <div class="share-acts">
              <button class="ps-act" disabled={!!busy()} onClick={() => save("clip")}>
                <span class="btn-x" /> {busy() === "clip" ? "saving…" : "save clip"}
              </button>
              <button class="ps-act" disabled={!!busy()} onClick={() => save("gif")}>
                <span class="btn-t" /> {busy() === "gif" ? "building…" : "save GIF"}
              </button>
              <button class="ps-act" disabled={!!busy()} onClick={() => setOpen(false)}>
                <span class="btn-o" /> back
              </button>
            </div>
            <Show when={note()}><div class="share-note">{note()}</div></Show>
          </div>
        </div>
      </Show>
    </Show>
  );
}
