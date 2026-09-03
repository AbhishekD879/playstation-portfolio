// Rect composition through iframes. getBoundingClientRect() inside a frame is
// relative to that frame's viewport, so an overlay positioned in the top page
// must add each frame's own offset — get this wrong and the upscaled picture
// lands beside the game instead of over it.
import assert from "node:assert/strict";
globalThis.window = {}; globalThis.document = { querySelectorAll: () => [] };
const { composeRect } = await import("./capture.ts");

const r = (left, top, width, height) => ({ left, top, width, height });
assert.deepEqual(composeRect(r(10, 20, 300, 200), []), r(10, 20, 300, 200), "top document: unchanged");
assert.deepEqual(composeRect(r(10, 20, 300, 200), [r(100, 50, 800, 600)]), r(110, 70, 300, 200), "one frame adds its offset");
assert.deepEqual(composeRect(r(0, 0, 640, 448), [r(5, 5, 900, 700), r(40, 60, 1200, 800)]), r(45, 65, 640, 448), "nested frames accumulate");
assert.deepEqual(composeRect(r(0, 0, 100, 100), [r(-30, -10, 500, 500)]), r(-30, -10, 100, 100), "a scrolled-off frame gives a negative origin, not a clamp");
console.log("capture rect composition ok");
