// Shared diagnostics overlay — the panel + verbose/clear/share-log flow, reused
// by every player that hosts a game in a same-origin iframe (RPG Maker/EasyRPG/
// Ren'Py/Web via RpgPlayer, and the PS2 emulator). The traced game (or the SW-
// injected shim, or /diag-core.js) posts {source:"rpgm-diag"} snapshots to the
// parent; this consumes them, and builds the shareable log from that data (no
// round-trip to the frame — that used to silently fail on mobile). "share log"
// uploads the trace to our worker and shows a 6-char code to read it back.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";

export type DiagSnap = {
  source: string; up: number; scene: string; spinner: boolean; booted: boolean; canvas: boolean;
  pending: { path: string; age: number }[];
  recent: { path: string; status: unknown }[];
  counts: { ok: number; fail: number };
  errors: { msg: string; at: string }[];
  activity?: { path: string; ok: boolean; reason: string; t: number }[];
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
  const clearDiag = () => { send({ __rpgmDiagClear: true }); setDiag(null); setDumpText(""); setShareCode(""); setShareState(""); };
  const toggleVerbose = () => { const v = !verbose(); setVerbose(v); send({ __rpgmDiagVerbose: v }); };

  // Build the log from the data we ALREADY have (the live snapshots) — no
  // round-trip to the frame. Carries the full activity trace, errors, failed loads.
  const buildLog = (): string => {
    const d = diag();
    if (!d) return "";
    const L: string[] = ["=== DIAG ===", `target: ${props.label}`];
    L.push(`scene ${d.scene || "?"} · up ${Math.round(d.up / 1000)}s · ok ${d.counts.ok} / fail ${d.counts.fail} · booted ${d.booted}`);
    L.push(`ua: ${navigator.userAgent}`);
    if (d.errors.length) { L.push("", "-- ERRORS --"); d.errors.forEach((e) => L.push(`  ! ${e.msg}${e.at ? ` (${e.at})` : ""}`)); }
    if (d.recent.length) { L.push("", "-- FAILED LOADS --"); d.recent.forEach((r) => L.push(`  x ${r.path} · ${String(r.status)}`)); }
    const act = d.activity ?? [];
    L.push("", `-- ACTIVITY (oldest first, ${act.length}) --`);
    act.slice().reverse().forEach((a) => L.push(`  ${a.ok ? "+" : "x"} [${Math.round(a.t)}ms] ${a.path}${a.reason ? ` · ${a.reason}` : ""}`));
    return L.join("\n");
  };
  const copyLog = () => {
    const t = buildLog();
    if (!t) { setShareState("error"); return; }
    setDumpText(t);
    try { void navigator.clipboard?.writeText?.(t); } catch { /* textarea fallback shows it */ }
  };
  const shareLog = async () => {
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
            <button class="ps-act" onClick={shareLog}>{shareState() === "busy" ? "sharing…" : "share log"}</button>
            <button class="ps-act" onClick={copyLog}>copy</button>
            <button class="ps-act" onClick={clearDiag}>clear</button>
            <button class="ps-act" onClick={props.onClose}>close</button>
          </span>
        </div>
        <div class="rpg-diag-tip">Turn on <b>verbose</b> → tap <b>clear</b> → reproduce the problem → tap <b>share log</b>, then tell me the code. Newest first below.</div>
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
        <Show when={(diag()?.activity?.length ?? 0) > 0}>
          <div class="rpg-diag-sec">Recent activity (newest first)</div>
          <For each={diag()!.activity}>{(a) => (
            <div class="rpg-diag-row" classList={{ err: !a.ok, dim: a.ok }}>{a.ok ? "✓" : "✗"} {a.path}{a.reason ? ` · ${a.reason}` : ""}</div>
          )}</For>
        </Show>
        <Show when={clean() && !(diag()?.activity?.length)}>
          <div class="rpg-diag-row dim">No errors or failed loads reported yet — reproduce the problem, then check here.</div>
        </Show>
      </div>
    </Show>
  );
}
