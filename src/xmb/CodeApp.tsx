// Code Playground — write and run JavaScript or Python (Pyodide) right on the
// console. Everything executes in a sandboxed, time-limited Web Worker
// (see codeRunner), so nothing can hang the UI.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { disposeRunners, formatPy, lintPy, run, type Diag, type Lang } from "../codeRunner";
import { formatJs, lintJs } from "../codeTools";
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
  const [diags, setDiags] = createSignal<Diag[]>([]);
  let editor!: HTMLTextAreaElement;

  onMount(() => {
    setNavEnabled(false);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { sfx.back(); props.onClose(); } };
    addEventListener("keydown", esc);
    onCleanup(() => { setNavEnabled(true); removeEventListener("keydown", esc); disposeRunners(); });
    setTimeout(() => editor?.focus(), 60);
  });

  function jumpTo(line: number) {
    const pos = code().split("\n").slice(0, line - 1).join("\n").length + (line > 1 ? 1 : 0);
    editor.focus();
    editor.setSelectionRange(pos, pos);
    // scroll the target line into view
    const lineH = parseInt(getComputedStyle(editor).lineHeight) || 22;
    editor.scrollTop = Math.max(0, (line - 3) * lineH);
  }

  function switchLang(l: Lang) {
    if (l === lang()) return;
    setLang(l);
    if (code().trim() === SAMPLES[l === "js" ? "python" : "js"].trim() || !code().trim()) setCode(SAMPLES[l]);
    sfx.tickH();
  }

  async function execute() {
    if (busy()) return;
    setBusy(true);
    setDiags([]);
    setStatus(lang() === "python" ? "starting…" : "running…");
    setOutput("");
    sfx.confirm();
    const r = await run(lang(), code(), (s) => setStatus(s));
    setStatus(`${r.timedOut ? "timed out" : "done"} · ${Math.round(r.ms)} ms`);
    setOutput([r.output, r.error].filter(Boolean).join("\n") || "(no output)");
    setBusy(false);
    lint(); // surface any warnings after a run
  }

  async function format() {
    if (busy()) return;
    setBusy(true);
    setStatus("formatting…");
    sfx.tickH();
    try {
      const out = lang() === "js" ? await formatJs(code()) : await formatPy(code(), (s) => setStatus(s));
      if (out != null) { setCode(out); setStatus("formatted"); setDiags([]); }
      else setStatus("couldn't format");
    } catch (e) {
      setStatus("format failed"); setOutput(String((e as Error).message ?? e));
    }
    setBusy(false);
  }

  async function lint() {
    if (busy()) return;
    setBusy(true);
    setStatus("checking…");
    const d = lang() === "js" ? await lintJs(code()).catch(() => []) : await lintPy(code(), (s) => setStatus(s));
    setDiags(d);
    setStatus(d.length ? `${d.length} issue${d.length === 1 ? "" : "s"}` : "no issues ✓");
    setBusy(false);
    if (d.length) sfx.deny(); else sfx.tickH();
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
        <button class="ps-act" onClick={() => { sfx.back(); props.onClose(); }}><span class="btn-o" /> back</button>
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
            <span>{diags().length ? "PROBLEMS" : "OUTPUT"}</span>
            <Show when={status()}><span class="codeapp-status">{status()}</span></Show>
          </div>
          <Show
            when={diags().length}
            fallback={<pre class="codeapp-outbody">{output()}</pre>}
          >
            <div class="codeapp-diags">
              <For each={diags()}>
                {(d) => (
                  <button class="codeapp-diag" classList={{ err: d.severity === "error" }} onClick={() => jumpTo(d.line)}>
                    <span class="codeapp-diag-loc">{d.line}:{d.col}</span>
                    <span>{d.msg}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>

      <div class="ps-legend">
        <button class="ps-act" disabled={busy()} onClick={execute}><span class="btn-x" /> {busy() ? "working…" : "run"}</button>
        <button class="ps-act" disabled={busy()} onClick={format}><span class="btn-s" /> format</button>
        <button class="ps-act" disabled={busy()} onClick={lint}><span class="btn-t" /> check</button>
        <button class="ps-act" onClick={() => { sfx.back(); props.onClose(); }}><span class="btn-o" /> back</button>
        <span class="codeapp-hint" style={{ "margin-left": "auto" }}>⌘/Ctrl+Enter run · sandboxed · 5s limit</span>
      </div>
    </div>
  );
}
