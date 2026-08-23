// Shared diagnostics overlay — the panel + verbose/clear/share-log flow, reused
// by every player that hosts a game in a same-origin iframe (RPG Maker/EasyRPG/
// Ren'Py/Web via RpgPlayer, and the PS2 emulator). The traced game (or the SW-
// injected shim, or /diag-core.js) posts {source:"rpgm-diag"} snapshots to the
// parent; this consumes them, and builds the shareable log from that data (no
// round-trip to the frame — that used to silently fail on mobile). "share log"
// uploads the trace to our worker and shows a 6-char code to read it back.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { clearInput, subscribeInput, type InputEvent } from "../inputLog";

export type DiagSnap = {
  source: string; up: number; scene: string; spinner: boolean; booted: boolean; canvas: boolean;
  pending: { path: string; age: number }[];
  recent: { path: string; status: unknown }[];
  counts: { ok: number; fail: number };
  errors: { msg: string; at: string }[];
  activity?: { path: string; ok: boolean; reason: string; t: number; n?: number }[];
  xfer?: { m: string; t: number; n?: number }[];   // map transfers (doors/stairs) + event triggers
  /** the stored file list the fs shim hands existsSync — MISSING here means the
   *  game's own existsSync checks all return false, which makes it skip assets
   *  silently with no error to log */
  manifest?: string;
  /** source of the game's own function when its art never loads — the engine
   *  never requesting an image means the bail-out is in the game's code */
  probe?: string;
  /** what this browser can actually decode — RPG Maker ships VP8/VP9 webm
   *  because MV targets Chromium, and iOS Safari's support is partial */
  codecs?: string;
  /** which shim built this log — a stale service worker silently serves stale
   *  shims, and a log that cannot name its version wastes a capture */
  shimV?: string;
  /** live state of the game's video elements — a currentTime stuck at 0 means it
   *  never played; advancing while the screen stays empty means the frames never
   *  reach the canvas */
  vids?: string;
  /** captured thumbnails: the canvas the player sees, plus each video drawn
   *  straight to a 2D canvas, which bypasses the game's WebGL compositing */
  frames?: { label: string; w?: number; h?: number; stats: string; url: string }[];
  /** Result of the in-game probe suite: it builds its own <video> from a movie
   *  in the manifest and drives it through load, play, pause and GPU upload,
   *  measuring at each step. Answers the video questions without the player
   *  having to reach any particular scene. */
  selftest?: string;
  /** direct video-to-texture upload vs the same frame via a 2D canvas — tests
   *  the proposed fix on the real device before it is written */
  gl?: string;
  /** every canvas in the game frame, and which one is the engine's — the first
   *  in the DOM is not necessarily the surface the player sees */
  canv?: string;
  /** the ENGINE's own texture uploads: count, total megabytes and any GL errors
   *  — an out-of-memory upload fails silently, and this game is 1169x826 with
   *  several full-frame videos at the same size */
  glLoad?: string;
  /** what PIXI actually exposes — v4 has VideoBaseTexture, v5+ renamed it to
   *  resources.VideoResource, and a game can bundle its own build */
  pixi?: string;
};

const LOG_HOST = "https://abhishekstation-mp.abhishekdiwate879.workers.dev";

