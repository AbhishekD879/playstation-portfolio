// Code Playground — write and run JavaScript or Python (Pyodide) right on the
// console. Everything executes in a sandboxed, time-limited Web Worker
// (see codeRunner), so nothing can hang the UI.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { disposeRunners, run, type Lang } from "../codeRunner";
import { setNavEnabled } from "../input";
import * as sfx from "../audio";

const SAMPLES: Record<Lang, string> = {
  js: `// JavaScript — runs on your GPU-era browser, sandboxed.
const fib = n => n < 2 ? n : fib(n-1) + fib(n-2);
console.log("fib(10) =", fib(10));
console.log([1,2,3,4].map(x => x*x));
return "done";`,
  python: `# Python via Pyodide — the real CPython, in WebAssembly.
import sys
print("Python", sys.version.split()[0])
print([x*x for x in range(1, 6)])
sum(range(101))`,
};

export default function CodeApp(props: { onClose: () => void }) {
  const [lang, setLang] = createSignal<Lang>("js");
  const [code, setCode] = createSignal(SAMPLES.js);
  const [output, setOutput] = createSignal("");
  const [status, setStatus] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let editor!: HTMLTextAreaElement;

  onMount(() => {
    setNavEnabled(false);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { sfx.back(); props.onClose(); } };
    addEventListener("keydown", esc);
    onCleanup(() => { setNavEnabled(true); removeEventListener("keydown", esc); disposeRunners(); });
    setTimeout(() => editor?.focus(), 60);
  });

  function switchLang(l: Lang) {
    if (l === lang()) return;
    setLang(l);
    if (code().trim() === SAMPLES[l === "js" ? "python" : "js"].trim() || !code().trim()) setCode(SAMPLES[l]);
    sfx.tickH();
  }

  async function execute() {
    if (busy()) return;
    setBusy(true);
    setStatus(lang() === "python" ? "starting…" : "running…");
    setOutput("");
    sfx.confirm();
    const r = await run(lang(), code(), (s) => setStatus(s));
    setStatus(`${r.timedOut ? "timed out" : "done"} · ${Math.round(r.ms)} ms`);
    setOutput([r.output, r.error].filter(Boolean).join("\n") || "(no output)");
    setBusy(false);
  }

  return (
    <div class="codeapp">
      <div class="codeapp-bar">
        <div class="panel-tag">CODE PLAYGROUND — SANDBOXED · TIME-LIMITED</div>
        <div class="codeapp-langs">
          <For each={["js", "python"] as Lang[]}>
            {(l) => <button class="ghost-btn" classList={{ on: lang() === l }} onClick={() => switchLang(l)}>{l === "js" ? "JavaScript" : "Python"}</button>}
          </For>
        </div>
        <button class="ghost-btn" onClick={() => { sfx.back(); props.onClose(); }}>✕ close</button>
      </div>

      <div class="codeapp-body">
        <textarea
          ref={editor}
          class="codeapp-editor"
          spellcheck={false}
          value={code()}
          onInput={(e) => setCode(e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") { sfx.back(); props.onClose(); }
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); execute(); }
            if (e.key === "Tab") { e.preventDefault(); const t = e.currentTarget, s = t.selectionStart; t.value = t.value.slice(0, s) + "  " + t.value.slice(t.selectionEnd); t.selectionStart = t.selectionEnd = s + 2; setCode(t.value); }
          }}
        />
        <div class="codeapp-out">
          <div class="codeapp-outhead">
            <span>OUTPUT</span>
            <Show when={status()}><span class="codeapp-status">{status()}</span></Show>
          </div>
          <pre class="codeapp-outbody">{output()}</pre>
        </div>
      </div>

      <div class="codeapp-foot">
        <button class="ps2-launch codeapp-run" disabled={busy()} onClick={execute}>{busy() ? "▪ running…" : "▶ Run"}</button>
        <span class="codeapp-hint">Ctrl/⌘ + Enter to run · runs sandboxed, killed after 5s · Python downloads once (~10 MB)</span>
      </div>
    </div>
  );
}
