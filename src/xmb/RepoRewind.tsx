// Repo Rewind — this console's own git history, played back Gource-style.
// A radial file tree grows commit by commit on a 2D canvas: directories
// branch from the center, files light up in the accent color as commits
// touch them, and a ticker narrates hash · date · message. The data is baked
// at build time by scripts/gitlog.mjs — the console literally contains its
// own making-of.
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import * as sfx from "../audio";
import type { NavAction } from "../input";
import { tint } from "../theme";
import COMMITS from "../data/commits.json";

type Commit = { h: string; d: number; s: string; f: [string, number, number][] };
const LOG = COMMITS as unknown as Commit[];

interface Node {
  name: string; depth: number; isFile: boolean;
  parent: Node | null; children: Map<string, Node>;
  angle: number; r: number; heat: number; leaves: number;
}

const EXT_COLOR: Record<string, string> = {
  ts: "#7fc4ff", tsx: "#7fc4ff", js: "#ffd97f", mjs: "#ffd97f",
  css: "#b48cff", json: "#ffb37f", md: "#9aa7b8", html: "#ff8ca8",
};

export default function RepoRewind(props: { onClose: () => void; bind: (nav: (a: NavAction) => void) => void }) {
  const [idx, setIdx] = createSignal(0); // commits applied so far
  const [playing, setPlaying] = createSignal(true);
  let canvas!: HTMLCanvasElement;

  // —— cumulative file tree ——
  let root: Node = mkNode("", 0, false, null);
  function mkNode(name: string, depth: number, isFile: boolean, parent: Node | null): Node {
    return { name, depth, isFile, parent, children: new Map(), angle: 0, r: 0, heat: 0, leaves: 0 };
  }
  const touch = (path: string): Node => {
    const parts = path.split("/");
    let n = root;
    parts.forEach((part, i) => {
      let c = n.children.get(part);
      if (!c) { c = mkNode(part, i + 1, i === parts.length - 1, n); n.children.set(part, c); }
      n = c;
    });
    return n;
  };

  // rebuild the tree up to commit k (replay is cheap at this scale)
  const buildTo = (k: number) => {
    root = mkNode("", 0, false, null);
    for (let i = 0; i < k; i++) for (const [p] of LOG[i].f) touch(p);
    if (k > 0) for (const [p] of LOG[k - 1].f) touch(p).heat = 1;
    layout();
  };

  // —— radial layout: leaves share the circle, dirs sit at their children's mean ——
  let maxDepth = 1;
  const layout = () => {
    maxDepth = 1;
    const count = (n: Node): number => {
      maxDepth = Math.max(maxDepth, n.depth);
      if (n.isFile || n.children.size === 0) return (n.leaves = 1);
      let s = 0;
      for (const c of n.children.values()) s += count(c);
      return (n.leaves = s);
    };
    count(root);
    let cursor = 0;
    const place = (n: Node) => {
      if (n.isFile || n.children.size === 0) {
        n.angle = (cursor + n.leaves / 2) * ((Math.PI * 2) / Math.max(1, root.leaves));
        cursor += n.leaves;
        return;
      }
      const kids = [...n.children.values()];
      for (const c of kids) place(c);
      n.angle = kids.reduce((s, c) => s + c.angle, 0) / kids.length;
    };
    place(root);
  };

  const step = (d: number) => {
    const next = Math.max(0, Math.min(LOG.length, idx() + d));
    if (next === idx()) return;
    if (d === 1) { // fast path — just apply the next commit
      for (const [p] of LOG[next - 1].f) touch(p).heat = 1;
      layout();
    } else buildTo(next);
    setIdx(next);
  };

  onMount(() => {
    const ctx = canvas.getContext("2d")!;
    const fit = () => {
      canvas.width = innerWidth * devicePixelRatio;
      canvas.height = innerHeight * devicePixelRatio;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    };
    fit();
    addEventListener("resize", fit);
    buildTo(1);
    setIdx(1);

    let raf = 0;
    let lastStep = performance.now();
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (playing() && idx() < LOG.length && now - lastStep > 400) { lastStep = now; step(1); }
      const W = innerWidth, H = innerHeight;
      const cx = W / 2, cy = H / 2 - 14;
      const rMax = Math.min(W, H) / 2 - 90;
      const rStep = rMax / Math.max(3, maxDepth);
      ctx.clearRect(0, 0, W, H);
      const accent = tint();

      const pos = (n: Node): [number, number] => {
        const r = n.depth * rStep;
        return [cx + Math.cos(n.angle) * r, cy + Math.sin(n.angle) * r];
      };
      const walk = (n: Node) => {
        const [x, y] = pos(n);
        for (const c of n.children.values()) {
          const [x2, y2] = pos(c);
          ctx.strokeStyle = "rgba(255,255,255,0.10)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          walk(c);
        }
        if (n.depth === 0) return;
        if (n.heat > 0.01) {
          ctx.fillStyle = accent;
          ctx.globalAlpha = n.heat;
          ctx.beginPath();
          ctx.arc(x, y, 4 + n.heat * 7, 0, 7);
          ctx.fill();
          ctx.globalAlpha = 1;
          n.heat *= 0.96;
        }
        const ext = n.name.split(".").pop() ?? "";
        ctx.fillStyle = n.isFile ? (EXT_COLOR[ext] ?? "#dfe8f0") : "rgba(255,255,255,0.65)";
        ctx.beginPath();
        ctx.arc(x, y, n.isFile ? 2.4 : 3.4, 0, 7);
        ctx.fill();
      };
      walk(root);
    };
    raf = requestAnimationFrame(draw);
    onCleanup(() => { cancelAnimationFrame(raf); removeEventListener("resize", fit); });
  });

  props.bind((a) => {
    if (a === "confirm") { setPlaying(!playing()); sfx.tickV(); }
    if (a === "left") { setPlaying(false); step(-1); sfx.tickH(); }
    if (a === "right") { setPlaying(false); step(1); sfx.tickH(); }
    if (a === "back") { sfx.back(); props.onClose(); }
  });

  const cur = () => LOG[Math.max(0, idx() - 1)];
  const when = () => new Date(cur().d * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

  return (
    <div class="rewind">
      <div class="guide-head">
        <div class="panel-tag">REPO REWIND — HOW THIS CONSOLE WAS BUILT</div>
        <button class="ps-act" onClick={() => { sfx.back(); props.onClose(); }}><span class="btn-o" /> back</button>
      </div>
      <canvas ref={canvas} class="rewind-canvas" />
      <div class="rewind-ticker">
        <div class="rewind-bar"><div class="rewind-bar-fill" style={{ width: `${(idx() / LOG.length) * 100}%` }} /></div>
        <div class="rewind-meta">
          <span class="rewind-hash">#{idx()} / {LOG.length} · {cur().h} · {when()}</span>
          <span class="rewind-msg">{cur().s}</span>
        </div>
        <div class="rewind-controls">
          <button class="ghost-btn" onClick={() => { setPlaying(false); step(-1); }}>⏴ prev</button>
          <button class="ghost-btn" onClick={() => { setPlaying(!playing()); sfx.tickV(); }}>{playing() ? "❚❚ pause" : "▶ play"}</button>
          <button class="ghost-btn" onClick={() => { setPlaying(false); step(1); }}>next ⏵</button>
        </div>
      </div>
      <Show when={idx() >= LOG.length}>
        <div class="rewind-done">EVERY COMMIT PLAYED — THIS IS THE CONSOLE YOU'RE USING</div>
      </Show>
      <div class="panel-hint guide-hint"><span class="btn-x" /> play/pause · ←→ step · <span class="btn-o" /> back</div>
    </div>
  );
}
