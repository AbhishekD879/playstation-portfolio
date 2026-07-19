// /admin — internal catalog review. Pulls candidate entries LIVE from the
// whitelisted FMHY tool/knowledge files (freecatalog.SOURCES — never the
// streaming/torrent/download/ROM files), diffs them against what's already
// published, and shows only what's NEW. You (the owner) validate each — the
// real destination host + one-click urlscan / VirusTotal — and approve the ones
// you want. Approvals export as JSON to merge into the published catalog.
//
// This is the human GATE: nothing an automated sync surfaces (a masked
// redirect, a link changed upstream, a compromised repo edit) reaches the
// public site without a person eyeballing it first.
//
// SECURITY: this page is only OBSCURED, not secured, until you put the /admin
// route behind Cloudflare Access (Zero Trust → restrict to your email). Do that
// before wiring live publishing.
import { For, Show, createSignal, onMount } from "solid-js";
import { SOURCES, hostOf, publishedUrls } from "../freecatalog";

type Cand = { name: string; url: string; note: string; source: string };
const RAW = "https://raw.githubusercontent.com/fmhy/edit/main/docs/";

// FMHY list lines look like: `* ⭐ **[Name](url)** - note / [mirror](url2)`.
// Take the FIRST link as the entry; strip markdown from the trailing note.
function parseMd(md: string, source: string): Cand[] {
  const out: Cand[] = [];
  const seen = new Set<string>();
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (!/^[*-]\s/.test(line)) continue;                 // list items only
    const m = line.match(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/);
    if (!m) continue;
    const name = m[1].replace(/[⭐🌟*_`>▷►]/g, "").trim();
    const url = m[2].trim().replace(/\/+$/, "");
    if (!name || !url || seen.has(url.toLowerCase())) continue;
    seen.add(url.toLowerCase());
    const parts = line.split(/\s[-—]\s/);
    let note = parts.length > 1 ? parts.slice(1).join(" - ") : "";
    note = note.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim().slice(0, 110);
    out.push({ name, url, note, source });
  }
  return out;
}

export default function AdminCatalog() {
  // per-source enable/disable (config-driven), persisted. Untick a source to
  // stop pulling candidates from it — e.g. if that upstream file is compromised.
  const SKEY = "asp.admin.sources.off";
  const loadOff = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(SKEY) ?? "[]")); } catch { return new Set(); } };
  const [off, setOff] = createSignal<Set<string>>(loadOff());
  const srcOn = (f: string) => !off().has(f);
  const toggleSrc = (f: string) => { const s = new Set(off()); s.has(f) ? s.delete(f) : s.add(f); setOff(s); localStorage.setItem(SKEY, JSON.stringify([...s])); void load(); };

  const [cands, setCands] = createSignal<Cand[]>([]);
  const [approved, setApproved] = createSignal<Set<string>>(new Set());
  const [status, setStatus] = createSignal("loading…");
  const [q, setQ] = createSignal("");

  async function load() {
    setStatus("fetching enabled sources…");
    const pub = publishedUrls();
    const active = SOURCES.filter((s) => srcOn(s.file));
    const all: Cand[] = [];
    const seen = new Set<string>();
    let ok = 0, fail = 0;
    await Promise.all(active.map(async (s) => {
      try {
        const r = await fetch(RAW + s.file, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const md = await r.text();
        for (const c of parseMd(md, s.label)) {
          const key = c.url.toLowerCase();
          if (pub.has(key) || seen.has(key)) continue;   // already published / dup
          seen.add(key); all.push(c);
        }
        ok++;
      } catch { fail++; }
    }));
    all.sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
    setCands(all);
    setStatus(`${all.length} new candidates · ${ok}/${active.length} sources loaded${fail ? ` · ${fail} failed (CORS/offline?)` : ""}`);
  }
  onMount(load);

  const toggle = (url: string) => { const s = new Set(approved()); s.has(url) ? s.delete(url) : s.add(url); setApproved(s); };
  const shown = () => { const f = q().toLowerCase().trim(); return f ? cands().filter((c) => (c.name + " " + c.url + " " + c.source + " " + c.note).toLowerCase().includes(f)) : cands(); };

  const exportJson = () => {
    const picked = cands().filter((c) => approved().has(c.url)).map(({ name, url, note, source }) => ({ name, url, note, source }));
    if (!picked.length) { setStatus("approve some entries first"); return; }
    const json = JSON.stringify(picked, null, 2);
    try { void navigator.clipboard?.writeText?.(json); } catch { /* clipboard blocked */ }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    a.download = "catalog-additions.json"; a.click();
    setStatus(`exported ${picked.length} approved entries (also copied to clipboard)`);
  };

  return (
    <div class="adm">
      <div class="adm-bar">
        <b>ADMIN · CATALOG REVIEW</b>
        <span class="adm-status">{status()}</span>
        <span class="adm-actions">
          <input class="adm-search" placeholder="filter…" value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
          <button class="adm-btn" onClick={load}>reload</button>
          <button class="adm-btn primary" onClick={exportJson}>export approved ({approved().size})</button>
        </span>
      </div>
      <div class="adm-warn">
        ⚠ <b>Not secured yet.</b> Lock <code>/admin</code> with Cloudflare Access (Zero Trust → restrict to your email) before relying on it.
        Candidates come only from whitelisted tool/knowledge files — you approve each before it's published.
      </div>
      <div class="adm-sources">
        <span class="adm-sources-label">Sources — untick to stop pulling from one (config in <code>freecatalog.ts</code>):</span>
        <For each={SOURCES}>{(s) => (
          <button class="adm-src-chip" classList={{ off: !srcOn(s.file) }} onClick={() => toggleSrc(s.file)} title={s.file}>
            {srcOn(s.file) ? "☑" : "☐"} {s.label}
          </button>
        )}</For>
      </div>
      <div class="adm-list">
        <For each={shown()}>{(c) => (
          <div class="adm-row" classList={{ on: approved().has(c.url) }}>
            <button class="adm-approve" classList={{ on: approved().has(c.url) }} onClick={() => toggle(c.url)}>
              {approved().has(c.url) ? "✓ approved" : "approve"}
            </button>
            <div class="adm-info">
              <div class="adm-name">{c.name} <span class="adm-src">{c.source}</span></div>
              <Show when={c.note}><div class="adm-note">{c.note}</div></Show>
              <div class="adm-url">{c.url}</div>
            </div>
            <div class="adm-validate">
              <a class="adm-btn" href={c.url} target="_blank" rel="noopener noreferrer">open ↗</a>
              <a class="adm-btn" href={`https://urlscan.io/domain/${hostOf(c.url)}`} target="_blank" rel="noopener noreferrer">urlscan</a>
              <a class="adm-btn" href={`https://www.virustotal.com/gui/domain/${hostOf(c.url)}`} target="_blank" rel="noopener noreferrer">virustotal</a>
            </div>
          </div>
        )}</For>
        <Show when={shown().length === 0}><div class="adm-empty">{status()}</div></Show>
      </div>
    </div>
  );
}
