// Universal Menu — on-the-fly crossbar translation, fully on-device. Picking
// a language in Settings lazy-loads a small opus-mt model (~45 MB, managed by
// src/models.ts) and translates category labels and item titles/subs as they
// render. Results cache in localStorage per language, so a returning visitor
// pays the model cost once and the strings never again. "en" = untouched.
import { createSignal } from "solid-js";
import { acquireModel } from "./models";
import { labEnabled } from "./labs";
import { lang } from "./prefs";

const MODELS: Record<string, string> = {
  es: "Xenova/opus-mt-en-es",
  fr: "Xenova/opus-mt-en-fr",
  de: "Xenova/opus-mt-en-de",
  hi: "Xenova/opus-mt-en-hi",
  it: "Xenova/opus-mt-en-it",
};

// per-language translation cache: lang -> (english -> translated)
const caches = new Map<string, Map<string, string>>();
const [tick, setTick] = createSignal(0); // bumps when new translations land
const pending = new Set<string>();
let queue: string[] = [];
let draining = false;

// —— visible status, so picking a language never looks dead ————————————————
export type TrStatus = "idle" | "downloading" | "translating" | "ready" | "failed";
const [trStatus, setTrStatus] = createSignal<TrStatus>("idle");
const [trPct, setTrPct] = createSignal(0); // model download %
export { trStatus, trPct };

/** After a failure: re-arm and re-render labels so they re-enqueue. */
export function trRetry() {
  if (trStatus() !== "failed") return;
  setTrStatus("idle");
  setTick(tick() + 1);
}

function cacheFor(l: string): Map<string, string> {
  let c = caches.get(l);
  if (!c) {
    c = new Map();
    try {
      const stored = JSON.parse(localStorage.getItem("asp.tr." + l) ?? "[]");
      for (const [k, v] of stored) c.set(k, v);
    } catch { /* fresh cache */ }
    caches.set(l, c);
  }
  return c;
}

function persist(l: string) {
  try { localStorage.setItem("asp.tr." + l, JSON.stringify([...cacheFor(l)].slice(-400))); } catch { /* full */ }
}

async function drain(l: string) {
  if (draining) return;
  draining = true;
  try {
    setTrStatus("downloading");
    setTrPct(0);
    const pipe = await acquireModel<any>("opus-" + l, `Translator (${l.toUpperCase()})`, 50, async () => {
      const { pipeline } = await import("@huggingface/transformers");
      const device = typeof (navigator as any).gpu !== "undefined" ? "webgpu" : "wasm";
      return pipeline("translation", MODELS[l], {
        device,
        session_options: { logSeverityLevel: 3 },
        progress_callback: (p: any) => {
          if (p?.status === "progress" && typeof p.progress === "number" && String(p.file ?? "").includes("onnx")) {
            setTrPct(Math.min(99, Math.round(p.progress)));
          }
        },
      } as any);
    });
    setTrStatus("translating");
    while (queue.length && lang() === l) {
      const batch = queue.splice(0, 8);
      const out = await pipe(batch);
      const c = cacheFor(l);
      batch.forEach((src, i) => {
        const t = (Array.isArray(out) ? out[i] : out)?.translation_text;
        if (t) c.set(src, t);
        pending.delete(src);
      });
      persist(l);
      setTick(tick() + 1); // labels re-render with fresh strings
    }
    setTrStatus("ready");
  } catch (e) {
    console.warn("[translate] translator failed:", e);
    queue = []; // model unavailable — leave English in place
    pending.clear();
    setTrStatus("failed");
  } finally {
    draining = false;
  }
}

/** Translate a UI string into the console language. Returns English until the
 *  on-device translation lands, then re-renders reactively. */
export function tr(text: string): string {
  const l = lang();
  if (l === "en" || !MODELS[l] || !labEnabled("translate") || !text) return text;
  tick(); // subscribe
  const hit = cacheFor(l).get(text);
  if (hit) return hit;
  if (!pending.has(text)) {
    pending.add(text);
    queue.push(text);
    void drain(l);
  }
  return text;
}
