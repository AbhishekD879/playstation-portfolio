// Repo Rewind — this console's own git history as a living 3D construction
// site. Every commit grows a galaxy-shaped file tree: directories are the
// hubs, files are glowing instanced orbs colored by extension, and each
// commit fires comets from the core to the files it touched. three.js on the
// WebGPU renderer (WebGL2 backend when WebGPU is missing — one code path),
// GSAP for the camera choreography and comet flights, OrbitControls for free
// exploration, raycast hover/click for inspection, and a TSL star-dust field
// as ambience on WebGPU. Data baked by scripts/gitlog.mjs.
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import gsap from "gsap";
import * as sfx from "../audio";
import type { NavAction } from "../input";
import { tint } from "../theme";
import COMMITS from "../data/commits.json";

type Commit = { h: string; d: number; s: string; f: [string, number, number][] };
const LOG = COMMITS as unknown as Commit[];

const EXT_COLOR: Record<string, number> = {
  ts: 0x7fc4ff, tsx: 0x7fc4ff, js: 0xffd97f, mjs: 0xffd97f,
  css: 0xb48cff, json: 0xffb37f, md: 0x9aa7b8, html: 0xff8ca8,
  svg: 0x8affc4, png: 0x8affc4, wasm: 0xff9d6f,
};

interface VNode {
  path: string; name: string; depth: number; isFile: boolean;
  parent: VNode | null; children: Map<string, VNode>;
  leaves: number; touches: number; heat: number;
  pos: { x: number; y: number; z: number };     // eased, drawn
  target: { x: number; y: number; z: number };  // layout goal
  idx: number; // instance slot
}

const hash01 = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000;
};

