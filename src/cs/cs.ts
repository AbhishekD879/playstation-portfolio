// Counter-Strike 1.6 in the browser — Xash3D-FWGS compiled to WebAssembly
// (GPLv3 engine, npm `xash3d-fwgs`) + the open cs16-client game DLLs (GPLv2+,
// npm `cs16-client`, includes the SERVER dll and YaPB bots). Game ASSETS are
// Valve's: the user brings their own valve.zip (valve/ + cstrike/ folders from
// their Steam copy) — cached once in OPFS. Nothing is uploaded anywhere.
//
// Multiplayer: browsers can't do UDP, but the engine's whole socket layer is a
// pluggable JS `Net`. The official pattern ships game packets over WebRTC
// DataChannels (unordered, no retransmit = UDP semantics). We reuse the
// console's existing mp-worker signaling rooms + TURN (same infra as PS2 MP):
//   HOST  — this browser runs a real LISTEN server (the cs dll in-wasm). Each
//           joiner is assigned a fake LAN address 10.0.0.<n>; a multiplexer
//           routes engine sendto() by destination IP to that peer's channel.
//   JOIN  — single channel to the host; the host is addressed as 127.0.0.1:8080
//           (mirrors the upstream webrtc example), then `connect 127.0.0.1:8080`.
import { Net, Xash3D, type Packet } from "xash3d-fwgs";
import { unzipSync } from "fflate";
import { connectSignaling, iceConfig, makePeer } from "../ps2mp/webrtc";

import xashURL from "xash3d-fwgs/xash.wasm?url";
import filesystemURL from "xash3d-fwgs/filesystem_stdio.wasm?url";
import gles3URL from "xash3d-fwgs/libref_gles3compat.wasm?url";
import valveExtrasURL from "xash3d-fwgs/extras.pk3?url";
import menuURL from "cs16-client/cl_dlls/menu_emscripten_wasm32.wasm?url";
import clientURL from "cs16-client/cl_dlls/client_emscripten_wasm32.wasm?url";
import serverURL from "cs16-client/dlls/cs_emscripten_wasm32.wasm?url";
import yapbURL from "cs16-client/dlls/yapb_emscripten_wasm32.wasm?url";
import csExtrasURL from "cs16-client/extras.pk3?url";

export type CsProgress = (msg: string) => void;

// —— OPFS cache: the user picks valve.zip once ————————————————————————————
const csDir = () => navigator.storage.getDirectory().then((r) => r.getDirectoryHandle("cs", { create: true }));

export async function cachedZip(): Promise<File | null> {
  try { const d = await csDir(); const h = await d.getFileHandle("valve.zip"); return await h.getFile(); } catch { return null; }
}
export async function cacheZip(f: File): Promise<boolean> {
  try {
    const d = await csDir();
    const h = await d.getFileHandle("valve.zip", { create: true });
    const w = await h.createWritable();
    await f.stream().pipeTo(w);
    return true;
  } catch { return false; } // low disk — playable this session anyway
}
export async function clearCache(): Promise<void> {
  try { const d = await csDir(); await d.removeEntry("valve.zip"); } catch { /* nothing cached */ }
}

