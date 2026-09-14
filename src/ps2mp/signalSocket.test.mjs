// The signaling socket that reopens itself.
//
// What this is really guarding: a host whose socket dies keeps every player it
// already has (peer connections are peer-to-peer and do not care), but silently
// admits nobody else and drops out of the room listing. Nothing on screen
// changes, so the only way to catch a regression here is a test.
import assert from "node:assert/strict";
const { reconnectingSocket, OPEN } = await import("./signalSocket.ts");

// —— a fake socket that never touches the network ——————————————————————————
let built = [];
const makeFake = () => {
  const s = {
    readyState: 0, sent: [], closed: false,
    send(d) { s.sent.push(d); },
    close() { s.closed = true; s.readyState = 3; s.onclose?.(); },
    onopen: null, onclose: null, onmessage: null,
    // test helpers
    accept() { s.readyState = OPEN; s.onopen?.(); },
    drop() { s.readyState = 3; s.onclose?.(); },       // the network, not us
  };
  built.push(s);
  return s;
};

// timers we drive by hand, so nothing waits in real time
let pending = [];
const setTimer = (fn) => { pending.push(fn); return pending.length; };
const clearTimer = () => {};
const runTimers = () => { const p = pending; pending = []; p.forEach((fn) => fn()); };
const noKeepalive = () => 0;

const fresh = (opts = {}) => {
  built = []; pending = [];
  return reconnectingSocket(makeFake, {
    backoff: (n) => n, setTimer, clearTimer, setKeepalive: noKeepalive, clearKeepalive: () => {}, ...opts,
  });
};

// —— without the flag, behaviour is exactly what it was ————————————————————
{
  const sig = fresh({ reconnect: false });
  built[0].accept();
  built[0].drop();
  runTimers();
  assert.equal(built.length, 1, "no reconnect flag means one socket, as before");
}

// —— with it, a dropped socket comes back ——————————————————————————————————
{
  let opens = 0, closes = 0;
  const sig = fresh({ reconnect: true });
  sig.onOpen(() => opens++);
  sig.onClose(() => closes++);

  built[0].accept();
  assert.equal(opens, 1);

  built[0].drop();
  assert.equal(closes, 1, "the drop is reported");
  assert.equal(built.length, 1, "and nothing reopens until the backoff elapses");

  runTimers();
  assert.equal(built.length, 2, "a second socket is opened");
  built[1].accept();

  // This re-firing IS the fix: startHost re-sends its `host` announcement from
  // onOpen, so the room re-appears in the listing with no reconnect-specific
  // code anywhere in the host.
  assert.equal(opens, 2, "onOpen fires again, so the host re-announces itself");
}

// —— handlers registered once survive the reconnect ————————————————————————
{
  const got = [];
  const sig = fresh({ reconnect: true });
  sig.onMessage((m) => got.push(m.t));
  built[0].accept();
  built[0].onmessage({ data: '{"t":"one"}' });
  built[0].drop();
  runTimers();
  built[1].accept();
  built[1].onmessage({ data: '{"t":"two"}' });
  assert.deepEqual(got, ["one", "two"], "the same callback hears the new socket");

  // and send() reaches the replacement, not the corpse
  sig.send({ t: "host" });
  assert.deepEqual(JSON.parse(built[1].sent.at(-1)), { t: "host" });
}

// —— leaving means leaving ————————————————————————————————————————————————
// The rule reconnect.ts states for sessions, held here for the socket: someone
// who quit must never be dragged back into the room they just left.
{
  const sig = fresh({ reconnect: true });
  built[0].accept();
  sig.close();
  runTimers();
  assert.equal(built.length, 1, "close() is deliberate — no reconnect");
}

// —— pong and junk never reach the caller ——————————————————————————————————
{
  const got = [];
  const sig = fresh({ reconnect: true });
  sig.onMessage((m) => got.push(m.t));
  built[0].accept();
  built[0].onmessage({ data: '{"t":"pong"}' });
  built[0].onmessage({ data: "not json" });
  built[0].onmessage({ data: '{"t":"real"}' });
  assert.deepEqual(got, ["real"], "keepalive replies and garbage are swallowed");
}

// —— backoff grows, and resets once a socket sticks ————————————————————————
{
  const waits = [];
  const sig = fresh({ reconnect: true, backoff: (n) => { waits.push(n); return n; } });
  built[0].accept();
  built[0].drop(); runTimers();          // attempt 1
  built[1].drop(); runTimers();          // attempt 2 — never accepted, so it climbs
  assert.deepEqual(waits, [1, 2], "attempts climb while it keeps failing");
  built[2].accept();                      // a socket that sticks
  built[2].drop(); runTimers();
  assert.deepEqual(waits, [1, 2, 1], "and the count resets once one holds");
}

console.log("signalSocket ok · reconnects, re-announces, and stays gone when told to");
