// Deep links are a contract: a hash someone saved last month must still open the
// same thing, and a folder inside Games must be addressable so it can be shared.
import assert from "node:assert/strict";
const { parseRouteHash, appRouteHash, ROUTE_APPS } = await import("./routes.ts");

assert.deepEqual(parseRouteHash(""), null, "empty hash is not a route");
assert.deepEqual(parseRouteHash("#setup=abc"), null, "share links are not routes");
assert.deepEqual(parseRouteHash("#/game"), { cat: "game" }, "bare category");
assert.deepEqual(parseRouteHash("#/game/pc"), { cat: "game", folder: "pc" }, "folder inside a category");
assert.deepEqual(parseRouteHash("#/GAME/PlayStation"), { cat: "game", folder: "playstation" }, "case-insensitive");
assert.deepEqual(parseRouteHash("#/app/ps2home"), { app: "ps2home" }, "app route");
assert.deepEqual(parseRouteHash("#/app/ps2"), { app: "ps2home" }, "legacy ps2 slug still lands on the PS2 home");
assert.deepEqual(parseRouteHash("#/app/retrohome"), { app: "retrohome" }, "the old all-retro shelf keeps its address");
assert.deepEqual(parseRouteHash("#/app/nintendohome"), { app: "nintendohome" }, "new shelves are routable");
assert.deepEqual(parseRouteHash("#/app/nope"), null, "unknown apps are not routes");
assert.deepEqual(parseRouteHash("#/room/AB12"), { room: "AB12" }, "room invite");
assert.deepEqual(parseRouteHash("#/room/ab1"), null, "a room code is exactly four characters");
assert.deepEqual(parseRouteHash("#/game/pc/extra"), null, "no deeper than one folder");

assert.equal(appRouteHash("doom", "game", "pc"), "#/app/doom", "an open app wins over the folder");
assert.equal(appRouteHash(null, "game", "pc"), "#/game/pc", "folder address");
assert.equal(appRouteHash(null, "game", null), "#/game", "no folder");
assert.equal(appRouteHash("ps2", "game"), "#/app/ps2home", "ps2 player is addressed as its home");
for (const id of ["ps2home", "retrohome", "nintendohome", "segahome", "doom", "cs"]) assert.ok(ROUTE_APPS.has(id), `${id} routable`);
console.log("routes ok");
