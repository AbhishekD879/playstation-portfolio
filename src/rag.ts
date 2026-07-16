// On-device retrieval — MiniLM sentence embeddings (transformers.js, WebGPU
// with WASM fallback) over the portfolio content. The AI retrieves the few
// most relevant chunks per question instead of us dumping everything into the
// system prompt, so answers stay grounded and the context stays lean. ~23 MB
// model, downloaded once, cached. All local.
import { CAREER, OWNER, PROJECTS, SKILLS } from "./content";

// —— the knowledge base: one chunk per fact cluster ——
const CHUNKS: string[] = [
  `${OWNER.name} — ${OWNER.title}, based in ${OWNER.location}. AI-first product engineer who ships agentic systems, voice-AI tooling, and the interfaces around them. Contact: ${OWNER.email}, ${OWNER.linkedin}.`,
  "Services Abhishek offers: agentic AI systems & LLM workflow design, voice-AI tooling & prompt-optimization pipelines, RAG systems, full-stack product engineering, test automation.",
  ...CAREER.map((c) => `Career — ${c.title} (${c.tag}, ${c.meta}): ${c.bullets.join(" ")}`),
  ...PROJECTS.map((p) => `Project — ${p.title} (${p.meta}): ${p.bullets.join(" ")}`),
  ...SKILLS.map((s) => `Skills — ${s.name}: ${s.items.join(", ")}.`),
];

let extractor: any = null;
let index: Float32Array[] | null = null;
let building: Promise<void> | null = null;

const cosine = (a: Float32Array, b: Float32Array) => {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d; // vectors are L2-normalized → dot product is cosine similarity
};

async function embed(texts: string[]): Promise<Float32Array[]> {
  const out = await extractor(texts, { pooling: "mean", normalize: true });
  // tensor → one Float32Array per input row
  const [rows, dim] = out.dims as [number, number];
  const data = out.data as Float32Array;
  return Array.from({ length: rows }, (_, r) => data.slice(r * dim, (r + 1) * dim));
}

/** Load the model and embed the knowledge base. Safe to call repeatedly. */
export function buildIndex(): Promise<void> {
  if (!building) {
    building = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      const device = typeof (navigator as any).gpu !== "undefined" ? "webgpu" : "wasm";
      extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { device } as any);
      index = await embed(CHUNKS);
    })().catch((e) => { building = null; throw e; });
  }
  return building;
}

/** Return the top-k most relevant knowledge chunks for a query. */
export async function retrieve(query: string, k = 4): Promise<string[]> {
  try {
    await buildIndex();
    if (!index) return [];
    const [q] = await embed([query]);
    return index
      .map((v, i) => ({ i, s: cosine(q, v) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, k)
      .filter((x) => x.s > 0.2) // drop weak matches
      .map((x) => CHUNKS[x.i]);
  } catch {
    return []; // retrieval is best-effort; the agent still answers without it
  }
}