// —— engine boot ————————————————————————————————————————————————————————————
export async function bootCs(opts: {
  canvas: HTMLCanvasElement;
  zip: File;
  onProgress: CsProgress;
  net?: (x: Xash3D) => void; // multiplayer wires its Net before init
}): Promise<Xash3D> {
  const { canvas, zip, onProgress } = opts;
  const x = new Xash3D({
    canvas,
    arguments: ["-windowed", "-game", "cstrike"],
    libraries: {
      filesystem: filesystemURL,
      xash: xashURL,
      menu: menuURL,
      server: serverURL,
      client: clientURL,
      render: { gles3compat: gles3URL },
    },
    dynamicLibraries: ["dlls/cs_emscripten_wasm32.wasm", "/rodir/filesystem_stdio.wasm"],
    filesMap: {
      "dlls/cs_emscripten_wasm32.wasm": serverURL,
      "/rodir/filesystem_stdio.wasm": filesystemURL,
    },
  });
  opts.net?.(x);

  onProgress("Reading your game files…");
  const buf = new Uint8Array(await zip.arrayBuffer());
  onProgress("Starting the engine…");
  await x.init();
  if (x.exited) throw new Error("Engine exited during init");

  onProgress("Unpacking Half-Life + Counter-Strike…");
  const files = unzipSync(buf); // central-directory parse — robust to data descriptors
  const FS = x.em.FS;
  let n = 0, total = 0;
  for (const name in files) if (!name.endsWith("/")) total++;
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith("/")) continue;
    // tolerate zips with or without a wrapper folder above valve/ + cstrike/
    const rel = name.replace(/^[^/]+\/(?=(valve|cstrike|gearbox|bshift)\/)/, "");
    const path = "/rodir/" + rel;
    FS.mkdirTree(path.split("/").slice(0, -1).join("/"));
    FS.writeFile(path, data);
    if (++n % 250 === 0) onProgress(`Unpacking… ${Math.round((n / total) * 100)}%`);
  }

  onProgress("Installing engine extras…");
  const put = async (url: string, path: string) => {
    const r = await fetch(url);
    FS.mkdirTree(path.split("/").slice(0, -1).join("/"));
    FS.writeFile(path, new Uint8Array(await r.arrayBuffer()));
  };
  await Promise.all([
    put(valveExtrasURL, "/rodir/valve/extras.pk3"),
    put(csExtrasURL, "/rodir/cstrike/extras.pk3"),
    put(yapbURL, "/rodir/cstrike/dlls/yapb_emscripten_wasm32.wasm"), // bots dll available to the server
  ]);

  FS.chdir("/rodir");
  onProgress("Launching…");
  x.main();
  x.Cmd_ExecuteString("_vgui_menus 0"); // wasm build has no VGUI
  return x;
}

// —— multiplayer ————————————————————————————————————————————————————————————
const HOST_FAKE = { ip: [127, 0, 0, 1] as [number, number, number, number], port: 8080 };
const asI8 = (d: ArrayBuffer) => new Int8Array(d);

export interface CsHostHandle { players(): number; stop(): void }

/** HOST side: listen server in this browser; joiners fan in via DataChannels. */
export function csHost(room: string, onStatus: (s: string) => void, onPlayers: (n: number) => void) {
  // fake-LAN multiplexer: 10.0.0.<octet> ←→ that peer's channel
  const chans = new Map<number, RTCDataChannel>();
  let net: Net | null = null;
  const sender = {
    sendto(p: Packet) {
      if (p.ip[0] === 10 && p.ip[1] === 0 && p.ip[2] === 0) {
        const dc = chans.get(p.ip[3]);
        if (dc?.readyState === "open") dc.send(p.data as unknown as ArrayBufferView<ArrayBuffer>);
      }
      // anything else (master-server heartbeats etc.) is dropped — harmless
    },
  };
  const wireNet = (x: Xash3D) => { net = new Net(sender); (x as unknown as { net: Net }).net = net; };

  const sig = connectSignaling(room);
  const peers = new Map<string, ReturnType<typeof makePeer>>();
  let nextOctet = 2;

  sig.onOpen(() => sig.send({ t: "host", room, max: 8 }));
  sig.onClose(() => onStatus("signaling closed"));
  sig.onMessage(async (m: any) => {
    if (m.t === "hosted") { onStatus("room open — share the code"); return; }
    if (m.t === "error") { onStatus(`error: ${m.msg}`); return; }
    if (m.t === "joiner") {
      const id = m.id as string;
      const octet = nextOctet++;
      const ice = await iceConfig();
      const peer = makePeer(ice, (c) => sig.send({ t: "signal", to: id, data: { candidate: c } }));
      peers.set(id, peer);
      // UDP semantics: unordered, no retransmits — GoldSrc netcode expects loss
      const dc = peer.pc.createDataChannel("game", { ordered: false, maxRetransmits: 0 });
      dc.binaryType = "arraybuffer";
      dc.onopen = () => { chans.set(octet, dc); onPlayers(chans.size); onStatus(`player joined (${chans.size})`); };
      dc.onclose = () => { chans.delete(octet); onPlayers(chans.size); };
      dc.onmessage = (e) => net?.incoming.enqueue({ data: asI8(e.data), ip: [10, 0, 0, octet], port: 27005 });
      peer.pc.onconnectionstatechange = () => {
        if (["failed", "closed", "disconnected"].includes(peer.pc.connectionState)) { peers.delete(id); chans.delete(octet); onPlayers(chans.size); }
      };
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      sig.send({ t: "signal", to: id, data: { sdp: peer.pc.localDescription } });
      return;
    }
    if (m.t === "signal") {
      const peer = peers.get(m.from);
      if (!peer) return;
      if (m.data.sdp) await peer.setRemote(m.data.sdp);
      else if (m.data.candidate) await peer.addCandidate(m.data.candidate);
    }
    if (m.t === "peer-left") { peers.get(m.id)?.pc.close(); peers.delete(m.id); }
  });

  const handle: CsHostHandle = {
    players: () => chans.size,
    stop: () => { for (const p of peers.values()) p.pc.close(); peers.clear(); chans.clear(); sig.close(); },
  };
  return { wireNet, handle };
}

