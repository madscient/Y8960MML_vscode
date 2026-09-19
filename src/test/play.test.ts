import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";

import { assignedTracks } from "../cli.js";
import { playerArgs } from "../player.js";

const base = {
  playerPath: "y8960player",
  sequence: path.join("x", "SONG.SQ"),
  adpcm: undefined,
  tick: undefined,
  repeat: undefined,
  mutes: [],
};

test("player arguments: only what is given", () => {
  assert.deepEqual(playerArgs(base), ["SONG.SQ"]);
});

test("player arguments: every option, mutes one by one", () => {
  assert.deepEqual(
    playerArgs({ ...base, adpcm: path.join("x", "SONG.PC"), tick: 0, repeat: 0, mutes: ["!A", "OPL2EX1,9"] }),
    ["SONG.SQ", "--adpcm", "SONG.PC", "--tick", "0", "--repeat", "0", "--mute", "!A", "--mute", "OPL2EX1,9"],
  );
});

test("assigned tracks in track order", () => {
  const text = [
    "; tracks",
    "#assign D OPL2EX1 10",
    "#ASSIGN A 3 0",
    "#assign B \\",
    "        SCC 0",
    "; #assign C SCC 1",
    "A cde",
  ].join("\r\n");
  assert.deepEqual(assignedTracks(text), [
    { track: "A", device: "3", channel: "0" },
    { track: "B", device: "SCC", channel: "0" },
    { track: "D", device: "OPL2EX1", channel: "10" },
  ]);
});

test("no #assign, no tracks", () => {
  assert.deepEqual(assignedTracks("A cde\n"), []);
});
