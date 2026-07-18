import { TROPHIES } from "./content";

export interface Profile {
  id: string;
  name: string;
  avatar: number; // index into AVATARS
  avatarImg?: string; // user-uploaded photo as a small data URL
  created: number;
  lastLogin: number;
  playtime?: number; // seconds on the console
  trophies: Record<string, number>; // trophy id -> earned timestamp
  seen: Record<string, true>; // per-item view tracking for meta-trophies
  /** set once the player has demonstrably learned the nav (or dismissed the
   *  attract loop) — lives on the profile, so it rides console backups too */
  onboarded?: number;
}

/** Downscale an image file to a 128px data URL (fits comfortably in localStorage). */
export function resizePhoto(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const S = 128;
      const c = document.createElement("canvas");
      c.width = c.height = S;
      const ctx = c.getContext("2d")!;
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, S, S);
      URL.revokeObjectURL(img.src);
      res(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}

export const AVATARS = [
  { bg: "linear-gradient(135deg,#2a4d8f,#6fb1ff)", glyph: "◆" },
  { bg: "linear-gradient(135deg,#8f2a4d,#ff6f9e)", glyph: "●" },
  { bg: "linear-gradient(135deg,#2a8f55,#6fffb1)", glyph: "▲" },
  { bg: "linear-gradient(135deg,#8f7a2a,#ffe06f)", glyph: "■" },
  { bg: "linear-gradient(135deg,#5d2a8f,#b16fff)", glyph: "✦" },
  { bg: "linear-gradient(135deg,#2a8a8f,#6ff4ff)", glyph: "◎" },
  { bg: "linear-gradient(135deg,#8f4b2a,#ffa06f)", glyph: "✚" },
  { bg: "linear-gradient(135deg,#40454f,#b8c4d8)", glyph: "◈" },
];

const KEY = "asp.profiles.v1";

export function loadProfiles(): Profile[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}

function save(profiles: Profile[]) {
  localStorage.setItem(KEY, JSON.stringify(profiles));
}

export function createProfile(name: string, avatar: number): Profile {
  const p: Profile = {
    id: Math.random().toString(36).slice(2, 10),
    name: name.trim().slice(0, 16) || "PLAYER",
    avatar,
    created: Date.now(),
    lastLogin: Date.now(),
    trophies: {},
    seen: {},
  };
  save([...loadProfiles(), p]);
  return p;
}

export function updateProfile(p: Profile) {
  save(loadProfiles().map((x) => (x.id === p.id ? p : x)));
}

export function deleteProfile(id: string) {
  save(loadProfiles().filter((x) => x.id !== id));
}

/** Award a trophy. Returns the definition if newly earned (for the toast). */
export function award(p: Profile, id: string) {
  if (p.trophies[id]) return null;
  const def = TROPHIES.find((t) => t.id === id);
  if (!def) return null;
  p.trophies[id] = Date.now();
  // platinum: everything else earned
  const rest = TROPHIES.filter((t) => t.tier !== "platinum");
  if (rest.every((t) => p.trophies[t.id]) && !p.trophies["platinum"]) {
    p.trophies["platinum"] = Date.now();
  }
  updateProfile(p);
  return def;
}

export const PLATINUM = { id: "platinum", tier: "platinum" as const, name: "Employee of the Century", desc: "Earned every trophy on this console" };
