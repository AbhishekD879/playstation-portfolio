// FSR's EASU constants are the whole contract between the CPU and the shader:
// a wrong stride here samples the wrong neighbours and the kernel degrades to a
// blur with no error anywhere. Values mirror FsrEasuCon for a 2x upscale.
import assert from "node:assert/strict";
const { easuConstants, rcasSharp } = await import("./fsr.ts");

const c = easuConstants(640, 448, 1280, 896);
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-7, `${m}: ${a} vs ${b}`);
near(c[0], 0.5, "c0.x input/output scale");     near(c[1], 0.5, "c0.y");
near(c[2], -0.25, "c0.z half-pixel offset");     near(c[3], -0.25, "c0.w");
near(c[4], 1 / 640, "c1.x 1/inW");              near(c[7], -1 / 448, "c1.w -1/inH");
near(c[8], -1 / 640, "c2.x");                    near(c[9], 2 / 448, "c2.y");
near(c[13], 4 / 448, "c3.y 4/inH");
assert.equal(c[16], 1280); assert.equal(c[17], 896);
assert.equal(c.length, 20, "80 bytes: four vec4 + outSize + pad, matching the WGSL struct");

// RCAS sharpness: 0 = maximal, each +1 halves it
near(rcasSharp(0), 1, "sharp 0");
near(rcasSharp(1), 0.5, "sharp 1");
near(rcasSharp(0.2), Math.pow(2, -0.2), "default 0.2");
console.log("fsr constants ok");
