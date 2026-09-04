// Palm OS, in the browser: CloudpilotEmu's embedded build (GPL-3, runs in a
// Worker — no shared memory, so it works on an iPhone where the libretro cores
// do not). The player brings a device ROM (kept in the BIOS pocket like any
// firmware) and .prc programs; we boot the ROM, install the program and launch
// it. Touch on the canvas is the stylus, which is why this is the one system
// that is better on a phone than on a laptop.
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import type * as Cloudpilot from "cloudpilot-emu-embedded";
import { listBios } from "../bios";
import { bumpPlays, resolveGameFile, type GameRecord } from "../gamesdb";
import { setNavEnabled } from "../input";

type Emu = Cloudpilot.Emulator;
// The bundle is UMD; loaded lazily so a Palm program is the only thing that pays
// for it, and so the crossbar cannot be taken down by the emulator's own module.
async function loadCloudpilot(): Promise<typeof Cloudpilot> {
  const mod: any = await import("cloudpilot-emu-embedded");
  return (mod && typeof mod.createEmulator === "function" ? mod : mod.default) as typeof Cloudpilot;
}

export default function PalmSession(props: { game: GameRecord; onClose: () => void }) {
  const [state, setState] = createSignal<"loading" | "running" | "norom" | "error">("loading");
  const [detail, setDetail] = createSignal("");
  let canvas!: HTMLCanvasElement;
  let emu: Emu | null = null;
  let audioArmed = false;

  onMount(async () => {
    setNavEnabled(false);
    try {
      const roms = (await listBios("palm")).filter((f) => /\.rom$/i.test(f.name));
      if (!roms.length) { setState("norom"); return; }
      const rom = new Uint8Array(await roms[0].blob.arrayBuffer());
      const program = new Uint8Array(await (await resolveGameFile(props.game)).arrayBuffer());
      const cloudpilot = await loadCloudpilot();
      emu = await cloudpilot.createEmulator({
        cloudpilotModuleUrl: "/palm/cloudpilot_web.wasm",
        uarmModuleUrl: "/palm/uarm_web.wasm",
        uarmWorkerUrl: "/palm/uarm-worker.js",
        pcmWorkletUrl: "/palm/pcm-worklet.js",
      });
      await emu.loadRom(rom);
      emu.setCanvas(canvas);
      // the program is installed before the device runs, as the embedding guide asks
      try { await emu.installAndLaunchDatabase(program); }
      catch (e) { console.warn("[palm] install/launch failed, booting to the launcher", e); }
      emu.bindInput(canvas);
      await emu.resume();
      setState("running");
      void bumpPlays(props.game.id);
    } catch (e: any) {
      console.error("[palm] boot failed", e);
      setDetail(String(e?.message ?? e).slice(0, 160));
      setState("error");
    }
  });

  // browsers only let audio start from a gesture — the first tap on the device arms it
  const armAudio = () => {
    if (audioArmed || !emu) return;
    audioArmed = true;
    void (emu as any).initializeAudio?.().catch(() => {});
  };

  onCleanup(() => {
    setNavEnabled(true);
    const e = emu; emu = null;
    if (e) { void e.pause().catch(() => {}); e.releaseInput(); e.releaseCanvas(); }
  });

  const close = () => props.onClose();

  return (
    <div class="palm-session">
      <canvas ref={canvas} class="palm-screen" onPointerDown={armAudio} />
      <Show when={state() !== "running"}>
        <div class="palm-veil">
          <Show when={state() === "loading"}><div class="palm-msg">POWERING ON<span>loading Palm OS…</span></div></Show>
          <Show when={state() === "norom"}>
            <div class="palm-msg">NO DEVICE ROM
              <span>Palm OS needs your device's ROM file. Open the Mobile shelf → Systems → Palm OS → Add BIOS file (.rom), then play again.</span>
            </div>
          </Show>
          <Show when={state() === "error"}><div class="palm-msg">COULDN'T START<span>{detail()}</span></div></Show>
        </div>
      </Show>
      <button class="palm-eject" onClick={close}>⏏ EJECT</button>
    </div>
  );
}