export interface CsJoinHandle { stop(): void }

/** JOIN side: one channel to the host; the host lives at 127.0.0.1:8080. */
export function csJoin(room: string, onStatus: (s: string) => void, onReady: () => void) {
  let net: Net | null = null;
  let dc: RTCDataChannel | null = null;
  const sender = {
    sendto(p: Packet) {
      // the engine only needs to talk to the server it's connecting to
      if (p.ip[0] === 127 && p.port === HOST_FAKE.port && dc?.readyState === "open") dc.send(p.data as unknown as ArrayBufferView<ArrayBuffer>);
    },
  };
  const wireNet = (x: Xash3D) => { net = new Net(sender); (x as unknown as { net: Net }).net = net; };

  const sig = connectSignaling(room);
  let peer: ReturnType<typeof makePeer> | null = null;
  const early: any[] = [];

  const handleMsg = async (m: any) => {
    if (m.t === "joined") { onStatus("connecting to host…"); return; }
    if (m.t === "error") { onStatus(`error: ${m.msg}`); return; }
    if (m.t === "host-left") { onStatus("host left"); return; }
    if (m.t !== "signal") return;
    if (!peer) { early.push(m); return; }
    if (m.data.sdp) {
      await peer.setRemote(m.data.sdp);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      sig.send({ t: "signal", to: "host", data: { sdp: peer.pc.localDescription } });
    } else if (m.data.candidate) await peer.addCandidate(m.data.candidate);
  };

  iceConfig().then((ice) => {
    peer = makePeer(ice, (c) => sig.send({ t: "signal", to: "host", data: { candidate: c } }));
    peer.pc.ondatachannel = (e) => {
      if (e.channel.label !== "game") return;
      dc = e.channel;
      dc.binaryType = "arraybuffer";
      dc.onmessage = (ev) => net?.incoming.enqueue({ data: asI8(ev.data), ip: HOST_FAKE.ip, port: HOST_FAKE.port });
      dc.onopen = () => { onStatus("connected — joining game"); onReady(); };
      dc.onclose = () => onStatus("connection lost");
    };
    for (const m of early.splice(0)) void handleMsg(m);
  });
  sig.onOpen(() => sig.send({ t: "join", room }));
  sig.onClose(() => onStatus("signaling closed"));
  sig.onMessage(handleMsg);

  const handle: CsJoinHandle = { stop: () => { peer?.pc.close(); sig.close(); } };
  return { wireNet, handle };
}

export const newRoomCode = () => Array.from({ length: 5 }, () => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[(Math.random() * 31) | 0]).join("");
