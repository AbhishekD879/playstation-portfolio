// Monochrome line icons in the XMB style — thin strokes, soft glow via CSS.
import type { JSX } from "solid-js";

const S = (d: JSX.Element) => (
  <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">{d}</svg>
);

export const ICONS: Record<string, () => JSX.Element> = {
  user: () => S(<><circle cx="24" cy="17" r="8" /><path d="M9 41c2-9 8-13 15-13s13 4 15 13" /></>),
  users: () => S(<><circle cx="18" cy="18" r="7" /><path d="M6 40c2-8 6-11 12-11s10 3 12 11" /><circle cx="34" cy="19" r="5.5" /><path d="M33 29c5 .5 8 3.5 9.5 9" /></>),
  id: () => S(<><rect x="7" y="12" width="34" height="24" rx="3" /><circle cx="17" cy="22" r="4" /><path d="M12 32c1.5-3.5 3-5 5-5s3.5 1.5 5 5M27 19h9M27 25h9M27 31h6" /></>),
  briefcase: () => S(<><rect x="8" y="16" width="32" height="22" rx="3" /><path d="M18 16v-4a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v4M8 26h32" /></>),
  folder: () => S(<><path d="M7 13a3 3 0 0 1 3-3h9l4 5h15a3 3 0 0 1 3 3v18a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3V13Z" /></>),
  chip: () => S(<><rect x="14" y="14" width="20" height="20" rx="2" /><path d="M20 14V7M28 14V7M20 41v-7M28 41v-7M14 20H7M14 28H7M41 20h-7M41 28h-7" /><rect x="20" y="20" width="8" height="8" /></>),
  gamepad: () => S(<><path d="M14 16h20c6 0 9 5 9 11 0 5-2 9-6 9-3 0-5-2-7-5H18c-2 3-4 5-7 5-4 0-6-4-6-9 0-6 3-11 9-11Z" /><path d="M16 23v6M13 26h6" /><circle cx="33" cy="24" r="1.6" fill="currentColor" /><circle cx="37" cy="28" r="1.6" fill="currentColor" /></>),
  note: () => S(<><path d="M18 36V12l18-4v24" /><circle cx="13" cy="36" r="5" /><circle cx="31" cy="32" r="5" /></>),
  globe: () => S(<><circle cx="24" cy="24" r="16" /><path d="M8 24h32M24 8c5 4.5 7 10 7 16s-2 11.5-7 16c-5-4.5-7-10-7-16s2-11.5 7-16Z" /></>),
  gear: () => S(<><circle cx="24" cy="24" r="6" /><path d="M24 6v6M24 36v6M6 24h6M36 24h6M11 11l4.2 4.2M32.8 32.8 37 37M37 11l-4.2 4.2M15.2 32.8 11 37" /></>),
  sliders: () => S(<><path d="M8 16h24M8 32h20" /><circle cx="36" cy="16" r="4" fill="currentColor" /><circle cx="32" cy="32" r="4" fill="currentColor" /></>),
  search: () => S(<><circle cx="21" cy="21" r="12" /><path d="M30 30l10 10" /></>),
  trophy: () => S(<><path d="M16 9h16v9a8 8 0 0 1-16 0V9Z" /><path d="M16 12H9c0 6 3 9 7 9M32 12h7c0 6-3 9-7 9M24 26v6M17 39h14M20 32h8l1 7H19l1-7Z" /></>),
  disc: () => S(<><circle cx="24" cy="24" r="16" /><circle cx="24" cy="24" r="4" /><path d="M24 8a16 16 0 0 1 16 16" opacity="0.4" /></>),
  "disc-doc": () => S(<><path d="M12 8h17l7 7v25H12V8Z" /><path d="M29 8v7h7M18 22h12M18 28h12M18 34h8" /></>),
  cube: () => S(<><path d="M24 6 40 15v18L24 42 8 33V15L24 6Z" /><path d="M8 15l16 9 16-9M24 24v18" /></>),
  spark: () => S(<><path d="M24 6v10M24 32v10M6 24h10M32 24h10M12 12l7 7M29 29l7 7M36 12l-7 7M19 29l-7 7" /></>),
  mail: () => S(<><rect x="7" y="12" width="34" height="24" rx="3" /><path d="m8 14 16 13 16-13" /></>),
  link: () => S(<><path d="M20 28 28 20M15 25l-4 4a7 7 0 0 0 10 10l4-4M33 23l4-4a7 7 0 0 0-10-10l-4 4" /></>),
  phone: () => S(<><path d="M12 8c-2 0-4 2-4 4 0 15 13 28 28 28 2 0 4-2 4-4v-5l-8-3-3 3c-5-2-9-6-11-11l3-3-3-8-6-1Z" /></>),
  speaker: () => S(<><path d="M10 19v10h7l9 8V11l-9 8h-7Z" /><path d="M32 18c2 1.5 3 3.5 3 6s-1 4.5-3 6M36 13c3.5 2.5 5.5 6.5 5.5 11S39.5 32.5 36 35" /></>),
  info: () => S(<><circle cx="24" cy="24" r="16" /><path d="M24 22v10" /><circle cx="24" cy="16" r="0.5" fill="currentColor" /></>),
  power: () => S(<><path d="M24 8v14" /><path d="M15 13a14 14 0 1 0 18 0" /></>),
  plus: () => S(<><circle cx="24" cy="24" r="16" stroke-dasharray="3 4" /><path d="M24 17v14M17 24h14" /></>),
  tv: () => S(<><rect x="6" y="12" width="36" height="24" rx="3" /><path d="M18 42h12M24 36v6M16 6l8 6 8-6" /></>),
  rss: () => S(<><path d="M10 38a2 2 0 1 0 0.01 0M10 26c6.6 0 12 5.4 12 12M10 15c12.7 0 23 10.3 23 23" /></>),
  cloud: () => S(<><path d="M14 34a8 8 0 1 1 1.4-15.9A11 11 0 0 1 36.5 21 7.5 7.5 0 0 1 35 34H14Z" /></>),
  camera: () => S(<><rect x="6" y="14" width="36" height="24" rx="4" /><circle cx="24" cy="26" r="7" /><path d="M17 14l3-5h8l3 5" /></>),
  film: () => S(<><rect x="8" y="10" width="32" height="28" rx="3" /><path d="M8 17h32M8 31h32M16 10v7M32 10v7M16 31v7M32 31v7" /></>),
  play: () => S(<><circle cx="24" cy="24" r="16" /><path d="M20 17l11 7-11 7V17Z" /></>),
  book: () => S(<><path d="M24 12c-3-2.5-7-4-13-4v28c6 0 10 1.5 13 4 3-2.5 7-4 13-4V8c-6 0-10 1.5-13 4Z" /><path d="M24 12v28" /></>),
  skull: () => S(<><path d="M24 6C14 6 8 13 8 21c0 5 2.5 8.5 6 10.5V38h6v-4h4v4h6v-6.5c3.5-2 6-5.5 6-10.5 0-8-6-15-16-15Z" /><circle cx="17.5" cy="21" r="3.4" /><circle cx="30.5" cy="21" r="3.4" /></>),
  knight: () => S(<><path d="M14 40h20M17 36c0-10 2-16 10-19l-2-7 6 3c5 2.5 8 8 8 15v8" /><path d="M17 36h20M24 15l-7 8" /></>),
  question: () => S(<><circle cx="24" cy="24" r="16" /><path d="M18.5 19a5.5 5.5 0 1 1 8 4.9c-1.8 1-2.5 2-2.5 4.1" /><circle cx="24" cy="33" r="0.6" fill="currentColor" /></>),
  lightning: () => S(<><path d="M27 6 12 27h9l-2 15 15-21h-9l2-15Z" /></>),
  clock: () => S(<><circle cx="24" cy="24" r="16" /><path d="M24 14v10l7 4" /></>),
  monitor: () => S(<><rect x="6" y="10" width="36" height="23" rx="3" /><path d="M18 40h12M24 33v7" /></>),
  wave: () => S(<><path d="M9 20v8M16.5 13v22M24 8v32M31.5 15v18M39 21v6" /></>),
  mic: () => S(<><rect x="18" y="7" width="12" height="21" rx="6" /><path d="M12 23a12 12 0 0 0 24 0M24 35v6M17 41h14" /></>),
  pen: () => S(<><path d="M9 39l3-9L31 11l6 6-19 19-9 3Z" /><path d="M28 14l6 6" /></>),
  // the PlayStation face-button glyphs — the signature visual language
  triangle: () => S(<><path d="M24 9 41 38H7L24 9Z" /></>),
  circle: () => S(<><circle cx="24" cy="24" r="15" /></>),
  cross: () => S(<><path d="M12 12 36 36M36 12 12 36" /></>),
  square: () => S(<><rect x="11" y="11" width="26" height="26" rx="1.5" /></>),
};

export function Icon(props: { name: string }) {
  const C = ICONS[props.name] ?? ICONS.cube;
  return <C />;
}
