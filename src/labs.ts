// Labs — the declutter switchboard. Every optional app on the console is
// registered here; users flip them off in Settings → Labs and they vanish
// from the XMB. Everything ships ENABLED — Labs only ever removes.
// Core portfolio content (career, projects, skills, contact, about) is not
// optional: this is still a résumé.
import { createSignal } from "solid-js";

export interface LabApp { id: string; title: string; cat: string }

// ids must match the XmbItem ids they hide
export const LAB_APPS: LabApp[] = [
  { id: "ai", title: "AI Abhishek — on-device LLM", cat: "Users" },
  { id: "guestbook", title: "Guestbook", cat: "Users" },
  { id: "whatsnew", title: "What's New", cat: "Users" },
  { id: "radio-guide", title: "Radio Stations", cat: "Music" },
  { id: "podcasts", title: "Podcasts", cat: "Music" },
  { id: "winamp", title: "Winamp", cat: "Music" },
  { id: "radio", title: "Console Radio (lo-fi synth)", cat: "Music" },
  { id: "visualizer", title: "Visualizer", cat: "Music" },
  { id: "studio", title: "Studio — synth & drum machine", cat: "Music" },
  { id: "sp-default", title: "Spotify — lofi beats playlist", cat: "Music" },
  { id: "yt", title: "YouTube", cat: "Video" },
  { id: "ia-video", title: "Archive Cinema", cat: "Video" },
  { id: "doom", title: "DOOM", cat: "Game" },
  { id: "chess", title: "Chess vs Stockfish", cat: "Game" },
  { id: "trivia", title: "Trivia Arcade", cat: "Game" },
  { id: "flash", title: "Flash Arcade", cat: "Game" },
  { id: "ps2", title: "PlayStation 2 emulator", cat: "Game" },
  { id: "insert", title: "Retro Console (cartridge loader)", cat: "Game" },
  { id: "lichesstv", title: "Lichess TV", cat: "Game" },
  { id: "code", title: "Code Playground", cat: "Extras" },
  { id: "pc", title: "Other OS — x86 PC", cat: "Extras" },
  { id: "manual", title: "System Manual", cat: "Extras" },
  { id: "browser", title: "Browser", cat: "Web" },
  { id: "wiki", title: "Wikipedia", cat: "Web" },
  { id: "dict", title: "Dictionary", cat: "Web" },
  { id: "tm", title: "Time Machine", cat: "Web" },
  { id: "map", title: "Planet Earth", cat: "Web" },
  { id: "weather", title: "Weather", cat: "Web" },
  { id: "art", title: "Art Gallery", cat: "Photo" },
  { id: "apod", title: "Astronomy Photo of the Day", cat: "Photo" },
];

const KEY = "asp.labs.off";
const load = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]")); } catch { return new Set(); }
};
const [disabled, setDisabled] = createSignal<Set<string>>(load());

export const labEnabled = (id: string) => !disabled().has(id);
export const labsOffCount = () => disabled().size;
export function toggleLab(id: string) {
  const s = new Set(disabled());
  s.has(id) ? s.delete(id) : s.add(id);
  setDisabled(s);
  localStorage.setItem(KEY, JSON.stringify([...s]));
}
