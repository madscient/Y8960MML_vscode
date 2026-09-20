import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";

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
