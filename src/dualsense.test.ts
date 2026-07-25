// Self-check for the DualSense input-report decode.
// Run: npx tsx src/dualsense.test.ts
//
// This is bit-twiddling against a binary protocol with a USB/Bluetooth offset
// difference — the classic place for a silent off-by-one. No pad required.
import { strict as assert } from "node:assert";
import { parseInputReport } from "./dualsense";

/** Build a report body; `shift` mimics Bluetooth's extra leading byte. */
function report(shift: number, edit: (d: DataView, s: number) => void) {
  const buf = new ArrayBuffer(80);
  const d = new DataView(buf);
  edit(d, shift);
  return d;
}

for (const [id, shift] of [[0x01, 0], [0x31, 1]] as const) {
  const tag = id === 0x01 ? "usb" : "bt";

  // —— battery ——
  const batt = report(shift, (d) => d.setUint8(id === 0x31 ? 53 : 52, 0x07));
  assert.equal(parseInputReport(id, batt).battery, 75, `${tag}: battery`);

  // —— Create (0x10 in buttons[1]) and Mute (0x04 in buttons[2]) ——
  const btn = report(shift, (d, s) => { d.setUint8(8 + s, 0x10); d.setUint8(9 + s, 0x04) });
  const pb = parseInputReport(id, btn);
  assert.equal(pb.create, true, `${tag}: create pressed`);
  assert.equal(pb.mute, true, `${tag}: mute pressed`);

  // a DIFFERENT button in the same byte must not read as Create — this is the
  // check that catches a wrong mask
  const other = report(shift, (d, s) => d.setUint8(8 + s, 0x20)); // Options
  assert.equal(parseInputReport(id, other).create, false, `${tag}: Options is not Create`);

  // —— motion, including negatives (the int16 sign is easy to lose) ——
  const mot = report(shift, (d, s) => {
    d.setInt16(15 + s, 1234, true); d.setInt16(17 + s, -1234, true); d.setInt16(19 + s, 32767, true);
    d.setInt16(21 + s, -32768, true); d.setInt16(23 + s, 0, true); d.setInt16(25 + s, 999, true);
  });
  const pm = parseInputReport(id, mot).motion!;
  assert.deepEqual(
    [pm.gx, pm.gy, pm.gz, pm.ax, pm.ay, pm.az],
    [1234, -1234, 32767, -32768, 0, 999],
    `${tag}: motion triples`,
  );

  // —— touchpad: 12-bit x and y sharing a nibble ——
  // x = 0x123 (291), y = 0x456 (1110) → b1=0x23, b2=0x61, b3=0x45
  const touch = report(shift, (d, s) => {
    d.setUint8(32 + s, 0x00);  // bit7 clear = finger down
    d.setUint8(33 + s, 0x23); d.setUint8(34 + s, 0x61); d.setUint8(35 + s, 0x45);
  });
  const pt = parseInputReport(id, touch).touch!;
  assert.equal(pt.active, true, `${tag}: finger down`);
  assert.ok(Math.abs(pt.x - 291 / 1920) < 1e-6, `${tag}: touch x (got ${pt.x * 1920})`);
  assert.ok(Math.abs(pt.y - 1110 / 1080) < 1e-6 || pt.y === 1, `${tag}: touch y (got ${pt.y * 1080})`);

  // bit 7 SET means the finger is lifted — inverting this is a classic slip
  const lifted = report(shift, (d, s) => d.setUint8(32 + s, 0x80));
  assert.equal(parseInputReport(id, lifted).touch!.active, false, `${tag}: finger lifted`);
}

// USB and Bluetooth must NOT decode identically from the same bytes — if they
// did, the shift isn't being applied at all
const same = new DataView(new ArrayBuffer(80));
same.setUint8(8, 0x10); // Create at the USB offset only
assert.equal(parseInputReport(0x01, same).create, true);
assert.equal(parseInputReport(0x31, same).create, false, "BT must not read USB offsets");

// short reports must not throw
assert.doesNotThrow(() => parseInputReport(0x01, new DataView(new ArrayBuffer(4))));
assert.equal(parseInputReport(0x01, new DataView(new ArrayBuffer(4))).motion, null);

console.log("dualsense: input report decode ok");
