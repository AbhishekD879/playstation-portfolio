// System City — a modern, 2D system-design academy. Brilliant-style steps
// (one idea per screen, animated SVG diagrams, real images, instant-feedback
// quizzes), a curated "gold mine" of the internet's best free material per
// lesson + a standing Library, and per-level color identity so a beginner
// always knows where they are. Progress persists locally; nothing is locked.
import { For, Show, createMemo, createSignal } from "solid-js";
import type { NavAction } from "../input";
import * as sfx from "../audio";
import SysTutor from "./SysTutor";
import { ALL_LESSONS, IMAGES, LEVELS, LIBRARY, RESOURCES, lessonAfter, type Diagram, type Lesson, type Resource } from "../syslessons";

const KEY = "asp.syscity.v2";
type Prog = { done: string[]; last?: { l: string; s: number } };
const loadProg = (): Prog => { try { return { done: [], ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return { done: [] }; } };

// each level owns a hue — wayfinding for beginners ("I'm in the violet zone")
const HUE: Record<string, string> = { foundations: "#4fd6e6", blocks: "#5aa2ff", distributed: "#b389ff", scale: "#ffb648", casestudies: "#56d69a" };
const hueOf = (lessonId: string) => HUE[LEVELS.find((lv) => lv.lessons.some((l) => l.id === lessonId))?.id ?? "blocks"];

const KIND_ICON: Record<Resource["kind"], string> = { video: "▶", article: "✦", interactive: "◉", book: "▤", course: "◆", blog: "◈" };
const KIND_LABEL: Record<Resource["kind"], string> = { video: "video", article: "article", interactive: "interactive", book: "free book", course: "course", blog: "eng blog" };

// —— animated request-flow diagram (SVG + SMIL — light, no WebGL) ——
function FlowDiagram(props: { d: Diagram }) {
  const center = (id: string) => props.d.nodes.find((n) => n.id === id)!;
  const pathOf = (ids: string[]) => ids.map((id, i) => `${i ? "L" : "M"} ${center(id).x} ${center(id).y}`).join(" ");
  const edges = createMemo(() => {
    const seen = new Set<string>();
    const out: { a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
    for (const f of props.d.flows) for (let i = 0; i < f.path.length - 1; i++) {
      const k = [f.path[i], f.path[i + 1]].sort().join("→");
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ a: center(f.path[i]), b: center(f.path[i + 1]) });
    }
    return out;
  });
  const box = createMemo(() => {
    const ys = props.d.nodes.map((n) => n.y);
    const min = Math.min(...ys) - 52, max = Math.max(...ys) + 52;
    return `0 ${min} 720 ${max - min}`;
  });
  return (
    <div class="sdx-diagram">
      <svg viewBox={box()} role="img">
        <For each={edges()}>{(e) => <line x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} stroke="rgba(140,170,220,0.22)" stroke-width="2" />}</For>
        <For each={props.d.nodes}>
          {(n) => (
            <g>
              <rect x={n.x - 68} y={n.y - 27} width="136" height="54" rx="11" fill="rgba(16,24,40,0.92)" stroke="rgba(255,255,255,0.16)" />
              <text x={n.x} y={n.y - (n.sub ? 4 : -5)} text-anchor="middle" fill="#eaf1fb" font-size="14" font-weight="600" font-family="system-ui">{n.label}</text>
              <Show when={n.sub}><text x={n.x} y={n.y + 15} text-anchor="middle" fill="rgba(170,190,220,0.75)" font-size="10.5" font-family="ui-monospace">{n.sub}</text></Show>
            </g>
          )}
        </For>
        <For each={props.d.flows}>
          {(f) => (
            <circle r="6" fill={f.color} opacity="0.95">
              <animateMotion dur={`${f.dur ?? 4}s`} begin={`${f.delay ?? 0}s`} repeatCount="indefinite" path={pathOf(f.path)} />
            </circle>
          )}
        </For>
      </svg>
      <Show when={props.d.flows.some((f) => f.label)}>
        <div class="sdx-legend">
          <For each={props.d.flows.filter((f) => f.label)}>
            {(f) => <span class="sdx-legend-item"><span class="sdx-legend-dot" style={{ background: f.color }} /> {f.label}</span>}
          </For>
        </div>
      </Show>
    </div>
  );
}

function ResourceRow(props: { r: Resource }) {
  return (
    <a class="sdx-res" href={props.r.url} target="_blank" rel="noopener">
      <span class="sdx-res-ico" data-kind={props.r.kind}>{KIND_ICON[props.r.kind]}</span>
      <span class="sdx-res-body">
        <span class="sdx-res-title">{props.r.star ? "⭐ " : ""}{props.r.title}</span>
        <span class="sdx-res-src">{props.r.source} · {KIND_LABEL[props.r.kind]}{props.r.paid ? " · PAID" : ""}</span>
      </span>
      <span class="sdx-res-go">↗</span>
    </a>
  );
}