export default function DiagOverlay(props: {
  frame: () => HTMLIFrameElement | undefined; // the traced iframe (same origin)
  label: string;                              // what's being traced (log header)
  open: boolean;
  onClose: () => void;
}) {
  const [diag, setDiag] = createSignal<DiagSnap | null>(null);
  const [verbose, setVerbose] = createSignal(false);   // log EVERY event command
  const [dumpText, setDumpText] = createSignal("");     // copy-box fallback
  const [shareCode, setShareCode] = createSignal("");   // code after uploading
  const [shareState, setShareState] = createSignal<"" | "busy" | "error">("");
  // Parent-side input trace. The frame's log covers the emulator; this covers
  // what the gamepad bridge saw and dispatched — the half you cannot otherwise
  // observe when "the controller does nothing".
  const [inputs, setInputs] = createSignal<InputEvent[]>([]);

  onMount(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== location.origin) return;
      const d = e.data as DiagSnap;
      if (d && d.source === "rpgm-diag") setDiag(d);
    };
    addEventListener("message", onMsg);
    onCleanup(() => removeEventListener("message", onMsg));
  });

  const send = (msg: object) => { try { (props.frame()?.contentWindow as Window | null)?.postMessage(msg, "*"); } catch { /* frame gone */ } };
  const stuck = () => (diag()?.pending ?? []).filter((p) => p.age > 4000);
  const clean = () => { const d = diag(); return d && d.errors.length === 0 && stuck().length === 0 && d.recent.length === 0; };

  // wipe the in-frame trace buffers so the next thing you do shows a clean run.
  const clearDiag = () => { send({ __rpgmDiagClear: true }); setDiag(null); setDumpText(""); setShareCode(""); setShareState(""); clearInput(); };
  const toggleVerbose = () => { const v = !verbose(); setVerbose(v); send({ __rpgmDiagVerbose: v }); };

  // Build the log from the data we ALREADY have (the live snapshots) — no
  // round-trip to the frame. Carries the full activity trace, errors, failed loads.
  const buildLog = (): string => {
    const d = diag();
    if (!d) return "";
    const L: string[] = ["=== DIAG ===", `target: ${props.label}`];
    L.push(`scene ${d.scene || "?"} · up ${Math.round(d.up / 1000)}s · ok ${d.counts.ok} / fail ${d.counts.fail} · booted ${d.booted}`);
    L.push(`ua: ${navigator.userAgent}${d.shimV ? ` · shim v${d.shimV}` : " · shim PRE-VERSIONING (stale worker?)"}`);
    if (d.manifest) L.push(d.manifest);
    if (d.codecs) L.push(d.codecs);
    if (d.vids) L.push(`video: ${d.vids}`);
    if (d.gl) L.push(`gl upload: ${d.gl}`);
    if (d.canv) L.push(`canvases: ${d.canv}`);
    if (d.glLoad) L.push(`gl load: ${d.glLoad}`);
    if (d.pixi) L.push(`pixi: ${d.pixi}`);
    if (d.probe) L.push(`probe: ${d.probe}`);
    if (d.selftest) L.push("", "-- SELF-TEST (probe suite, no gameplay) --", `  ${d.selftest}`);
    const inp = inputs();
    if (inp.length) {
      L.push("", "-- INPUT (parent) --");
      inp.forEach((e) => L.push(`  ${(e.t / 1000).toFixed(1)}s ${e.msg}${e.n > 1 ? ` x${e.n}` : ""}`));
    }
    if (d.errors.length) { L.push("", "-- ERRORS --"); d.errors.forEach((e) => L.push(`  ! ${e.msg}${e.at ? ` (${e.at})` : ""}`)); }
    if (d.recent.length) { L.push("", "-- FAILED LOADS --"); d.recent.forEach((r) => L.push(`  x ${r.path} · ${String(r.status)}`)); }
    const xf = d.xfer ?? [];
    if (xf.length) { L.push("", `-- MOVEMENT: transfers & triggers (oldest first, ${xf.length}) --`);
      xf.slice().reverse().forEach((x) => L.push(`  ▶ [${Math.round(x.t)}ms] ${x.m}${x.n && x.n > 1 ? ` ×${x.n}` : ""}`)); }
    const fr = d.frames ?? [];
    if (fr.length) {
      L.push("", `-- FRAMES (${fr.length}) --`);
      fr.forEach((f) => {
        L.push(`  ${f.label}${f.w ? ` ${f.w}x${f.h}` : ""} · ${f.stats}`);
        if (f.url) L.push(`  ${f.url}`);
      });
    }
    const act = d.activity ?? [];
    L.push("", `-- ACTIVITY (oldest first, ${act.length}) --`);
    act.slice().reverse().forEach((a) => L.push(`  ${a.ok ? "+" : "x"} [${Math.round(a.t)}ms] ${a.path}${a.n && a.n > 1 ? ` ×${a.n}` : ""}${a.reason ? ` · ${a.reason}` : ""}`));
    return L.join("\n");
  };
  const copyLog = () => {
    const t = buildLog();
    if (!t) { setShareState("error"); return; }
    setDumpText(t);
    try { void navigator.clipboard?.writeText?.(t); } catch { /* textarea fallback shows it */ }
  };
  /** Ask the game to grab a frame and wait for it to land. The shim captures
   *  inside its render tick, so this resolves on the next rendered frame. */
  const grabFrames = async (): Promise<void> => {
    const had = diag()?.frames?.length ?? 0;
    send({ type: "rpgm-grab" });
    for (let i = 0; i < 24; i++) {                     // ~2.4s, then give up
      await new Promise((r) => setTimeout(r, 100));
      const n = diag()?.frames?.length ?? 0;
      if (n && n !== had) return;
    }
  };

  /** Run the probe suite and wait for its verdict. It loads and plays real
   *  media, so it needs a few seconds — far longer than a frame grab. */
  const runSelfTest = async (): Promise<void> => {
    send({ type: "rpgm-selftest" });
    for (let i = 0; i < 140; i++) {                    // ~14s, then give up
      await new Promise((r) => setTimeout(r, 100));
      if (diag()?.selftest) return;
    }
  };

  const shareLog = async (withFrame?: boolean) => {
    if (withFrame) { setShareState("busy"); await grabFrames(); }
    const t = buildLog();
    if (!t) { setShareState("error"); return; }
    setShareState("busy"); setShareCode("");
    try {
      const r = await fetch(`${LOG_HOST}/log`, { method: "POST", headers: { "content-type": "text/plain" }, body: t });
      const j = await r.json() as { code?: string };
      if (j.code) { setShareCode(j.code); setShareState(""); } else throw new Error("no code");
    } catch { setShareState("error"); setDumpText(t); } // offline → fall back to the copy box
  };

  return (
    <Show when={props.open}>
      <div class="rpg-diag">
        <div class="rpg-diag-head">
          <span>DIAGNOSTICS · trace</span>
          <span class="rpg-diag-btns">
            <button class="ps-act" classList={{ on: verbose() }} onClick={toggleVerbose}>verbose: {verbose() ? "on" : "off"}</button>
            <button class="ps-act" onClick={() => void shareLog()}>{shareState() === "busy" ? "sharing…" : "share log"}</button>
            <button class="ps-act" onClick={() => void shareLog(true)}>+ frame</button>
            <button class="ps-act" onClick={() => { setShareState("busy"); void runSelfTest().then(() => shareLog(true)); }}>run tests</button>
            <button class="ps-act" onClick={copyLog}>copy</button>
            <button class="ps-act" onClick={clearDiag}>clear</button>
            <button class="ps-act" onClick={props.onClose}>close</button>
          </span>
        </div>
        <div class="rpg-diag-tip">Turn on <b>verbose</b> → tap <b>clear</b> → reproduce the problem → tap <b>share log</b>, then tell me the code. Use <b>+ frame</b> when the problem is something you can SEE — it attaches a thumbnail of the screen. <b>run tests</b> answers the video questions on its own — no need to reach any particular scene. Newest first below.</div>
        <Show when={shareCode()}>
          <div class="rpg-diag-share">✓ Log shared — tell me this code: <b class="rpg-diag-code">{shareCode()}</b></div>
        </Show>
        <Show when={shareState() === "error"}>
          <div class="rpg-diag-share err">Couldn't upload (offline?) — use the box below and paste it instead.</div>
        </Show>
        <Show when={dumpText()}>
          <div class="rpg-diag-dump">
            <div class="rpg-diag-dumphd"><span>Tap the box to select all, then copy. (Also copied to clipboard if the browser allowed it.)</span>
              <button class="ps-act" onClick={() => setDumpText("")}>✕</button></div>
            <textarea class="rpg-diag-dumptext" readonly value={dumpText()} onClick={(e) => (e.currentTarget as HTMLTextAreaElement).select()} />
          </div>
        </Show>
        <div class="rpg-diag-state">
          {(() => {
            const d = diag();
            if (!d) return "waiting for the game to report…";
            const st = d.booted ? "running" : d.spinner ? "loading" : "starting";
            return `${st}${d.scene ? " · " + d.scene : ""} · ${Math.round(d.up / 1000)}s · ${d.counts.ok} ok / ${d.counts.fail} failed`;
          })()}
        </div>
        <Show when={(diag()?.errors.length ?? 0) > 0}>
          <div class="rpg-diag-sec">Errors</div>
          <For each={diag()!.errors}>{(e) => <div class="rpg-diag-row err">{e.msg}{e.at ? ` (${e.at})` : ""}</div>}</For>
        </Show>
        <Show when={stuck().length > 0}>
          <div class="rpg-diag-sec">Stuck loading (&gt;4s)</div>
          <For each={stuck()}>{(p) => <div class="rpg-diag-row warn">{p.path} · {Math.round(p.age / 1000)}s</div>}</For>
        </Show>
        <Show when={(diag()?.recent.length ?? 0) > 0}>
          <div class="rpg-diag-sec">Failed to load</div>
          <For each={diag()!.recent}>{(r) => <div class="rpg-diag-row err">{r.path} · {String(r.status)}</div>}</For>
        </Show>
        <Show when={(diag()?.xfer?.length ?? 0) > 0}>
          <div class="rpg-diag-sec">Movement — transfers &amp; triggers (newest first)</div>
          <For each={diag()!.xfer}>{(x) => (
            <div class="rpg-diag-row">▶ {x.m}{x.n && x.n > 1 ? ` ×${x.n}` : ""}</div>
          )}</For>
        </Show>
        <div class="rpg-diag-sec">Controller &amp; keys (this page)</div>
        <Show when={inputs().length > 0} fallback={
          <div class="rpg-diag-row dim">
            nothing yet — press a button on your controller. If this stays empty while the
            emulator is running, the bridge is not seeing your pad at all.
          </div>
        }>
          <For each={inputs()}>{(e) => (
            <div class="rpg-diag-row">
              <span class="rpg-diag-t">{(e.t / 1000).toFixed(1)}s</span>
              {e.msg}{e.n > 1 && <b> ×{e.n}</b>}
            </div>
          )}</For>
        </Show>

        <Show when={(diag()?.activity?.length ?? 0) > 0}>
          <div class="rpg-diag-sec">Recent activity (newest first)</div>
          <For each={diag()!.activity}>{(a) => (
            <div class="rpg-diag-row" classList={{ err: !a.ok, dim: a.ok }}>{a.ok ? "✓" : "✗"} {a.path}{a.n && a.n > 1 ? ` ×${a.n}` : ""}{a.reason ? ` · ${a.reason}` : ""}</div>
          )}</For>
        </Show>
        <Show when={clean() && !(diag()?.activity?.length)}>
          <div class="rpg-diag-row dim">No errors or failed loads reported yet — reproduce the problem, then check here.</div>
        </Show>
      </div>
    </Show>
  );
}
