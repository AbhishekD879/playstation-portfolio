// Winamp 2, resurrected — the real thing, reimplemented in JS (Webamp).
// It really whips the llama's ass. Drop your own MP3s onto it, or it starts
// with your recent radio stations as a playlist.
import { onCleanup, onMount } from "solid-js";
import Webamp from "webamp";
import { setNavEnabled } from "../input";

export default function WinampApp(props: {
  stations: { url: string; label: string }[];
  onClose: () => void;
}) {
  let host!: HTMLDivElement;
  let amp: Webamp | null = null;

  onMount(() => {
    setNavEnabled(false);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") props.onClose(); };
    addEventListener("keydown", esc);
    // cleanups must register before any await — Solid drops them afterwards
    onCleanup(() => {
      setNavEnabled(true);
      removeEventListener("keydown", esc);
      amp?.dispose();
    });
    amp = new Webamp({
      initialTracks: props.stations.map((s) => ({
        metaData: { artist: "console radio", title: s.label },
        url: s.url,
        duration: 0,
      })),
    });
    amp.onClose(() => props.onClose());
    amp.renderWhenReady(host);
  });

  return (
    <div class="winamp">
      <div class="winamp-host" ref={host} />
      <div class="winamp-hint">drag & drop MP3s onto the player · close via Winamp's ✕</div>
      <button class="session-eject" onClick={props.onClose}>⏏ CLOSE</button>
    </div>
  );
}