// SVG progress ring — the home hero's signature
function Ring(props: { pct: number; hue: string }) {
  const R = 52, C = 2 * Math.PI * R;
  return (
    <svg class="sdx-ring" viewBox="0 0 120 120">
      <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(255,255,255,0.09)" stroke-width="9" />
      <circle cx="60" cy="60" r={R} fill="none" stroke={props.hue} stroke-width="9" stroke-linecap="round"
        stroke-dasharray={`${(props.pct / 100) * C} ${C}`} transform="rotate(-90 60 60)" style={{ transition: "stroke-dasharray 0.6s ease" }} />
      <text x="60" y="57" text-anchor="middle" fill="#eef4fd" font-size="24" font-weight="800" font-family="system-ui">{props.pct}%</text>
      <text x="60" y="76" text-anchor="middle" fill="rgba(170,190,220,0.8)" font-size="10" letter-spacing="0.1em" font-family="ui-monospace">MASTERY</text>
    </svg>
  );
}

export default function SystemCity(props: { onClose: () => void; bind: (nav: (a: NavAction) => void) => void }) {
  const [prog, setProg] = createSignal<Prog>(loadProg());
  const [view, setView] = createSignal<{ t: "home" } | { t: "library" } | { t: "lesson"; lesson: Lesson; step: number } | { t: "finished"; lesson: Lesson }>({ t: "home" });
  const [picked, setPicked] = createSignal<number | null>(null);
  const [tutorOpen, setTutorOpen] = createSignal(false);
  const [tutorSeed, setTutorSeed] = createSignal<string | undefined>(undefined);

  const save = (p: Prog) => { setProg(p); localStorage.setItem(KEY, JSON.stringify(p)); };
  const isDone = (id: string) => prog().done.includes(id);
  const doneCount = () => prog().done.filter((id) => ALL_LESSONS.some((l) => l.id === id)).length;
  const pct = () => Math.round((doneCount() / ALL_LESSONS.length) * 100);
  const rank = () => (pct() >= 100 ? "Architect" : pct() >= 70 ? "Senior" : pct() >= 40 ? "Builder" : pct() > 0 ? "Apprentice" : "New Player");
  const resume = createMemo(() => {
    const p = prog();
    if (p.last && !p.done.includes(p.last.l)) {
      const l = ALL_LESSONS.find((x) => x.id === p.last!.l);
      if (l) return { lesson: l, step: Math.min(p.last.s, l.steps.length - 1) };
    }
    const next = ALL_LESSONS.find((l) => !p.done.includes(l.id));
    return next ? { lesson: next, step: 0 } : null;
  });

  function openLesson(l: Lesson, step = 0) {
    sfx.confirm?.();
    setPicked(null);
    setView({ t: "lesson", lesson: l, step });
    save({ ...prog(), last: { l: l.id, s: step } });
  }
  function goStep(d: 1 | -1) {
    const v = view();
    if (v.t !== "lesson") return;
    const s = v.step + d;
    if (s < 0) { sfx.back?.(); setView({ t: "home" }); return; }
    if (s >= v.lesson.steps.length) { finish(v.lesson); return; }
    setPicked(null);
    sfx.tickH?.();
    setView({ t: "lesson", lesson: v.lesson, step: s });
    save({ ...prog(), last: { l: v.lesson.id, s } });
  }
  function finish(l: Lesson) {
    const p = prog();
    save({ done: p.done.includes(l.id) ? p.done : [...p.done, l.id], last: undefined });
    sfx.confirm?.();
    setView({ t: "finished", lesson: l });
  }
  const canContinue = () => {
    const v = view();
    if (v.t !== "lesson") return false;
    return v.lesson.steps[v.step].kind === "learn" || picked() !== null;
  };
  const openTutor = (seed?: string) => { setTutorSeed(seed); setTutorOpen(true); sfx.confirm?.(); };

  props.bind((a) => {
    if (tutorOpen()) return;
    const v = view();
    if (a === "back") {
      if (v.t === "home") { sfx.back?.(); props.onClose(); }
      else { sfx.back?.(); setView({ t: "home" }); }
      return;
    }
    if (v.t === "lesson") {
      if ((a === "confirm" || a === "right") && canContinue()) goStep(1);
      if (a === "left") goStep(-1);
    } else if (v.t === "finished" && a === "confirm") {
      const nxt = lessonAfter(v.lesson.id);
      if (nxt) openLesson(nxt); else setView({ t: "home" });
    }
  });

  return (
    <div class="sdx">
      {/* ——— HOME ——— */}
      <Show when={view().t === "home"}>
        <div class="sdx-scroll">
          <div class="sdx-hero">
            <div class="sdx-hero-left">
              <div class="sdx-eyebrow">LEARN · SYSTEM DESIGN · 100% FREE</div>
              <h1 class="sdx-title">System City</h1>
              <p class="sdx-tagline">From “what's a server?” to designing WhatsApp — {ALL_LESSONS.length} visual lessons, quizzes, an AI tutor, and the internet's best free material, curated. No account. Nothing locked.</p>
              <div class="sdx-hero-acts">
                <Show when={resume()}>
                  {(r) => <button class="sdx-continue" onClick={() => openLesson(r().lesson, r().step)}>{doneCount() ? "▶ Continue — " : "▶ Start — "}{r().lesson.title}</button>}
                </Show>
                <button class="sdx-ghost" onClick={() => { sfx.tickV?.(); setView({ t: "library" }); }}>📚 Library</button>
                <button class="sdx-ghost" onClick={() => openTutor()}>🤖 AI tutor</button>
                <button class="sdx-ghost" onClick={() => { sfx.back?.(); props.onClose(); }}>✕ Exit</button>
              </div>
            </div>
            <div class="sdx-hero-right">
              <Ring pct={pct()} hue={pct() >= 100 ? "#56d69a" : "#4fa2ff"} />
              <div class="sdx-rankline">{rank()} · {doneCount()}/{ALL_LESSONS.length} lessons</div>
            </div>
          </div>

          <For each={LEVELS}>
            {(lv, li) => (
              <div class="sdx-level" style={{ "--lv": HUE[lv.id] }}>
                <div class="sdx-level-head">
                  <span class="sdx-level-num">{String(li() + 1).padStart(2, "0")}</span>
                  <div class="sdx-level-names">
                    <span class="sdx-level-name">{lv.name}</span>
                    <span class="sdx-level-tag">{lv.tag}</span>
                  </div>
                  <span class="sdx-level-count">{lv.lessons.filter((l) => isDone(l.id)).length} / {lv.lessons.length}</span>
                </div>
                <div class="sdx-cards">
                  <For each={lv.lessons}>
                    {(l, i) => (
                      <button class="sdx-card" classList={{ done: isDone(l.id) }} onClick={() => openLesson(l)}>
                        <div class="sdx-card-top">
                          <span class="sdx-card-num">{String(i() + 1).padStart(2, "0")}</span>
                          <span class="sdx-card-check">{isDone(l.id) ? "✓" : ""}</span>
                        </div>
                        <div class="sdx-card-title">{l.title}</div>
                        <div class="sdx-card-sub">{l.sub}</div>
                        <div class="sdx-card-meta">
                          <span>{l.mins} min</span>
                          <span>·</span>
                          <span>{l.steps.filter((s) => s.kind === "quiz").length} quiz</span>
                          <Show when={RESOURCES[l.id]?.length}><span>·</span><span>📚 {RESOURCES[l.id].length}</span></Show>
                        </div>
                      </button>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
          <div class="sdx-foot">Everything runs on this device — progress saved locally. Material links to its original free source, always credited.</div>
        </div>
      </Show>

      {/* ——— LIBRARY ——— */}
      <Show when={view().t === "library"}>
        <div class="sdx-lessonview">
          <div class="sdx-lv-top">
            <button class="ps-act" onClick={() => { sfx.back?.(); setView({ t: "home" }); }}><span class="btn-o" /> back</button>
            <div class="sdx-lv-title">📚 The Library — the internet's best free material</div>
          </div>
          <div class="sdx-lv-scroll">
            <div class="sdx-step sdx-library">
              <p class="sdx-step-body">Hand-picked and organized — courses, channels, interactive playgrounds, full free books, and the engineering blogs where real systems are explained by the people who built them. ⭐ marks the best starting point in each shelf.</p>
              <For each={LIBRARY}>
                {(g) => (
                  <div class="sdx-shelf">
                    <h3 class="sdx-shelf-name">{g.group}</h3>
                    <p class="sdx-shelf-blurb">{g.blurb}</p>
                    <div class="sdx-res-list"><For each={g.items}>{(r) => <ResourceRow r={r} />}</For></div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>

      {/* ——— LESSON ——— */}
      <Show when={view().t === "lesson"}>
        {(_) => {
          const v = () => view() as { t: "lesson"; lesson: Lesson; step: number };
          const st = () => v().lesson.steps[v().step] as any;
          const hue = () => hueOf(v().lesson.id);
          const img = () => st().img ?? IMAGES[v().lesson.id]?.[st().title];
          return (
            <div class="sdx-lessonview" style={{ "--lv": hue() }}>
              <div class="sdx-lv-top">
                <button class="ps-act" onClick={() => { sfx.back?.(); setView({ t: "home" }); }}><span class="btn-o" /> path</button>
                <div class="sdx-lv-title">{v().lesson.title}</div>
                <div class="sdx-dots">
                  <For each={v().lesson.steps}>{(_, i) => <span class="sdx-dot" classList={{ on: i() <= v().step }} />}</For>
                </div>
              </div>

              <div class="sdx-lv-scroll">
                <Show when={st().kind === "learn"}>
                  <div class="sdx-step">
                    <h2 class="sdx-step-title">{st().title}</h2>
                    <p class="sdx-step-body">{st().body}</p>
                    <Show when={st().diagram}><FlowDiagram d={st().diagram} /></Show>
                    <Show when={img()}>
                      <figure class="sdx-fig">
                        <img src={img().src} alt={img().alt} loading="lazy" />
                        <figcaption>
                          <Show when={img().href} fallback={img().credit}>
                            <a href={img().href} target="_blank" rel="noopener">{img().credit} ↗</a>
                          </Show>
                        </figcaption>
                      </figure>
                    </Show>
                  </div>
                </Show>
                <Show when={st().kind === "quiz"}>
                  <div class="sdx-step">
                    <div class="sdx-quiz-tag">QUICK CHECK</div>
                    <h2 class="sdx-step-title">{st().q}</h2>
                    <div class="sdx-options">
                      <For each={st().options as string[]}>
                        {(opt, i) => (
                          <button
                            class="sdx-option"
                            classList={{
                              correct: picked() !== null && i() === st().answer,
                              wrong: picked() === i() && i() !== st().answer,
                              dim: picked() !== null && picked() !== i() && i() !== st().answer,
                            }}
                            disabled={picked() !== null}
                            onClick={() => { setPicked(i()); i() === st().answer ? sfx.confirm?.() : sfx.deny?.(); }}
                          >
                            <span class="sdx-opt-key">{String.fromCharCode(65 + i())}</span>{opt}
                          </button>
                        )}
                      </For>
                    </div>
                    <Show when={picked() !== null}>
                      <div class="sdx-why" classList={{ good: picked() === st().answer }}>
                        <b>{picked() === st().answer ? "Correct." : `Not quite — it's ${String.fromCharCode(65 + st().answer)}.`}</b> {st().why}
                      </div>
                    </Show>
                  </div>
                </Show>
              </div>

              <div class="sdx-lv-foot">
                <button class="sdx-ghost" onClick={() => openTutor(`In the lesson “${v().lesson.title}”: explain more about ${st().title ?? v().lesson.title}`)}>🤖 ask about this</button>
                <button class="sdx-next" disabled={!canContinue()} onClick={() => goStep(1)}>
                  {v().step === v().lesson.steps.length - 1 ? "Finish lesson ✓" : "Continue →"}
                </button>
              </div>
            </div>
          );
        }}
      </Show>

      {/* ——— LESSON COMPLETE + GO DEEPER ——— */}
      <Show when={view().t === "finished"}>
        {(_) => {
          const l = () => (view() as { t: "finished"; lesson: Lesson }).lesson;
          const nxt = () => lessonAfter(l().id);
          const res = () => RESOURCES[l().id] ?? [];
          return (
            <div class="sdx-lessonview" style={{ "--lv": hueOf(l().id) }}>
              <div class="sdx-lv-scroll">
                <div class="sdx-step sdx-donestep">
                  <div class="sdx-done-badge">✓</div>
                  <h2 class="sdx-done-title">Lesson complete</h2>
                  <div class="sdx-done-name">{l().title} · {doneCount()}/{ALL_LESSONS.length} · you're {/^[AEIOU]/.test(rank()) ? "an" : "a"} <b>{rank()}</b></div>
                  <div class="sdx-done-acts">
                    <Show when={nxt()} fallback={<button class="sdx-next" onClick={() => setView({ t: "home" })}>🏆 Course complete — back to path</button>}>
                      <button class="sdx-next" onClick={() => openLesson(nxt()!)}>Next: {nxt()!.title} →</button>
                    </Show>
                    <button class="sdx-ghost" onClick={() => { sfx.back?.(); setView({ t: "home" }); }}>Back to path</button>
                  </div>
                  <Show when={res().length}>
                    <div class="sdx-shelf sdx-godeeper">
                      <h3 class="sdx-shelf-name">Go deeper — the best free material on this</h3>
                      <div class="sdx-res-list"><For each={res()}>{(r) => <ResourceRow r={r} />}</For></div>
                    </div>
                  </Show>
                </div>
              </div>
            </div>
          );
        }}
      </Show>

      <Show when={tutorOpen()}>
        <SysTutor seed={tutorSeed()} onClose={() => { setTutorOpen(false); setTutorSeed(undefined); }} />
      </Show>
    </div>
  );
}
