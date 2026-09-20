// Game volume. Part of `npm test`.
//
// The assertion that matters is the separation: a host must not be able to
// change what a joiner hears. Everything else here is guarding against a
// corrupt stored value silently muting the game, which is the failure nobody
// would diagnose — it looks exactly like the emulator having no sound.
import { strict as assert } from "node:assert";

const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const { clampVolume, readVolume, writeVolume, volumePercent, DEFAULT_VOLUME } =
  await import("./gameVolume.ts");

// —— the two roles never touch each other ————————————————————————————————
{
  store.clear();
  writeVolume("host", 0.3);
  assert.equal(readVolume("host"), 0.3);
  assert.equal(readVolume("joiner"), DEFAULT_VOLUME,
    "a host turning the game down must not reach into the room and quieten it " +
    "for everyone watching — the joiner's setting is theirs alone");

  writeVolume("joiner", 0.7);
  assert.equal(readVolume("host"), 0.3, "and the reverse holds too");
  assert.equal(readVolume("joiner"), 0.7);
  assert.equal(store.size, 2, "two roles, two keys");
}

// —— defaults ——————————————————————————————————————————————————————————————
{
  store.clear();
  assert.equal(DEFAULT_VOLUME, 1, "full volume unless someone chose otherwise");
  assert.equal(readVolume("host"), 1);
  assert.equal(readVolume("joiner"), 1);
}

// —— a corrupt value must not mute the game —————————————————————————————————
{
  for (const bad of ["", "abc", "NaN", "undefined", "Infinity", "-Infinity", "{}"]) {
    store.clear();
    store.set("asp.ps2.vol.game", bad);
    const v = readVolume("host");
    assert.ok(Number.isFinite(v) && v > 0,
      `stored ${JSON.stringify(bad)} must not read as silence — got ${v}`);
  }
}
{
  // Out of range is clamped, not rejected: "200%" means "as loud as it goes".
  store.clear();
  store.set("asp.ps2.vol.game", "5");
  assert.equal(readVolume("host"), 1, "above full clamps to full");
  store.set("asp.ps2.vol.game", "-3");
  assert.equal(readVolume("host"), 0, "below zero clamps to silence, which IS a valid choice");
}
{
  // 0 is a real setting and must survive the round trip — muting the game to
  // hear friends is exactly the thing this feature exists for.
  store.clear();
  assert.equal(writeVolume("host", 0), 0);
  assert.equal(readVolume("host"), 0, "a deliberate mute is remembered, not reset to full");
}

// —— clamping ——————————————————————————————————————————————————————————————
{
  assert.equal(clampVolume(0.5), 0.5);
  assert.equal(clampVolume("0.25"), 0.25, "a stored string is a number");
  assert.equal(clampVolume(NaN), DEFAULT_VOLUME);
  assert.equal(clampVolume(null), DEFAULT_VOLUME);
  assert.equal(clampVolume(undefined), DEFAULT_VOLUME);
  assert.equal(clampVolume(1.0001), 1);
}

// —— the label ————————————————————————————————————————————————————————————
{
  assert.equal(volumePercent(1), 100);
  assert.equal(volumePercent(0), 0);
  assert.equal(volumePercent(0.734), 73, "whole percent, so a drag does not flicker");
}

// —— writeVolume returns what was actually stored ————————————————————————
{
  store.clear();
  assert.equal(writeVolume("joiner", 9), 1, "the caller gets the clamped value to apply");
  assert.equal(readVolume("joiner"), 1);
}

console.log("gameVolume: ok");