export default function RepoRewind(props: { onClose: () => void; bind: (nav: (a: NavAction) => void) => void }) {
  const [idx, setIdx] = createSignal(0);
  const [playing, setPlaying] = createSignal(true);
  const [stats, setStats] = createSignal({ files: 0, dirs: 0 });
  const [tip, setTip] = createSignal<{ x: number; y: number; path: string; info: string } | null>(null);
  let host!: HTMLDivElement;

  // —— the tree (rebuilt for backwards scrubs, appended for forward steps) ——
  let root!: VNode;
  const byPath = new Map<string, VNode>();
  let fileCount = 0, dirCount = 0;
  const mkNode = (path: string, name: string, depth: number, isFile: boolean, parent: VNode | null): VNode => ({
    path, name, depth, isFile, parent, children: new Map(),
    leaves: 1, touches: 0, heat: 0,
    pos: parent ? { ...parent.pos } : { x: 0, y: 0, z: 0 }, // born at the parent, eases outward
    target: { x: 0, y: 0, z: 0 }, idx: -1,
  });
  const resetTree = () => {
    root = mkNode("", "", 0, false, null);
    byPath.clear();
    fileCount = 0; dirCount = 0;
    needAlloc = true;
  };
  const touch = (path: string): VNode => {
    let n = root, acc = "";
    const parts = path.split("/");
    parts.forEach((part, i) => {
      acc = acc ? `${acc}/${part}` : part;
      let c = n.children.get(part);
      if (!c) {
        c = mkNode(acc, part, i + 1, i === parts.length - 1, n);
        n.children.set(part, c);
        byPath.set(acc, c);
        if (c.isFile) fileCount++; else dirCount++;
        needAlloc = true;
      }
      n = c;
    });
    n.touches++;
    return n;
  };

  // —— 3D radial layout: leaves share the circle, depth is the radius,
  //    a per-path hash gives the galaxy its vertical thickness ——
  let maxDepth = 1;
  const layout = () => {
    maxDepth = 1;
    const count = (n: VNode): number => {
      maxDepth = Math.max(maxDepth, n.depth);
      if (n.isFile || n.children.size === 0) return (n.leaves = 1);
      let s = 0;
      for (const c of n.children.values()) s += count(c);
      return (n.leaves = s);
    };
    count(root);
    const R_STEP = 9;
    let cursor = 0;
    const place = (n: VNode) => {
      if (n.isFile || n.children.size === 0) {
        const a = ((cursor + n.leaves / 2) / Math.max(1, root.leaves)) * Math.PI * 2;
        cursor += n.leaves;
        const r = n.depth * R_STEP;
        n.target = { x: Math.cos(a) * r, y: (hash01(n.path) - 0.5) * (4 + n.depth * 2.4), z: Math.sin(a) * r };
        return a;
      }
      const angles: number[] = [];
      for (const c of n.children.values()) angles.push(place(c));
      const a = angles.reduce((s, x) => s + x, 0) / angles.length;
      const r = n.depth * R_STEP;
      n.target = { x: Math.cos(a) * r, y: (hash01(n.path) - 0.5) * (3 + n.depth * 1.6), z: Math.sin(a) * r };
      return a;
    };
    place(root);
    setStats({ files: fileCount, dirs: dirCount });
  };

  let needAlloc = true;
  let onCommitPlayed: ((files: VNode[]) => void) | null = null; // wired by the scene
  const applyCommit = (k: number) => { // 1-based commit index
    const touched: VNode[] = [];
    for (const [p] of LOG[k - 1].f) { const n = touch(p); n.heat = 1; touched.push(n); }
    layout();
    onCommitPlayed?.(touched);
  };
  const buildTo = (k: number) => {
    resetTree();
    for (let i = 1; i < k; i++) for (const [p] of LOG[i - 1].f) touch(p);
    if (k > 0) applyCommit(k);
    else layout();
  };
  const step = (d: number) => {
    const next = Math.max(0, Math.min(LOG.length, idx() + d));
    if (next === idx()) return;
    if (d === 1) applyCommit(next);
    else buildTo(next);
    setIdx(next);
  };

  onMount(() => {
    let disposed = false;
    let teardown: (() => void) | null = null;

    void (async () => {
      // one renderer, two backends: WebGPU where it exists, WebGL2 otherwise
      const [T, TSL, { OrbitControls }] = await Promise.all([
        import("three/webgpu"),
        import("three/tsl"),
        import("three/examples/jsm/controls/OrbitControls.js"),
      ]);
      if (disposed) return;

      const wantGpu = !!(navigator as any).gpu;
      const renderer = new (T as any).WebGPURenderer({ antialias: true, forceWebGL: !wantGpu });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(host.clientWidth, host.clientHeight);
      await renderer.init();
      if (disposed) { renderer.dispose(); return; }
      host.appendChild(renderer.domElement);

      const scene = new (T as any).Scene();
      scene.fog = new (T as any).FogExp2(0x05060c, 0.010);
      const camera = new (T as any).PerspectiveCamera(55, host.clientWidth / host.clientHeight, 0.1, 800);
      camera.position.set(0, 150, 0.01); // top-down, far — GSAP flies us in

      const accent = new (T as any).Color(tint());
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

      // —— controls: drag to orbit, wheel to zoom, slow auto-drift ——
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.06;
      controls.autoRotate = !reduced;
      controls.autoRotateSpeed = 0.55;
      controls.minDistance = 18;
      controls.maxDistance = 320;
      controls.maxPolarAngle = 1.32; // stay above the disc — the UI lives below

      // cinematic fly-in
      gsap.to(camera.position, { x: 0, y: 52, z: 96, duration: reduced ? 0 : 2.6, ease: "power3.inOut" });

      // —— instanced node models: orbs for files, octahedra for directories ——
      const CAP = 4096;
      const fileMesh = new (T as any).InstancedMesh(
        new (T as any).SphereGeometry(0.85, 12, 10),
        new (T as any).MeshBasicMaterial({ transparent: true, opacity: 0.95 }),
        CAP,
      );
      const dirMesh = new (T as any).InstancedMesh(
        new (T as any).OctahedronGeometry(1.15),
        new (T as any).MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, wireframe: true }),
        1024,
      );
      fileMesh.frustumCulled = dirMesh.frustumCulled = false;
      scene.add(fileMesh, dirMesh);

      // links: one line segment per child→parent
      const linkGeo = new (T as any).BufferGeometry();
      const linkPos = new Float32Array(CAP * 6);
      linkGeo.setAttribute("position", new (T as any).BufferAttribute(linkPos, 3));
      const links = new (T as any).LineSegments(
        linkGeo,
        new (T as any).LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12 }),
      );
      links.frustumCulled = false;
      scene.add(links);

      // the core: the repo's heart, breathing in the accent color
      const core = new (T as any).Mesh(
        new (T as any).IcosahedronGeometry(2.4, 1),
        new (T as any).MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.85, wireframe: true }),
      );
      scene.add(core);

      // —— commit comets: a sprite pool GSAP flies from the core to each file ——
      const cometTex = (() => {
        const S = 64, c = document.createElement("canvas");
        c.width = c.height = S;
        const x = c.getContext("2d")!;
        const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
        g.addColorStop(0, "rgba(255,255,255,1)");
        g.addColorStop(0.4, "rgba(255,255,255,0.5)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        x.fillStyle = g;
        x.fillRect(0, 0, S, S);
        return new (T as any).CanvasTexture(c);
      })();
      const comets: any[] = Array.from({ length: 28 }, () => {
        const s = new (T as any).Sprite(new (T as any).SpriteMaterial({
          map: cometTex, color: accent, transparent: true, opacity: 0,
          blending: (T as any).AdditiveBlending, depthWrite: false,
        }));
        s.scale.set(2.6, 2.6, 1);
        scene.add(s);
        return s;
      });
      let cometHead = 0;
      onCommitPlayed = (files) => {
        if (reduced) return;
        for (const n of files.slice(0, 10)) {
          const s = comets[cometHead++ % comets.length];
          gsap.killTweensOf(s.position);
          gsap.killTweensOf(s.material);
          s.position.set(0, 0, 0);
          s.material.opacity = 0.9;
          gsap.to(s.position, { x: n.target.x, y: n.target.y, z: n.target.z, duration: 0.45, ease: "power2.out" });
          gsap.to(s.material, { opacity: 0, duration: 0.55, ease: "power1.in", delay: 0.15 });
        }
        // the core kicks on every commit
        gsap.fromTo(core.scale, { x: 1.5, y: 1.5, z: 1.5 }, { x: 1, y: 1, z: 1, duration: 0.5, ease: "elastic.out(1, 0.45)" });
      };

      // —— WebGPU flourish: a TSL star-dust shell twinkling around the site ——
      let dustTick: (() => void) | null = null;
      if ((renderer.backend?.isWebGPUBackend ?? false) === true) {
        try {
          const { hash, instanceIndex, uniform, uint, uv, vec2, vec3, vec4 } = TSL as any;
          const uT = uniform(0);
          const h1 = hash(instanceIndex), h2 = hash(instanceIndex.add(uint(7919)));
          const h3 = hash(instanceIndex.add(uint(104729)));
          const theta = h1.mul(6.28318), phi = h2.mul(3.14159);
          const r = h3.mul(140).add(120);
          const mat = new (T as any).SpriteNodeMaterial({ transparent: true, blending: (T as any).AdditiveBlending, depthWrite: false });
          mat.positionNode = vec3(
            theta.cos().mul(phi.sin()).mul(r),
            phi.cos().mul(r).mul(0.55),
            theta.sin().mul(phi.sin()).mul(r),
          );
          mat.scaleNode = h2.mul(0.7).add(0.25).mul(uT.mul(1.6).add(h1.mul(6.28)).sin().mul(0.3).add(1));
          const d = uv().sub(vec2(0.5, 0.5)).length();
          const glow = d.mul(2).oneMinus().clamp(0, 1);
          mat.colorNode = vec4(vec3(0.75, 0.85, 1.0), glow.mul(glow).mul(0.35));
          const dust = new (T as any).Sprite(mat);
          dust.count = 6000;
          dust.frustumCulled = false;
          scene.add(dust);
          const tick = () => { uT.value = performance.now() / 1000; };
          dustTick = tick;
        } catch { /* dust is optional */ }
      }

      // —— hover / click inspection ——
      const ray = new (T as any).Raycaster();
      const ndc = new (T as any).Vector2();
      const fileSlots: VNode[] = [];
      const dirSlots: VNode[] = [];
      const pick = (ev: PointerEvent): VNode | null => {
        const r = renderer.domElement.getBoundingClientRect();
        ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        const hits = ray.intersectObjects([fileMesh, dirMesh]);
        const h = hits[0];
        if (!h || h.instanceId === undefined) return null;
        return (h.object === fileMesh ? fileSlots : dirSlots)[h.instanceId] ?? null;
      };
      const onMove = (ev: PointerEvent) => {
        const n = pick(ev);
        setTip(n ? {
          x: ev.clientX, y: ev.clientY, path: n.path,
          info: n.isFile ? `touched by ${n.touches} commit${n.touches === 1 ? "" : "s"}` : `${n.children.size} entries inside`,
        } : null);
      };
      const onClick = (ev: PointerEvent) => {
        const n = pick(ev);
        if (!n) return;
        sfx.tickH();
        // GSAP swings the orbit target over — click a node to visit it
        gsap.to(controls.target, { x: n.target.x, y: n.target.y, z: n.target.z, duration: 0.9, ease: "power3.inOut" });
      };
      renderer.domElement.addEventListener("pointermove", onMove);
      renderer.domElement.addEventListener("pointerdown", onClick);

      // —— per-frame: ease nodes to targets, write instances, drive playback ——
      const M = new (T as any).Matrix4();
      const Q = new (T as any).Quaternion();
      const S3 = new (T as any).Vector3();
      const P3 = new (T as any).Vector3();
      const C = new (T as any).Color();
      let lastStep = 0;
      renderer.setAnimationLoop((now: number) => {
        if (playing() && idx() < LOG.length && now - lastStep > 520) { lastStep = now; step(1); }
        controls.update();
        dustTick?.();
        core.rotation.y = now / 4000;
        core.rotation.x = now / 9000;

        let fi = 0, di = 0, li = 0;
        const walk = (n: VNode) => {
          if (n.depth > 0) {
            n.pos.x += (n.target.x - n.pos.x) * 0.10;
            n.pos.y += (n.target.y - n.pos.y) * 0.10;
            n.pos.z += (n.target.z - n.pos.z) * 0.10;
            const parent = n.parent!;
            // link to the parent (the core when depth 1)
            linkPos[li * 6] = parent.depth ? parent.pos.x : 0;
            linkPos[li * 6 + 1] = parent.depth ? parent.pos.y : 0;
            linkPos[li * 6 + 2] = parent.depth ? parent.pos.z : 0;
            linkPos[li * 6 + 3] = n.pos.x; linkPos[li * 6 + 4] = n.pos.y; linkPos[li * 6 + 5] = n.pos.z;
            li++;
            P3.set(n.pos.x, n.pos.y, n.pos.z);
            const scale = (n.isFile ? 0.8 + Math.min(0.9, n.touches * 0.08) : 1) * (1 + n.heat * 1.7);
            S3.set(scale, scale, scale);
            M.compose(P3, Q, S3);
            if (n.isFile && fi < CAP) {
              fileMesh.setMatrixAt(fi, M);
              const ext = n.name.split(".").pop() ?? "";
              C.set(EXT_COLOR[ext] ?? 0xdfe8f0).lerp(accent, n.heat);
              fileMesh.setColorAt(fi, C);
              fileSlots[fi] = n;
              fi++;
            } else if (!n.isFile && di < 1024) {
              dirMesh.setMatrixAt(di, M);
              dirSlots[di] = n;
              di++;
            }
            n.heat *= 0.955;
          }
          for (const c of n.children.values()) walk(c);
        };
        walk(root);
        fileMesh.count = fi;
        dirMesh.count = di;
        fileMesh.instanceMatrix.needsUpdate = true;
        if (fileMesh.instanceColor) fileMesh.instanceColor.needsUpdate = true;
        dirMesh.instanceMatrix.needsUpdate = true;
        linkGeo.setDrawRange(0, li * 2);
        (linkGeo.attributes.position as any).needsUpdate = true;

        renderer.render(scene, camera);
      });

      const onResize = () => {
        camera.aspect = host.clientWidth / host.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(host.clientWidth, host.clientHeight);
      };
      addEventListener("resize", onResize);

      teardown = () => {
        renderer.setAnimationLoop(null);
        removeEventListener("resize", onResize);
        renderer.domElement.removeEventListener("pointermove", onMove);
        renderer.domElement.removeEventListener("pointerdown", onClick);
        controls.dispose();
        cometTex.dispose();
        renderer.dispose();
      };
      if (disposed) teardown();
    })();

    buildTo(1);
    setIdx(1);
    onCleanup(() => { disposed = true; teardown?.(); });
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
      <div class="rewind-host" ref={host} />
      <Show when={tip()}>
        <div class="rewind-tip" style={{ left: `${Math.min(innerWidth - 260, tip()!.x + 14)}px`, top: `${tip()!.y + 14}px` }}>
          <div class="rewind-tip-path">{tip()!.path}</div>
          <div class="rewind-tip-info">{tip()!.info}</div>
        </div>
      </Show>
      <div class="rewind-ticker">
        <div class="rewind-bar"><div class="rewind-bar-fill" style={{ width: `${(idx() / LOG.length) * 100}%` }} /></div>
        <div class="rewind-meta">
          <span class="rewind-hash">#{idx()} / {LOG.length} · {cur().h} · {when()} · {stats().files} files</span>
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
      <div class="panel-hint guide-hint">drag to orbit · wheel to zoom · hover & click the nodes · <span class="btn-x" /> play/pause · ←→ step · <span class="btn-o" /> back</div>
    </div>
  );
}
