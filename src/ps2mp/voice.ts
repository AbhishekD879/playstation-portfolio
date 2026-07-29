// Party voice — Discord-style talking, on a star topology, without ever
// renegotiating a live connection.
//
// THE PROBLEM. The host is the hub: joiners have a peer connection to the host
// and none to each other. So player 2 hearing player 3 means the host forwards
// it. The obvious way — take player 3's incoming track and addTrack() it to
// player 2's connection — forces an offer/answer round trip every time somebody
// joins, leaves, or unmutes. That renegotiation runs on the same connection
// carrying the game video, and getting it wrong drops the game feed, not just
// the audio.
//
// THE APPROACH. The host is an audio MIXER, not a forwarder. Each joiner gets a
// MediaStreamAudioDestinationNode created at connect time, and that
// destination's track is added alongside the video in the FIRST offer. After
// that the peer connection never changes: joining, leaving, muting and unmuting
// are all just edges in a WebAudio graph. No renegotiation, ever.
//
// Each joiner gets its OWN mix containing everyone except itself, so nobody
// hears their own voice come back a few hundred milliseconds late — which is
// the single most disorienting thing a voice chat can do.
//
//        host mic ─┐
//        j1 mic ───┼──> mix for j2  (host + j1 + j3)
//        j2 mic ───┼──> mix for j1  (host + j2 + j3)
//        j3 mic ───┘──> mix for j3  (host + j1 + j2)
//
// Joiners send their mic on a transceiver added before the answer, so their
// sending direction exists from the start too. Muting is track.enabled = false
// — the track object stays, so again nothing renegotiates.

/** Speaking threshold. Below this a mic is open but the ring stays dark, so a
 *  quiet room doesn't look like six people all talking at once. */
const SPEAKING_FLOOR = 0.045;

export interface Levels { get(id: string): number }

/** Meters one audio source and reports a smoothed 0..1 level. Shared by host
 *  and joiner: the ring on screen is driven by the same maths everywhere. */
export function meter(ctx: AudioContext, source: AudioNode) {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.5;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  let smoothed = 0;
  return {
    /** 0..1, already smoothed and gated; 0 means "not speaking" */
    read(): number {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      // attack fast, release slow: a ring that snaps on and eases off reads as
      // speech, one that tracks RMS directly reads as a flickering meter
      smoothed = rms > smoothed ? rms : smoothed * 0.82 + rms * 0.18;
      return smoothed < SPEAKING_FLOOR ? 0 : Math.min(1, smoothed * 6);
    },
    stop() { try { source.disconnect(analyser); } catch { /* already gone */ } },
  };
}

export interface HostVoice {
  /** the track to add to THIS joiner's connection, before the first offer */
  trackFor(joinerId: string): MediaStreamTrack;
  /** route a joiner's incoming mic into everyone else's mix */
  addRemote(joinerId: string, stream: MediaStream): void;
  removeRemote(joinerId: string): void;
  /** host's own mic; call again to replace, null to drop */
  setLocalMic(stream: MediaStream | null): void;
  muteLocal(muted: boolean): void;
  /** 0..1 per member id ("host" for the host) */
  levels(): Map<string, number>;
  stop(): void;
}

