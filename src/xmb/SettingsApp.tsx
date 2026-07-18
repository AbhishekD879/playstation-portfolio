// Console Settings — the PS5-style hub. Six sections on a scroll-snap rail:
// APPEARANCE (font family / tracking / display size, live), ICONS (re-icon any
// category or app from the console's own PS glyph set), AUDIO (master volume,
// nav sounds, mute), LANGUAGE (on-device Universal Menu translation), LABS
// (every flag inline, with fitness badges), SYSTEM (device, AI memory,
// storage). Everything applies instantly; nothing needs a save button.
// Controller/keyboard: ←→ sections · ↑↓ rows · ✕ cycles or opens · ◯ back.
import { For, Show, createSignal, onMount } from "solid-js";
import * as sfx from "../audio";
import { SND_PACKS, getSndPack, getVolume, isMuted, setSndPack, setVolume, toggleMute } from "../audio";
import { CATEGORIES } from "../content";
import { DEVICE, deviceSummary } from "../gpu";
import { LAB_GROUPS, labEnabled, rateFeature, toggleLab } from "../labs";
import { MODEL_BUDGET_MB, freeAllModels, residentModels } from "../models";
import type { NavAction } from "../input";
import {
  FONT_PRESETS, LANGS, SIZES, TRACKINGS,
  fontId, iconOf, iconOverrides, lang, setFont, setIconOverride, setLang, setTracking, setUiSize, sizeId, trackId,
} from "../prefs";
import { ICONS, Icon } from "./icons";

const SECTIONS = ["APPEARANCE", "ICONS", "AUDIO", "LANGUAGE", "LABS", "SYSTEM"] as const;

// default icons for things whose items are built dynamically inside XMB
const DYNAMIC_ICONS: Record<string, string> = {
  doom: "skull", doomrtx: "lightning", chess: "knight", trivia: "question", flash: "lightning",
  ps2: "disc", ps1: "disc", psp: "disc", retro: "gamepad", scummvm: "folder-open", lichesstv: "knight",
  "radio-guide": "globe", podcasts: "mic", winamp: "lightning", karaoke: "mic", radio: "note",
  visualizer: "wave", studio: "note", strudel: "pen", videoplayer: "film", settingshub: "gear",
  yt: "play", "ia-video": "film", "sp-default": "disc",
};

interface IconTarget { id: string; label: string; def: string; kind: "category" | "app" }

