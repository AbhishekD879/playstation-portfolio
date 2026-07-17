// CRT Console — the ENTIRE console rendered onto a curved phosphor tube.
// Uses Chrome's experimental HTML-in-Canvas API (origin trial, ~148-150):
// the app root is laid out INSIDE a <canvas layoutsubtree> (staying fully
// interactive & accessible), and every frame its rendering is uploaded as a
// WebGL texture (texElementImage2D) and drawn through a CRT shader — barrel
// curvature, scanlines, RGB phosphor triads, chromatic aberration, vignette.
// Labs flag "crt" (opt-in, shown only when the API exists). Anything goes
// wrong at any point → bail() puts the DOM back and the console renders
// normally.
import { hasHtmlInCanvas } from "./gpu";

const VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uTime;

vec2 curve(vec2 uv) {
  uv = uv * 2.0 - 1.0;
  vec2 off = abs(uv.yx) / vec2(5.2, 4.4); // gentle barrel — clicks stay aligned
  uv = uv + uv * off * off;
  return uv * 0.5 + 0.5;
}

void main() {
  vec2 uv = curve(vUv);
  // outside the tube: dark bezel with a soft edge
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { outColor = vec4(0.01, 0.01, 0.015, 1.0); return; }
  vec2 suv = vec2(uv.x, 1.0 - uv.y); // element textures are top-left origin

  // chromatic aberration on the tube edges
  float ab = 0.0009 * smoothstep(0.2, 0.5, distance(uv, vec2(0.5)));
  vec3 col;
  col.r = texture(uTex, suv + vec2(ab, 0.0)).r;
  col.g = texture(uTex, suv).g;
  col.b = texture(uTex, suv - vec2(ab, 0.0)).b;

  // scanlines + RGB phosphor triad
  float scan = 0.88 + 0.12 * sin(uv.y * uRes.y * 3.14159);
  int px = int(mod(gl_FragCoord.x, 3.0));
  vec3 mask = px == 0 ? vec3(1.06, 0.96, 0.96) : px == 1 ? vec3(0.96, 1.06, 0.96) : vec3(0.96, 0.96, 1.06);
  col *= scan * mask;

  // vignette + a whisper of flicker
  float vig = 1.0 - 0.28 * pow(distance(uv, vec2(0.5)) * 1.3, 2.4);
  col *= vig * (0.99 + 0.01 * sin(uTime * 190.0));

  outColor = vec4(col, 1.0);
}`;

/** Move the app root inside the tube and start compositing. No-op without the API. */
export function startCrt(root: HTMLElement) {
  if (!hasHtmlInCanvas()) return;
  const home = root.parentElement;
  const canvas = document.createElement("canvas");
  canvas.id = "crt-screen";
  canvas.setAttribute("layoutsubtree", "");
  let dead = false;
  const bail = () => {
    dead = true;
    try { home?.appendChild(root); canvas.remove(); } catch { /* already gone */ }
  };
  try {
    document.body.appendChild(canvas);
    canvas.appendChild(root); // the console now lives inside the tube — still interactive
    const gl = canvas.getContext("webgl2");
    if (!gl || typeof (gl as any).texElementImage2D !== "function") return bail();

    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return bail();
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const uRes = gl.getUniformLocation(prog, "uRes");
    const uTime = gl.getUniformLocation(prog, "uTime");

    const loop = (now: number) => {
      if (dead) return;
      requestAnimationFrame(loop);
      const dpr = Math.min(devicePixelRatio, 2);
      const w = Math.floor(innerWidth * dpr), h = Math.floor(innerHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
      try {
        (gl as any).texElementImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, root);
      } catch { return bail(); } // API changed shape under us — restore the console
      gl.uniform2f(uRes, innerWidth, innerHeight);
      gl.uniform1f(uTime, now / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    requestAnimationFrame(loop);
  } catch { bail(); }
}
