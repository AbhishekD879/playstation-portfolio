// A photo that becomes subtly three-dimensional: the base <img> renders
// instantly; meanwhile Depth Anything runs on-device (src/depth.ts) and, once
// the depth map lands, a WebGL parallax layer fades in over it — the picture
// tilts with the pointer (and drifts gently on its own). Labs flag "livephoto".
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { depthMap, depthModelProgress, depthModelReady } from "../depth";
import { labEnabled } from "../labs";

const VERT = `attribute vec2 aPos; varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
const FRAG = `precision mediump float;
varying vec2 vUv;
uniform sampler2D uImg, uDepth;
uniform vec2 uFit;   // fraction of the canvas the contain-fit image occupies
uniform vec2 uOff;   // parallax offset, ±1
void main() {
  vec2 uv = (vUv - 0.5) / uFit + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0); return; }
  uv = (uv - 0.5) * 0.96 + 0.5;              // slight zoom hides edge reveal
  float d = texture2D(uDepth, vec2(uv.x, 1.0 - uv.y)).r;
  vec2 par = uOff * (d - 0.5) * 0.022;
  vec3 c = texture2D(uImg, vec2(uv.x + par.x, 1.0 - (uv.y + par.y))).rgb;
  gl_FragColor = vec4(c, 1.0);
}`;

export default function DepthPhoto(props: { src: string; alt?: string; class?: string }) {
  const [live, setLive] = createSignal(false);
  const [prep, setPrep] = createSignal(false); // pixels are CORS-clean, depth is cooking
  let canvas!: HTMLCanvasElement;
  let img!: HTMLImageElement;

  onMount(() => {
    if (!labEnabled("livephoto")) return;
    let disposed = false;
    let raf = 0;
    let blobUrl = "";
    const src = props.src; // one photo per component instance (keyed by caller)

    // 3D needs CORS-clean pixels (WebGL textures + the depth model both read
    // them). Probe with a real fetch; hosts that refuse (the Met, NASA) simply
    // stay beautiful 2D photos. blob:/same-origin always pass.
    (async () => {
      const r = await fetch(src, { mode: "cors" });
      if (!r.ok) throw new Error("http " + r.status);
      blobUrl = URL.createObjectURL(await r.blob());
      setPrep(true); // pixels are ours — show the "preparing 3D" state
      const [depth] = await Promise.all([
        depthMap(blobUrl),
        new Promise<void>((res, rej) => {
          if (img.complete && img.naturalWidth) return res();
          img.onload = () => res(); img.onerror = () => rej(new Error("img"));
        }),
      ]);
      return depth;
    })().then(async (depth) => {
      if (!depth || disposed) return;
      // a CORS-clean copy for the texture — the visible <img> may be tainted
      const texImg = new Image();
      texImg.src = blobUrl;
      await texImg.decode().catch(() => {});
      if (disposed || !texImg.naturalWidth) return;
      const gl = canvas.getContext("webgl", { premultipliedAlpha: true });
      if (!gl) return;
      const sh = (type: number, code: string) => {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, code); gl.compileShader(s);
        return s;
      };
      const prog = gl.createProgram()!;
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "aPos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      const tex = (unit: number, source: TexImageSource) => {
        const t = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return t;
      };
      tex(0, texImg);
      tex(1, depth);
      gl.uniform1i(gl.getUniformLocation(prog, "uImg"), 0);
      gl.uniform1i(gl.getUniformLocation(prog, "uDepth"), 1);
      const uFit = gl.getUniformLocation(prog, "uFit");
      const uOff = gl.getUniformLocation(prog, "uOff");

      // pointer → target tilt; idle → a slow figure-eight drift
      let tx = 0, ty = 0, ox = 0, oy = 0, lastMove = 0;
      const onMove = (e: PointerEvent) => {
        tx = (e.clientX / innerWidth) * 2 - 1;
        ty = (e.clientY / innerHeight) * 2 - 1;
        lastMove = performance.now();
      };
      addEventListener("pointermove", onMove);

      const draw = (now: number) => {
        if (disposed) return;
        raf = requestAnimationFrame(draw);
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
        if (now - lastMove > 2600) { // no pointer — breathe on its own
          tx = Math.sin(now * 0.00045) * 0.55;
          ty = Math.cos(now * 0.00032) * 0.4;
        }
        ox += (tx - ox) * 0.06; oy += (ty - oy) * 0.06;
        const ia = texImg.naturalWidth / texImg.naturalHeight, ca = w / h;
        gl.uniform2f(uFit, ia > ca ? 1 : ia / ca, ia > ca ? ca / ia : 1);
        gl.uniform2f(uOff, ox, oy);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      raf = requestAnimationFrame(draw);
      setPrep(false);
      setLive(true);
      onCleanup(() => removeEventListener("pointermove", onMove));
    }).catch(() => setPrep(false) /* no CORS, no model, no problem — stays a photo */)
      .finally(() => { if (!live()) setPrep(false); });

    onCleanup(() => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    });
  });

  return (
    <>
      <img ref={img} class={props.class} src={props.src} alt={props.alt ?? ""} style={{ opacity: live() ? 0 : 1 }} />
      <canvas ref={canvas} class="depth-canvas" classList={{ live: live() }} />
      <Show when={prep() && !live()}>
        <div class="depth-badge depth-working">
          ◈ {depthModelProgress() !== null
            ? `downloading 3D model · ${depthModelProgress()}%`
            : depthModelReady() ? "preparing 3D…" : "waking the 3D model…"}
        </div>
      </Show>
      <Show when={live()}><div class="depth-badge">◈ 3D</div></Show>
    </>
  );
}
