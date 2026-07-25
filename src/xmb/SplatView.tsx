// Walk into a photo.
//
// Gaussian splatting is what phone capture apps (Scaniverse, Polycam, KIRI)
// export now, and Spark renders it on the GPU fast enough to fly a camera
// through. So the console treats a .ply / .splat / .spz / .ksplat the way it
// treats a JPEG — as something you dropped in and want to look at — except this
// one you can move around inside.
//
// Lives inside Photos rather than as its own app: it's the same gesture (your
// own file, your own capture, nothing uploaded) and Photos already owns that.
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import * as THREE from "three";
import { addTableLights, makeControls } from "./tabletop";
import { Icon } from "./icons";
import * as sfx from "../audio";

/** File extensions Spark can read. */
export const SPLAT_EXT = /\.(ply|splat|spz|ksplat)$/i;
export const isSplatFile = (name: string) => SPLAT_EXT.test(name);

export default function SplatView(props: { file: File; onClose: () => void }) {
  const [status, setStatus] = createSignal("Reading capture…");
  const [err, setErr] = createSignal("");
  const [info, setInfo] = createSignal("");
  let wrap!: HTMLDivElement;

  onMount(() => {
    let disposed = false;
    let raf = 0;
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    wrap.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 800);
    camera.position.set(0, 0, 2.2);
    // same orbit feel as the 3D board games, so the console has one 3D idiom
    const controls = makeControls(camera, renderer.domElement, { min: 0.2, max: 60 });
    addTableLights(scene, false, 6);

    const fit = () => {
      const r = wrap.getBoundingClientRect();
      const w = Math.max(1, r.width), h = Math.max(1, r.height);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    fit();

    (async () => {
      try {
        const bytes = new Uint8Array(await props.file.arrayBuffer());
        if (disposed) return;
        setStatus("Building the point cloud…");
        const { SparkRenderer, SplatMesh } = await import("@sparkjsdev/spark");
        if (disposed) return;

        // Spark needs its own renderer object in the scene; it does the sorting
        // and splat rasterisation, Three just drives the camera.
        scene.add(new SparkRenderer({ renderer }));

        const mesh = new SplatMesh({ fileBytes: bytes });
        await mesh.initialized;
        if (disposed) { mesh.dispose?.(); return }
        // captures come out of phone apps upside down relative to Three's Y-up
        mesh.rotation.x = Math.PI;
        scene.add(mesh);

        // Frame the capture: splat clouds have no reliable bounds, so use the
        // mesh's own box when it has one and fall back to a sane distance.
        const box = new THREE.Box3().setFromObject(mesh);
        if (box.isEmpty() === false && Number.isFinite(box.min.x)) {
          const size = box.getSize(new THREE.Vector3()).length();
          const mid = box.getCenter(new THREE.Vector3());
          controls.target.copy(mid);
          camera.position.copy(mid).add(new THREE.Vector3(0, 0, Math.max(0.8, size * 0.7)));
          controls.update();
        }
        const n = (mesh as unknown as { numSplats?: number }).numSplats;
        setInfo(n ? `${n.toLocaleString()} splats` : "");
        setStatus("");
        sfx.confirm?.();
      } catch (e) {
        setErr(
          `Couldn't read that capture. Spark reads .ply, .splat, .spz and .ksplat Gaussian splats — ` +
          `a plain mesh .ply won't work. (${String((e as Error)?.message ?? e).slice(0, 90)})`,
        );
        setStatus("");
      }
    })();

    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);

    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") props.onClose() };
    addEventListener("keydown", esc);

    onCleanup(() => {
      disposed = true;
      cancelAnimationFrame(raf);
      removeEventListener("keydown", esc);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
    });
  });

  return (
    <div class="splat-root">
      <div class="splat-head">
        <div class="panel-tag">3D CAPTURE</div>
        <span class="splat-name">{props.file.name}</span>
        <Show when={info()}><span class="splat-info">{info()}</span></Show>
        <button class="ps-act" onClick={() => { sfx.back?.(); props.onClose() }}><span class="btn-o" /> back</button>
      </div>
      <div class="splat-stage" ref={wrap} />
      <Show when={status()}>
        <div class="splat-note"><div class="bg-spinner" />{status()}</div>
      </Show>
      <Show when={err()}>
        <div class="splat-note splat-err"><Icon name="info" />{err()}</div>
      </Show>
      <Show when={!status() && !err()}>
        <div class="ps-legend"><span>drag to look · scroll to move in · <span class="btn-o" /> back</span></div>
      </Show>
    </div>
  );
}
