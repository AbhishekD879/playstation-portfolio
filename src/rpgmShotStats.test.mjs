// The stats decide whether I call a frame "black" or "has a red mark", so they
// get checked against synthetic images with known content. Same maths as the
// shim's shot(), fed raw RGBA instead of a canvas.
import assert from "node:assert/strict";
const stats = (d) => { const n = d.length / 4; let dark = 0, red = 0, sum = 0;
  for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i+1], b = d[i+2];
    const l = (r*299 + g*587 + b*114) / 1000; sum += l;
    if (l < 12) dark++;
    if (r > 90 && r > g*2 && r > b*2) red++; }
  return { mean: Math.round(sum/n), black: Math.round(100*dark/n), red: Math.round(100*red/n) }; };
const fill = (n, [r,g,b]) => { const a = new Uint8Array(n*4);
  for (let i = 0; i < n; i++) { a[i*4]=r; a[i*4+1]=g; a[i*4+2]=b; a[i*4+3]=255; } return a; };
const mix = (parts) => { const out = []; for (const [n, c] of parts) out.push(...fill(n, c));
  return Uint8Array.from(out); };

// pure black — the signature we must detect confidently
let s = stats(fill(1000, [0,0,0]));
assert.deepEqual(s, { mean: 0, black: 100, red: 0 });

// pure black is NOT reported as red
assert.equal(stats(fill(1000, [0,0,0])).red, 0);

// the reported symptom: mostly black with a small red mark
s = stats(mix([[950, [0,0,0]], [50, [220,20,20]]]));
assert.equal(s.black, 95, "still overwhelmingly black");
assert.equal(s.red, 5, "and the red mark is measured, not guessed");

// a normal bright frame is neither black nor red
s = stats(fill(1000, [130,140,150]));
assert.equal(s.black, 0);
assert.equal(s.red, 0);
assert.ok(s.mean > 100);

// dark-but-not-black content must not be called black (a dim night scene)
s = stats(fill(1000, [30,30,34]));
assert.equal(s.black, 0, "luma 30 is dim, not black");

// white must never count as red despite a high R channel
assert.equal(stats(fill(1000, [255,255,255])).red, 0, "white is not red");
// orange/skin tones must not count as red either
assert.equal(stats(fill(1000, [200,150,120])).red, 0, "skin tone is not red");
// saturated red does count
assert.equal(stats(fill(1000, [200,10,10])).red, 100);
console.log("shot stats: black/red detection ok");
