// Sandboxed code execution + Python tooling. Everything runs in a Web Worker,
// never on the main thread — so an infinite loop or heavy computation can't
// freeze the console: if a job exceeds its budget the worker is TERMINATED
// (the only way to stop a synchronous infinite loop) and reported as timed out.
// Output is capped so a runaway print can't exhaust memory either. The Python
// worker also formats (black) and lints (compile + pyflakes) on demand.
export type Lang = "js" | "python";
export type PyOp = "run" | "format" | "lint";
export interface RunResult { output: string; error?: string; timedOut: boolean; ms: number }
export interface Diag { line: number; col: number; msg: string; severity: "error" | "warn" }

const TIMEOUT_MS = 5000;   // compute budget per run
const LOAD_MS = 90000;     // Pyodide / pip installs can be slow
const OUTPUT_CAP = 800;

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

const PY_WORKER = `
importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js");
let py = null, blackReady = false, flakesReady = false;
async function ensurePy(msg) { if (!py) { self.postMessage({ status: msg }); py = await loadPyodide(); await py.loadPackage("micropip"); } return py; }
self.onmessage = async (e) => {
  const op = e.data.op || "run";
  try {
    if (op === "run") {
      await ensurePy("Downloading Python… (one-time)");
      const lines = []; const cap = (s) => { if (lines.length < ${OUTPUT_CAP}) lines.push(s); };
      py.setStdout({ batched: cap }); py.setStderr({ batched: (s) => cap("⚠ " + s) });
      const ret = await py.runPythonAsync(e.data.code);
      if (ret !== undefined && ret !== null) cap("⟵ " + String(ret));
      self.postMessage({ done: true, output: lines.join("\\n") });
      return;
    }
    if (op === "format") {
      await ensurePy("Downloading Python…");
      if (!blackReady) { self.postMessage({ status: "Installing black…" }); await py.pyimport("micropip").install("black"); blackReady = true; }
      py.globals.set("__src", e.data.code);
      const out = await py.runPythonAsync("import black; black.format_str(__src, mode=black.Mode())");
      self.postMessage({ done: true, formatted: out });
      return;
    }
    if (op === "lint") {
      await ensurePy("Downloading Python…");
      py.globals.set("__src", e.data.code);
      // syntax errors first (free, always available)
      const syntax = await py.runPythonAsync(\`
import json
_d = []
try:
    compile(__src, "<playground>", "exec")
except SyntaxError as _e:
    _d.append({"line": _e.lineno or 1, "col": _e.offset or 1, "msg": _e.msg, "severity": "error"})
json.dumps(_d)\`);
      const diags = JSON.parse(syntax);
      if (!diags.length) { // no syntax error → run pyflakes for warnings
        if (!flakesReady) { self.postMessage({ status: "Installing linter…" }); await py.pyimport("micropip").install("pyflakes"); flakesReady = true; }
        const warns = await py.runPythonAsync(\`
import json, io, pyflakes.api, pyflakes.reporter
_o, _e = io.StringIO(), io.StringIO()
pyflakes.api.check(__src, "<playground>", pyflakes.reporter.Reporter(_o, _e))
_d = []
for _ln in _o.getvalue().splitlines():
    _p = _ln.split(":", 3)
    if len(_p) >= 4:
        _d.append({"line": int(_p[1]), "col": int(_p[2]), "msg": _p[3].strip(), "severity": "warn"})
json.dumps(_d)\`);
        diags.push(...JSON.parse(warns));
      }
      self.postMessage({ done: true, diags });
      return;
    }
  } catch (err) {
    self.postMessage({ done: true, error: String(err) });
  }
};`;

const workerURL = (src: string) => URL.createObjectURL(new Blob([src], { type: "application/javascript" }));

let jsWorker: Worker | null = null;
let pyWorker: Worker | null = null;
let pyReady = false;

function getWorker(lang: Lang): Worker {
  if (lang === "js") return (jsWorker ??= new Worker(workerURL(JS_WORKER)));
  return (pyWorker ??= new Worker(workerURL(PY_WORKER)));
}
function killWorker(lang: Lang) {
  if (lang === "js") { jsWorker?.terminate(); jsWorker = null; }
  else { pyWorker?.terminate(); pyWorker = null; pyReady = false; }
}

// low-level: post a job to a worker, resolve on its reply, terminate on timeout
function job(lang: Lang, payload: any, budget: number, onStatus?: (s: string) => void): Promise<any> {
  return new Promise((resolve) => {
    const w = getWorker(lang);
    const timer = setTimeout(() => { killWorker(lang); done({ timedOut: true }); }, budget);
    const onMsg = (e: MessageEvent) => {
      if (e.data?.status) { onStatus?.(e.data.status); return; }
      clearTimeout(timer);
      if (lang === "python") pyReady = true;
      done(e.data);
    };
    const done = (data: any) => { w.removeEventListener("message", onMsg); resolve(data); };
    w.addEventListener("message", onMsg);
    w.postMessage(payload);
  });
}

/** Run code with a hard timeout. */
export async function run(lang: Lang, code: string, onStatus?: (s: string) => void): Promise<RunResult> {
  const t = performance.now();
  const budget = lang === "python" && !pyReady ? LOAD_MS : TIMEOUT_MS;
  const d = await job(lang, { op: "run", code }, budget, onStatus);
  if (d.timedOut) return { output: "", error: "⏱ Terminated — exceeded the time limit (infinite loop or heavy computation).", timedOut: true, ms: performance.now() - t };
  return { output: d.output ?? "", error: d.error, timedOut: false, ms: performance.now() - t };
}

/** Format Python via black (in the worker). Returns null if it couldn't. */
export async function formatPy(code: string, onStatus?: (s: string) => void): Promise<string | null> {
  const d = await job("python", { op: "format", code }, LOAD_MS, onStatus);
  return d.timedOut || d.error ? null : (d.formatted ?? null);
}

/** Lint Python (syntax via compile + warnings via pyflakes, in the worker). */
export async function lintPy(code: string, onStatus?: (s: string) => void): Promise<Diag[]> {
  const d = await job("python", { op: "lint", code }, LOAD_MS, onStatus);
  return d.timedOut || d.error ? [] : (d.diags ?? []);
}

export function disposeRunners() { killWorker("js"); killWorker("python"); }
