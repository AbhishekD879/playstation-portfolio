// The console control bus — an internal "MCP" for the AI co-pilot. The XMB
// (and apps) register every user-reachable action here with a description and
// parameter spec; the agent discovers them (the manifest feeds its RAG memory
// and system prompt) and invokes them through one console_control tool. This
// is the single source of truth for "what can be done on this console".
export interface ActionParam { name: string; description: string; required?: boolean }
export interface ConsoleAction {
  id: string;               // e.g. "radio.play", "settings.theme"
  description: string;      // what it does, phrased for the model
  params?: ActionParam[];
  run: (args: Record<string, string>) => string | Promise<string>; // result text for the model
}

const registry = new Map<string, ConsoleAction>();

if (import.meta.env.DEV) (globalThis as any).__bus = { run: (id: string, args?: any) => runAction(id, args), list: () => [...registry.keys()] };

export function registerActions(actions: ConsoleAction[]) {
  for (const a of actions) registry.set(a.id, a);
}
export function unregisterActions(ids: string[]) {
  for (const id of ids) registry.delete(id);
}
export const listActions = () => [...registry.values()];

export async function runAction(id: string, args: Record<string, string> = {}): Promise<string> {
  const a = registry.get(id.trim());
  if (!a) {
    // be forgiving with near-misses — small models mangle ids
    const close = [...registry.keys()].find((k) => k.replace(/[._-]/g, "") === id.replace(/[._-]/g, "").toLowerCase());
    if (close) return runAction(close, args);
    return `Unknown action "${id}". Valid actions: ${[...registry.keys()].join(", ")}`;
  }
  const missing = (a.params ?? []).filter((p) => p.required && !args[p.name]);
  if (missing.length) return `Action "${id}" needs: ${missing.map((p) => p.name).join(", ")}`;
  try {
    return await a.run(args);
  } catch (e) {
    return `Action "${id}" failed: ${String((e as Error).message ?? e).slice(0, 120)}`;
  }
}

/** One line per action — for the system prompt. */
export function capabilitySummary(): string {
  return listActions()
    .map((a) => `- ${a.id}${a.params?.length ? `(${a.params.map((p) => p.name + (p.required ? "" : "?")).join(", ")})` : ""}: ${a.description}`)
    .join("\n");
}

/** Richer chunks for the RAG index — one per action, retrievable by intent. */
export function capabilityChunks(): string[] {
  return listActions().map((a) =>
    `Console action "${a.id}" — ${a.description}${a.params?.length ? ` Parameters: ${a.params.map((p) => `${p.name} (${p.description}${p.required ? ", required" : ""})`).join("; ")}.` : ""} Invoke with the console_control tool.`);
}
