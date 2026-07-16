// Dream — on-device image generation. Stable Diffusion 2.1 (ONNX) runs
// entirely on the visitor's GPU via diffusers.js + onnxruntime-web (WebGPU).
// No server, no key: the prompt and the pixels never leave the machine.
// Experimental & heavy — the model is a ~2 GB one-time download and a
// generation takes a while, so it's gated to desktop + WebGPU.
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { setNavEnabled } from "../input";
import * as sfx from "../audio";

const MODEL = "aislamov/stable-diffusion-2-1-base-onnx";

export default function Dream(props: { onClose: () => void }) {
  const isDesktop = matchMedia("(pointer: fine)").matches && innerWidth >= 900;
  const hasGPU = typeof (navigator as any).gpu !== "undefined";
  const [stage, setStage] = createSignal<"idle" | "loading" | "running" | "done" | "error">("idle");
  const [progress, setProgress] = createSignal("");
  const [err, setErr] = createSignal("");
  let pipe: any = null;
  let canvas!: HTMLCanvasElement;
  let promptInput!: HTMLInputElement;
  let disposed = false;

  onMount(() => {
    setNavEnabled(false);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { sfx.back(); props.onClose(); } };
    addEventListener("keydown", esc);
    onCleanup(() => { disposed = true; setNavEnabled(true); removeEventListener("keydown", esc); });
    setTimeout(() => promptInput?.focus(), 80);
  });

  async function dream() {
    const prompt = promptInput.value.trim();
    if (!prompt || stage() === "loading" || stage() === "running") return;
    sfx.confirm();
    setErr("");
    try {
      if (!pipe) {
        setStage("loading");
        const { DiffusionPipeline } = await import("@aislamov/diffusers.js");
        pipe = await DiffusionPipeline.fromPretrained(MODEL, {
          progressCallback: (p: any) => {
            if (disposed) return;
            if (p?.status === "Downloading") {
              const f = p.downloadStatus;
              if (f?.total) setProgress(`Downloading the model — ${Math.round((f.downloaded / f.total) * 100)}% (${p.file ?? ""})`);
              else setProgress("Downloading the model… (one-time, ~2 GB)");
            }
          },
        });
      }
      setStage("running");
      setProgress("Dreaming…");
      const images = await pipe.run({
        prompt,
        numInferenceSteps: 20,
        guidanceScale: 7.5,
        progressCallback: (p: any) => {
          if (disposed) return;
          if (p?.status === "EncodingPrompt") setProgress("Reading your prompt…");
          else if (p?.status === "RunningUnet") setProgress(`Painting… step ${p.step ?? "?"} / 20`);
          else if (p?.status === "RunningVae") setProgress("Developing the image…");
        },
      });
      if (disposed) return;
      const data = await images[0].toImageData({ tensorLayout: "NCWH", format: "RGB" });
      canvas.width = data.width; canvas.height = data.height;
      canvas.getContext("2d")!.putImageData(data, 0, 0);
      setStage("done");
      setProgress("");
      sfx.trophy();
    } catch (e) {
      if (disposed) return;
      setErr(String((e as Error)?.message ?? e).slice(0, 200));
      setStage("error");
    }
  }

  return (
    <div class="dream">
      <div class="dream-bar">
        <div class="panel-tag">DREAM — STABLE DIFFUSION · WEBGPU, ON-DEVICE</div>
        <button class="ghost-btn" onClick={() => { sfx.back(); props.onClose(); }}>✕ close</button>
      </div>

      <Show
        when={isDesktop && hasGPU}
        fallback={
          <div class="dream-gate">
            <div class="ai-gate-big">{hasGPU ? "Dream needs a desktop." : "This device can't run Dream."}</div>
            <p>On-device image generation needs WebGPU and a real GPU — desktop Chrome/Edge 113+, recent Firefox, or Safari 26+. The model is a ~2 GB one-time download.</p>
          </div>
        }
      >
        <div class="dream-stage">
          <canvas ref={canvas} class="dream-canvas" classList={{ show: stage() === "done" }} width="512" height="512" />
          <Show when={stage() === "idle"}>
            <div class="dream-placeholder">🎨 Type a prompt and dream it up — on your GPU, nothing uploaded.</div>
          </Show>
          <Show when={stage() === "loading" || stage() === "running"}>
            <div class="dream-progress"><div class="dream-spinner" />{progress()}</div>
          </Show>
          <Show when={stage() === "error"}>
            <div class="dream-progress dream-err">Couldn't dream that — {err()}</div>
          </Show>
        </div>
        <div class="dream-form">
          <input
            ref={promptInput}
            class="ai-input dream-prompt"
            placeholder="a neon Tokyo street in the rain, cinematic…"
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") dream(); if (e.key === "Escape") { sfx.back(); props.onClose(); } }}
          />
          <button class="ps2-launch dream-go" disabled={stage() === "loading" || stage() === "running"} onClick={dream}>✦ DREAM</button>
        </div>
        <div class="dream-note">Experimental. First run downloads ~2 GB (cached after). A generation can take 20–60s depending on your GPU.</div>
      </Show>
    </div>
  );
}