/** Host-side mixer. Created once when hosting starts, before any joiner. */
export function createHostVoice(): HostVoice {
  const ctx = new AudioContext();
  // Autoplay policy: a context created outside a gesture starts suspended.
  // Hosting is a click, so this usually resolves immediately; the resume is
  // harmless when it is already running.
  const wake = () => { if (ctx.state === "suspended") ctx.resume().catch(() => {}); };

  // ★ The host's own speakers.
  //
  // Two jobs in one edge. Obviously the host has to HEAR the room: the per-joiner
  // mixes are what each joiner hears, and none of them is the host's output.
  // Less obviously, WebAudio only pulls a branch with a path to a destination,
  // and a remote peer-connection track isn't decoded at all until something
  // consumes it — so without this a joiner's meter reads pure silence on a live,
  // unmuted track (measured: levels [["j1", 0]]).
  //
  // The host's OWN mic goes to a zero-gain sink instead, for the same pull
  // reason but without hearing itself a frame late.
  const hush = ctx.createGain();
  hush.gain.value = 0;
  hush.connect(ctx.destination);

  interface Source { node: AudioNode; gain: GainNode; meter: ReturnType<typeof meter>; stream?: MediaStream; el?: HTMLAudioElement }
  const sources = new Map<string, Source>();          // "host" | joinerId
  const mixes = new Map<string, MediaStreamAudioDestinationNode>();
  const localLevels = new Map<string, number>();

  /** Wire every source into every mix except the one belonging to that source.
   *  Called after any change; connecting an already-connected pair is a no-op
   *  in WebAudio, so this stays idempotent and cheap at six players. */
  const rewire = () => {
    for (const [sid, src] of sources) {
      for (const [mid, dest] of mixes) {
        if (sid === mid) continue;                     // never echo a voice back
        try { src.gain.connect(dest); } catch { /* already connected */ }
      }
    }
  };

  const addSource = (id: string, stream: MediaStream) => {
    dropSource(id);
    wake();
    const node = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    node.connect(gain);
    gain.connect(hush);
    // ★ A real <audio> element per remote joiner, and it is not decoration.
    //
    // Chrome does not decode a remote peer-connection track that only feeds
    // WebAudio: createMediaStreamSource on it produces silence, so the mixes
    // carry nothing and the meters read zero on a live, unmuted track. Attaching
    // the stream to a media element starts the decoder. It also IS the host's
    // ears — the per-joiner mixes are what joiners hear, none of them is the
    // host's own output — which is why it plays rather than sitting muted.
    const el = id === "host" ? undefined : new Audio();
    if (el) { el.srcObject = stream; el.play().catch(() => { /* resumes on the next gesture */ }); }
    sources.set(id, { node, gain, meter: meter(ctx, gain), stream, el });
    rewire();
  };

  const dropSource = (id: string) => {
    const s = sources.get(id);
    if (!s) return;
    s.meter.stop();
    if (s.el) { s.el.pause(); s.el.srcObject = null; }
    try { s.gain.disconnect(); } catch { /* ignore */ }
    try { s.node.disconnect(); } catch { /* ignore */ }
    sources.delete(id);
    localLevels.delete(id);
  };

  const api: HostVoice = {
    trackFor(joinerId) {
      wake();
      let dest = mixes.get(joinerId);
      if (!dest) {
        dest = ctx.createMediaStreamDestination();
        mixes.set(joinerId, dest);
        rewire();
      }
      return dest.stream.getAudioTracks()[0];
    },
    addRemote(joinerId, stream) { addSource(joinerId, stream); },
    removeRemote(joinerId) {
      dropSource(joinerId);
      const dest = mixes.get(joinerId);
      if (dest) { try { dest.disconnect(); } catch { /* ignore */ } mixes.delete(joinerId); }
    },
    setLocalMic(stream) {
      if (!stream) { dropSource("host"); return; }
      addSource("host", stream);
    },
    muteLocal(muted) {
      const s = sources.get("host");
      // gate the graph AND the track: the gain stops others hearing it, the
      // track flag is what the browser's own mic indicator reflects
      if (s) s.gain.gain.value = muted ? 0 : 1;
      s?.stream?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    },
    levels() {
      for (const [id, s] of sources) localLevels.set(id, s.meter.read());
      return new Map(localLevels);
    },
    stop() {
      for (const id of [...sources.keys()]) dropSource(id);
      for (const dest of mixes.values()) { try { dest.disconnect(); } catch { /* ignore */ } }
      mixes.clear();
      try { hush.disconnect(); } catch { /* already gone */ }
      ctx.close().catch(() => {});
    },
  };
  if (import.meta.env?.DEV) (globalThis as any).__voice = {
    api, ctx,
    dump: () => ({
      state: ctx.state,
      sources: [...sources.keys()],
      mixes: [...mixes.keys()],
      levels: [...api.levels().entries()],
      tracks: [...sources.entries()].map(([id, s]) => [id, s.stream?.getAudioTracks().map((t) => `${t.readyState}/${t.enabled}/${t.muted}`)]),
    }),
  };
  return api;
}

export interface JoinerVoice {
  /** meter on the local mic, for our own ring */
  level(): number;
  muteLocal(muted: boolean): void;
  stop(): void;
}

/** Joiner-side: meter the local mic so our own ring lights without waiting for
 *  the host to tell us we are talking. Playback of the host mix is a plain
 *  <audio> element on the received stream — no graph needed. */
export function createJoinerVoice(stream: MediaStream): JoinerVoice {
  const ctx = new AudioContext();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const node = ctx.createMediaStreamSource(stream);
  const m = meter(ctx, node);
  return {
    level: () => m.read(),
    muteLocal: (muted) => stream.getAudioTracks().forEach((t) => { t.enabled = !muted; }),
    stop() {
      m.stop();
      try { node.disconnect(); } catch { /* ignore */ }
      ctx.close().catch(() => {});
    },
  };
}

/** getUserMedia with the processing a game room wants: echo cancellation on
 *  (people play on speakers), and no video ever. Returns null when blocked so
 *  callers can show a real reason instead of a dead button. */
export async function openMic(): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  } catch {
    return null;
  }
}
