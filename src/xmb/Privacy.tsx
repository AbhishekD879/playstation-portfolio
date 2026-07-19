// Free & Open — a curated shelf of FREE, LEGAL, open resources: the parts of
// FMHY (fmhy.net) that DON'T rely on piracy. AI tools, legal free streaming,
// music, open-source games + emulator software, learning, dev tools, creative
// tools, legal downloads, and a full privacy/security set. What's deliberately
// NOT here: pirate streaming / download / torrent / ROM-site sections — those
// facilitate copyright infringement and stay out of a public, real-name site.
// Each entry just opens the official site in a new tab; the console stores and
// proxies nothing. Hidden by default — opt in via Labs.
import { For, createResource, onCleanup, onMount } from "solid-js";
import * as sfx from "../audio";
import { CATALOG_API, CATS, hostOf, mergeExtra, type Entry } from "../freecatalog";

// owner-published entries (added live from /admin) merged onto the built-in list
const fetchExtra = async (): Promise<Entry[]> => {
  try { const r = await fetch(CATALOG_API); const j = await r.json() as { entries?: Entry[] }; return Array.isArray(j.entries) ? j.entries : []; } catch { return []; }
};

export default function Privacy(props: { onClose: () => void }) {
  const [extra] = createResource(fetchExtra);
  const cats = () => mergeExtra(CATS, extra() ?? []);
  onMount(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { sfx.back(); props.onClose(); } };
    addEventListener("keydown", onKey);
    onCleanup(() => removeEventListener("keydown", onKey));
  });
  const open = (u: string) => { sfx.confirm(); window.open(u, "_blank", "noopener,noreferrer"); };

  return (
    <div class="pvk pad-focus-scope">
      <div class="pvk-head">
        <div class="panel-tag">FREE &amp; OPEN · CURATED</div>
        <button class="ps-act" onClick={() => { sfx.back(); props.onClose(); }}><span class="btn-o" /> back</button>
      </div>
      <div class="pvk-intro">
        The <b>free, legal &amp; open</b> corners of the internet — AI, streaming, music, games &amp; emulators,
        learning, dev &amp; creative tools, and a full privacy set. Curated from the non-piracy parts of
        {" "}<a href="https://fmhy.net/" target="_blank" rel="noopener noreferrer">FMHY</a>.
        Each opens the official site in a new tab; the console stores and proxies nothing.
        <span class="pvk-note"> Pirate streaming / download / torrent / ROM sites aren't here — by design.</span>
      </div>
      <div class="pvk-grid">
        <For each={cats()}>{(c) => (
          <section class="pvk-cat">
            <h3 class="pvk-cat-title">{c.title}</h3>
            <For each={c.tools}>{(t) => (
              <button class="pvk-tool" onClick={() => open(t.url)} title={`Open ${hostOf(t.url)} in a new tab`}>
                <span class="pvk-tool-top"><span class="pvk-tool-name">{t.name}</span><span class="pvk-tool-host">{hostOf(t.url)} ↗</span></span>
                <span class="pvk-tool-note">{t.note}</span>
              </button>
            )}</For>
          </section>
        )}</For>
      </div>
    </div>
  );
}