export default function SettingsApp(props: {
  onClose: () => void;
  bind: (nav: (a: NavAction) => void) => void;
  onOpenThemes: () => void;
}) {
  const [sec, setSec] = createSignal(0);
  const [row, setRow] = createSignal(0);
  const [picking, setPicking] = createSignal<IconTarget | null>(null);
  const [pickIdx, setPickIdx] = createSignal(0);
  const [vol, setVol] = createSignal(getVolume());
  const [muted, setMuted] = createSignal(isMuted());
  const [pack, setPack] = createSignal(getSndPack());
  const [labsWarn, setLabsWarn] = createSignal<string | null>(null);
  const [storage, setStorage] = createSignal("");
  let rail!: HTMLDivElement;

  onMount(() => {
    navigator.storage?.estimate?.().then((e) => {
      if (e.usage != null) setStorage(`${(e.usage / 1048576).toFixed(0)} MB used${e.quota ? ` of ~${(e.quota / 1073741824).toFixed(0)} GB available` : ""}`);
    }).catch(() => {});
  });

  // —— icon targets: categories first (the headline ask), then every app ——
  const iconTargets = (): IconTarget[] => {
    const cats: IconTarget[] = CATEGORIES.map((c) => ({ id: c.id, label: c.label, def: c.icon, kind: "category" as const }));
    const seen = new Set(cats.map((c) => c.id));
    const apps: IconTarget[] = [];
    for (const c of CATEGORIES) for (const it of c.items) {
      if (!seen.has(it.id)) { seen.add(it.id); apps.push({ id: it.id, label: it.title, def: it.icon, kind: "app" }); }
    }
    for (const [id, def] of Object.entries(DYNAMIC_ICONS)) {
      if (!seen.has(id)) { seen.add(id); apps.push({ id, label: id, def, kind: "app" }); }
    }
    return [...cats, ...apps];
  };
  const ICON_NAMES = Object.keys(ICONS);

  const goSec = (d: number) => {
    const n = (sec() + d + SECTIONS.length) % SECTIONS.length;
    setSec(n);
    setRow(0);
    setLabsWarn(null);
    sfx.tickH();
    rail?.children[n]?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  };

  const cycle = <T,>(list: T[], curIdx: number, d = 1) => list[(curIdx + d + list.length) % list.length];

  // Labs inline toggle with the same ⚠ press-again guard as the modal
  const labsFlat = () => LAB_GROUPS.flatMap((g) => g.items.map((f) => ({ ...f, group: g.group })));
  const tryToggle = (id: string) => {
    const turningOn = !labEnabled(id);
    const fit = rateFeature(id);
    if (turningOn && fit && fit.level !== "ready" && labsWarn() !== id) {
      setLabsWarn(id);
      sfx.deny();
      setTimeout(() => setLabsWarn((w) => (w === id ? null : w)), 5000);
      return;
    }
    setLabsWarn(null);
    toggleLab(id);
    sfx.confirm();
  };

  // —— rows per section, for pad navigation (confirm = cycle/open) ——————————
  const rowCount = () => {
    switch (SECTIONS[sec()]) {
      case "APPEARANCE": return 4; // font, tracking, size, theme link
      case "ICONS": return iconTargets().length;
      case "AUDIO": return 3;
      case "LANGUAGE": return LANGS.length;
      case "LABS": return labsFlat().length;
      case "SYSTEM": return 1; // free-memory button
    }
  };
  const confirmRow = () => {
    const s = SECTIONS[sec()], r = row();
    if (s === "APPEARANCE") {
      if (r === 0) { const i = FONT_PRESETS.findIndex((f) => f.id === fontId()); setFont(cycle(FONT_PRESETS, i).id); sfx.tickH(); }
      if (r === 1) { const i = TRACKINGS.findIndex((t) => t.id === trackId()); setTracking(cycle(TRACKINGS, i).id); sfx.tickH(); }
      if (r === 2) { const i = SIZES.findIndex((t) => t.id === sizeId()); setUiSize(cycle(SIZES, i).id); sfx.tickH(); }
      if (r === 3) { sfx.confirm(); props.onOpenThemes(); }
    } else if (s === "ICONS") {
      const t = iconTargets()[r];
      if (t) { setPicking(t); setPickIdx(Math.max(0, ICON_NAMES.indexOf(iconOf(t.id, t.def)))); sfx.confirm(); }
    } else if (s === "AUDIO") {
      if (r === 0) { const v = Math.round((vol() + 0.25) * 4) / 4; const nv = v > 1 ? 0.25 : v; setVolume(nv); setVol(nv); sfx.tickV(); }
      if (r === 1) { const i = SND_PACKS.findIndex((p) => p.id === pack()); const np = cycle(SND_PACKS, i); setSndPack(np.id); setPack(np.id); sfx.confirm(); }
      if (r === 2) { setMuted(toggleMute()); sfx.tickV(); }
    } else if (s === "LANGUAGE") {
      const l = LANGS[r];
      if (l) { setLang(l.id); sfx.confirm(); }
    } else if (s === "LABS") {
      const f = labsFlat()[r];
      if (f) tryToggle(f.id);
    } else if (s === "SYSTEM") {
      freeAllModels(); sfx.confirm();
    }
  };

  props.bind((a) => {
    if (picking()) { // icon-picker grid: 8 per row
      const n = ICON_NAMES.length;
      if (a === "left") { setPickIdx((pickIdx() + n - 1) % n); sfx.tickV(); }
      if (a === "right") { setPickIdx((pickIdx() + 1) % n); sfx.tickV(); }
      if (a === "up") { setPickIdx((pickIdx() + n - 8) % n); sfx.tickV(); }
      if (a === "down") { setPickIdx((pickIdx() + 8) % n); sfx.tickV(); }
      if (a === "confirm") { setIconOverride(picking()!.id, ICON_NAMES[pickIdx()]); setPicking(null); sfx.confirm(); }
      if (a === "options") { setIconOverride(picking()!.id, null); setPicking(null); sfx.back(); }
      if (a === "back") { setPicking(null); sfx.back(); }
      return;
    }
    if (a === "left") goSec(-1);
    if (a === "right") goSec(1);
    if (a === "up") { setRow(Math.max(0, row() - 1)); sfx.tickV(); }
    if (a === "down") { setRow(Math.min(rowCount()! - 1, row() + 1)); sfx.tickV(); }
    if (a === "confirm") confirmRow();
    if (a === "back") { sfx.back(); props.onClose(); }
  });

  const pill = (active: boolean) => ({ class: "set-pill", classList: { on: active } });

  return (
    <div class="setapp">
      <div class="guide-head">
        <div class="panel-tag">CONSOLE SETTINGS</div>
        <button class="ps-act" onClick={() => { sfx.back(); props.onClose(); }}><span class="btn-o" /> back</button>
      </div>

      {/* section rail — a real CSS scroll-snap carousel (Snap Rail Nav, native) */}
      <div class="set-rail" ref={rail}>
        <For each={[...SECTIONS]}>
          {(s, i) => (
            <button class="set-tab" classList={{ on: sec() === i() }}
              onClick={() => { setSec(i()); setRow(0); sfx.tickH(); }}>{s}</button>
          )}
        </For>
      </div>

      <div class="set-body">
        {/* ————— APPEARANCE ————— */}
        <Show when={SECTIONS[sec()] === "APPEARANCE"}>
          <div class="set-rows">
            <div class="set-row" classList={{ focus: row() === 0 }}>
              <div class="set-row-head"><span class="set-row-title">Console Font</span><span class="set-row-sub">every label, every app — applied live</span></div>
              <div class="set-choices">
                <For each={FONT_PRESETS}>
                  {(f) => (
                    <button {...pill(fontId() === f.id)} style={{ "font-family": f.stack }}
                      onClick={() => { setFont(f.id); sfx.tickH(); }}>{f.name}</button>
                  )}
                </For>
              </div>
            </div>
            <div class="set-row" classList={{ focus: row() === 1 }}>
              <div class="set-row-head"><span class="set-row-title">Letter Spacing</span></div>
              <div class="set-choices">
                <For each={TRACKINGS}>{(t) => <button {...pill(trackId() === t.id)} onClick={() => { setTracking(t.id); sfx.tickH(); }}>{t.name}</button>}</For>
              </div>
            </div>
            <div class="set-row" classList={{ focus: row() === 2 }}>
              <div class="set-row-head"><span class="set-row-title">Display Size</span><span class="set-row-sub">scales the whole console, PS display-area style</span></div>
              <div class="set-choices">
                <For each={SIZES}>{(t) => <button {...pill(sizeId() === t.id)} onClick={() => { setUiSize(t.id); sfx.tickH(); }}>{t.name}</button>}</For>
              </div>
            </div>
            <div class="set-row" classList={{ focus: row() === 3 }}>
              <div class="set-row-head"><span class="set-row-title">Theme & Background</span><span class="set-row-sub">tint presets, custom colour, living backdrops</span></div>
              <div class="set-choices"><button class="set-pill" onClick={() => { sfx.confirm(); props.onOpenThemes(); }}>OPEN THEME SETTINGS ▸</button></div>
            </div>
          </div>
        </Show>

        {/* ————— ICONS ————— */}
        <Show when={SECTIONS[sec()] === "ICONS"}>
          <div class="set-note">Give any category or app a different glyph from the console's own icon set. △ in the picker restores the default.</div>
          <div class="set-icon-list">
            <For each={iconTargets()}>
              {(t, i) => (
                <button class="set-icon-row" classList={{ focus: row() === i(), changed: !!iconOverrides()[t.id] }}
                  onClick={() => { setRow(i()); setPicking(t); setPickIdx(Math.max(0, ICON_NAMES.indexOf(iconOf(t.id, t.def)))); sfx.confirm(); }}>
                  <span class="set-icon-cur"><Icon name={iconOf(t.id, t.def)} /></span>
                  <span class="set-icon-label">{t.label}</span>
                  <span class="set-icon-kind">{t.kind === "category" ? "CATEGORY" : "APP"}{iconOverrides()[t.id] ? " · custom" : ""}</span>
                </button>
              )}
            </For>
          </div>
        </Show>

        {/* ————— AUDIO ————— */}
        <Show when={SECTIONS[sec()] === "AUDIO"}>
          <div class="set-rows">
            <div class="set-row" classList={{ focus: row() === 0 }}>
              <div class="set-row-head"><span class="set-row-title">Master Volume</span></div>
              <div class="set-choices set-vol">
                <input type="range" min="0" max="100" value={Math.round(vol() * 100)}
                  onInput={(e) => { const v = +e.currentTarget.value / 100; setVolume(v); setVol(v); }} />
                <span class="set-vol-val">{Math.round(vol() * 100)}%</span>
              </div>
            </div>
            <div class="set-row" classList={{ focus: row() === 1 }}>
              <div class="set-row-head"><span class="set-row-title">Navigation Sounds</span></div>
              <div class="set-choices">
                <For each={SND_PACKS}>{(p) => <button {...pill(pack() === p.id)} onClick={() => { setSndPack(p.id); setPack(p.id); sfx.confirm(); }}>{p.name}</button>}</For>
              </div>
            </div>
            <div class="set-row" classList={{ focus: row() === 2 }}>
              <div class="set-row-head"><span class="set-row-title">Mute Console</span></div>
              <div class="set-choices"><button {...pill(muted())} onClick={() => { setMuted(toggleMute()); }}>{muted() ? "MUTED" : "SOUND ON"}</button></div>
            </div>
          </div>
        </Show>

        {/* ————— LANGUAGE ————— */}
        <Show when={SECTIONS[sec()] === "LANGUAGE"}>
          <div class="set-note">
            Universal Menu translates the crossbar on-device — a small model per language, downloaded once, cached forever.
            <Show when={!labEnabled("translate")}> <b>The Universal Menu Labs flag is off — English only until it's enabled.</b></Show>
          </div>
          <div class="set-lang-grid">
            <For each={LANGS}>
              {(l, i) => (
                <button class="set-lang" classList={{ on: lang() === l.id, focus: row() === i() }}
                  onClick={() => { setRow(i()); setLang(l.id); sfx.confirm(); }}>
                  <span class="set-lang-native">{l.native}</span>
                  <span class="set-lang-en">{l.name}</span>
                </button>
              )}
            </For>
          </div>
        </Show>

        {/* ————— LABS ————— */}
        <Show when={SECTIONS[sec()] === "LABS"}>
          <div class="set-note">Every feature on the console, switchable. ✓ suits this device · ⚠ heavy here · ✕ can't run — heavy ones ask twice. Full guides live in Settings › Labs on the crossbar.</div>
          <div class="set-labs">
            <For each={LAB_GROUPS}>
              {(g) => (
                <div class="set-labs-group">
                  <div class="set-labs-head"><Icon name={g.icon} />{g.group}</div>
                  <For each={g.items}>
                    {(f) => {
                      const my = () => labsFlat().findIndex((x) => x.id === f.id);
                      const fit = rateFeature(f.id);
                      return (
                        <button class="set-labs-row" classList={{ focus: row() === my() }}
                          onClick={() => { setRow(my()); tryToggle(f.id); }}>
                          <span class="set-labs-info">
                            <span class="set-labs-title">{f.title}{fit ? <span class={`labs-fit ${fit.level}`}>{fit.level === "ready" ? "✓" : fit.level === "caution" ? "⚠" : "✕"}</span> : null}</span>
                            <Show when={labsWarn() === f.id} fallback={<span class="set-labs-desc">{f.desc}</span>}>
                              <span class="set-labs-desc labs-warn-text">⚠ {fit?.notes[0] ?? "heavy for this device"} — press again to enable anyway</span>
                            </Show>
                          </span>
                          <span class="labs-switch" classList={{ on: labEnabled(f.id) }}><span class="labs-knob" /></span>
                        </button>
                      );
                    }}
                  </For>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* ————— SYSTEM ————— */}
        <Show when={SECTIONS[sec()] === "SYSTEM"}>
          <div class="set-rows">
            <div class="set-sys-card">
              <div class="set-row-title">This Console</div>
              <div class="set-sys-line">{deviceSummary()}</div>
              <div class="set-sys-line">{DEVICE.isolated ? "cross-origin isolated — PS2/PSP cores available" : "not isolated — PS2/PSP cores unavailable"}</div>
            </div>
            <div class="set-sys-card">
              <div class="set-row-title">On-Device AI Memory</div>
              <div class="set-sys-line">budget {MODEL_BUDGET_MB} MB · idle models free themselves after 3 min · downloads stay cached on disk</div>
              <For each={residentModels()} fallback={<div class="set-sys-line dim">no models in memory right now</div>}>
                {(m) => <div class="set-sys-line">▸ {m.label} — {m.sizeMB} MB, idle {m.idleS}s</div>}
              </For>
              <button class="set-pill" classList={{ focus: row() === 0 }} onClick={() => { freeAllModels(); sfx.confirm(); }}>FREE AI MEMORY NOW</button>
            </div>
            <div class="set-sys-card">
              <div class="set-row-title">Storage</div>
              <div class="set-sys-line">{storage() || "not reported by this browser"}</div>
              <div class="set-sys-line dim">profiles, trophies, saves & your game library live only in this browser</div>
            </div>
          </div>
        </Show>
      </div>

      {/* icon picker overlay */}
      <Show when={picking()} keyed>
        {(t) => (
          <>
            <div class="panel-backdrop" onClick={() => setPicking(null)} />
            <div class="modal set-picker">
              <div class="panel-tag">CHOOSE AN ICON — {t.label.toUpperCase()}</div>
              <div class="set-picker-grid">
                <For each={ICON_NAMES}>
                  {(name, i) => (
                    <button class="set-picker-cell" classList={{ cur: iconOf(t.id, t.def) === name, focus: pickIdx() === i() }}
                      title={name}
                      onClick={() => { setIconOverride(t.id, name); setPicking(null); sfx.confirm(); }}>
                      <Icon name={name} />
                    </button>
                  )}
                </For>
              </div>
              <div class="modal-hint"><span class="btn-x" /> set · △ restore default · <span class="btn-o" /> cancel</div>
            </div>
          </>
        )}
      </Show>

      <div class="panel-hint guide-hint">←→ sections · ↑↓ rows · <span class="btn-x" /> change · <span class="btn-o" /> back</div>
    </div>
  );
}
