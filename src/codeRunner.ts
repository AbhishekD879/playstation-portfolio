// Sandboxed code execution. Everything runs in a Web Worker, never on the main
// thread — so an infinite loop or heavy computation can't freeze the console:
// if a run exceeds the time budget the worker is TERMINATED (the only way to
// stop a synchronous infinite loop) and reported as timed out. Output is capped
// so a runaway print can't exhaust memory either.
export type Lang = "js" | "python";
export interface RunResult { output: string; error?: string; timedOut: boolean; ms: number }

const TIMEOUT_MS = 5000;   // compute budget per run
const LOAD_MS = 60000;     // Pyodide's one-time download can be slow
const OUTPUT_CAP = 800;    // max lines echoed back

// —— JS worker: runs code as an async function, console.* → messages ——
const JS_WORKER = `
self.onmessage = async (e) => {
  const lines = [];
  const push = (p, a) => { if (lines.length < ${OUTPUT_CAP}) lines.push(p + a.map(v => {
    try { return typeof v === "object" ? JSON.stringify(v) : String(v); } catch { return String(v); }
  }).join(" ")); };
  const console = { log:(...a)=>push("",a), info:(...a)=>push("",a), warn:(...a)=>push("⚠ ",a), error:(...a)=>push("⚠ ",a), debug:(...a)=>push("",a) };
  try {
    const AsyncFn = Object.getPrototypeOf(async function(){}).constructor;
    const ret = await new AsyncFn("console", e.data.code)(console);
    if (ret !== undefined) push("⟵ ", [ret]);
    self.postMessage({ done: true, output: lines.join("\\n") });
  } catch (err) {
    self.postMessage({ done: true, output: lines.join("\\n"), error: String(err && err.stack || err) });
  }
};`;

// —— Python worker: Pyodide from CDN, stdout/stderr → messages ——
const PY_WORKER = `
importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js");
let py = null;
self.onmessage = async (e) => {
  try {
    if (!py) { self.postMessage({ status: "Downloading Python… (one-time)" }); py = await loadPyodide(); }
    const lines = [];
    const cap = (s) => { if (lines.length < ${OUTPUT_CAP}) lines.push(s); };
    py.setStdout({ batched: cap });
    py.setStderr({ batched: (s) => cap("⚠ " + s) });
    const ret = await py.runPythonAsync(e.data.code);
    if (ret !== undefined && ret !== null) cap("⟵ " + String(ret));
    self.postMessage({ done: true, output: lines.join("\\n") });
  } catch (err) {
    self.postMessage({ done: true, error: String(err) });
  }
};`;

const workerURL = (src: string) => URL.createObjectURL(new Blob([src], { type: "application/javascript" }));

let jsWorker: Worker | null = null;
let pyWorker: Worker | null = null;
let pyReady = false; // Pyodide already loaded once → skip the download timeout

function getWorker(lang: Lang): Worker {
  if (lang === "js") return (jsWorker ??= new Worker(workerURL(JS_WORKER)));
  return (pyWorker ??= new Worker(workerURL(PY_WORKER)));
}
function killWorker(lang: Lang) {
  if (lang === "js") { jsWorker?.terminate(); jsWorker = null; }
  else { pyWorker?.terminate(); pyWorker = null; pyReady = false; }
}

/** Run code in its worker with a hard timeout. onStatus reports Pyodide load. */
export function run(lang: Lang, code: string, onStatus?: (s: string) => void): Promise<RunResult> {
  const started = performance.now();
  return new Promise((resolve) => {
    const w = getWorker(lang);
    const budget = lang === "python" && !pyReady ? LOAD_MS : TIMEOUT_MS;
    const timer = setTimeout(() => {
      killWorker(lang); // the only way to stop a runaway synchronous loop
      cleanup();
      resolve({ output: "", error: "⏱ Terminated — exceeded the time limit (infinite loop or heavy computation).", timedOut: true, ms: performance.now() - started });
    }, budget);
    const onMsg = (e: MessageEvent) => {
      if (e.data?.status) { onStatus?.(e.data.status); return; } // still loading — not done
      clearTimeout(timer);
      cleanup();
      if (lang === "python") pyReady = true;
      resolve({ output: e.data.output ?? "", error: e.data.error, timedOut: false, ms: performance.now() - started });
    };
    const cleanup = () => w.removeEventListener("message", onMsg);
    w.addEventListener("message", onMsg);
    w.postMessage({ code });
  });
}

/** Kill any running workers (call on unmount to free Pyodide's memory). */
export function disposeRunners() { killWorker("js"); killWorker("python"); }
