// On-device model manager — every transformers.js pipeline on the console
// (MiniLM embeddings, Whisper, Depth Anything, Swin2SR) is acquired through
// here so AI never bloats the visitor's device:
//  · lazy      — nothing loads until a feature actually runs
//  · budgeted  — resident models are capped by deviceMemory (LRU-evicted)
//  · idle-swept— unused pipelines are disposed after a few minutes, freeing
//                RAM/VRAM; the weights stay in the browser's Cache Storage
//                (disk), so re-acquiring is seconds, not a re-download
//  · flushed   — a tab hidden for a minute drops everything resident
// WebLLM (AI chat) manages itself: the engine unloads when the chat closes.
import { createSignal } from "solid-js";

interface ModelEntry {
  id: string;
  label: string;
  sizeMB: number; // rough resident footprint (weights + session)
  pipe: any | null;
  loading: Promise<any> | null;
  lastUsed: number;
}

const registry = new Map<string, ModelEntry>();

export interface ResidentModel { id: string; label: string; sizeMB: number; idleS: number }
const [resident, setResident] = createSignal<ResidentModel[]>([]);
/** Live view of what's in memory right now — shown in System Information. */
export const residentModels = resident;

// resident-memory budget scaled to the device (deviceMemory is Chromium-only)
export const MODEL_BUDGET_MB = (() => {
  const gb = (navigator as any).deviceMemory ?? 8;
  return gb >= 8 ? 450 : gb >= 4 ? 220 : 110;
})();
const IDLE_TTL = 3 * 60_000;   // dispose after 3 min unused
const HIDDEN_TTL = 60_000;     // dispose everything a minute after the tab hides

function refresh() {
  const now = Date.now();
  setResident([...registry.values()]
    .filter((e) => e.pipe)
    .map((e) => ({ id: e.id, label: e.label, sizeMB: e.sizeMB, idleS: Math.round((now - e.lastUsed) / 1000) })));
}

const residentMB = () => [...registry.values()].reduce((s, e) => s + (e.pipe ? e.sizeMB : 0), 0);

async function dispose(e: ModelEntry) {
  const p = e.pipe;
  e.pipe = null;
  refresh();
  try { await p?.dispose?.(); } catch { /* session already gone */ }
}

async function evictForBudget(incomingMB: number, keepId: string) {
  while (residentMB() + incomingMB > MODEL_BUDGET_MB) {
    const lru = [...registry.values()]
      .filter((e) => e.pipe && e.id !== keepId)
      .sort((a, b) => a.lastUsed - b.lastUsed)[0];
    if (!lru) break; // nothing else to give back
    await dispose(lru);
  }
}

/** Get (loading if needed) a model pipeline. Loader runs once per residency. */
export function acquireModel<T = any>(id: string, label: string, sizeMB: number, loader: () => Promise<T>): Promise<T> {
  let e = registry.get(id);
  if (!e) { e = { id, label, sizeMB, pipe: null, loading: null, lastUsed: 0 }; registry.set(id, e); }
  e.lastUsed = Date.now();
  if (e.pipe) { refresh(); return Promise.resolve(e.pipe as T); }
  if (!e.loading) {
    e.loading = (async () => {
      await evictForBudget(sizeMB, id);
      const pipe = await loader();
      e!.pipe = pipe;
      e!.loading = null;
      e!.lastUsed = Date.now();
      refresh();
      return pipe;
    })().catch((err) => { e!.loading = null; throw err; });
  }
  return e.loading as Promise<T>;
}

/** Drop every resident model right now (System Information's FREE button). */
export function freeAllModels() {
  for (const e of registry.values()) if (e.pipe) void dispose(e);
}

// idle sweep — also keeps the sysinfo idle counters ticking
setInterval(() => {
  const now = Date.now();
  for (const e of registry.values()) {
    if (e.pipe && now - e.lastUsed > IDLE_TTL) void dispose(e);
  }
  refresh();
}, 30_000);

// hidden tab → flush after a grace period (coming back re-acquires from disk cache)
let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    hiddenTimer = setTimeout(freeAllModels, HIDDEN_TTL);
  } else if (hiddenTimer) {
    clearTimeout(hiddenTimer);
    hiddenTimer = null;
  }
});
