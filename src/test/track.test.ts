import assert from "node:assert/strict";
import { test } from "node:test";

import { deleteTrack, duplicateTrack, renameTrack, trackSummaries, unusedTracks, type Edit } from "../track.js";

function apply(text: string, edits: readonly Edit[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

const SONG = [
  "; demo",
  "#assign A OPL2EX1 0",
  "#assign B \\",
  "        SCC 0",
  "#define RIFF \"cde\"",
  "",
  "A  O4 L8 cdefgab>c \\",
  "         >cbagfedc<",
  "B  @0 c",
  "A  r4",
  "",
].join("\n");

test("the tracks a source names, in track order", () => {
  assert.deepEqual(trackSummaries(SONG), [
    { track: "A", device: "OPL2EX1", channel: "0", lines: 2 },
    { track: "B", device: "SCC", channel: "0", lines: 1 },
  ]);
});

test("a track with only an #assign, and one with only MML", () => {
  assert.deepEqual(trackSummaries("#assign A SSGS 0\nB cde\nB fga\n"), [
    { track: "A", device: "SSGS", channel: "0", lines: 0 },
    { track: "B", device: undefined, channel: undefined, lines: 2 },
  ]);
});

test("what is not a track line", () => {
  const text = [
    "; #assign C SCC 1", // a comment
    "; joined \\", // a comment that swallows the next line
    "#assign D SCC 2",
    "#assign E SCC 3 extra", // #assign takes four words
    "#assign f SCC 4", // a track name is uppercase
    "Ecde", // a track name is followed by a space
    " E cde", // a line does not begin with a space
    "#adpcm 10 bassdrum",
  ].join("\n");
  assert.deepEqual(trackSummaries(text), []);
});

test("the unused tracks", () => {
  assert.deepEqual(unusedTracks(SONG), [..."CDEFGHIJKLMNOP"]);
  assert.deepEqual(unusedTracks(""), [..."ABCDEFGHIJKLMNOP"]);
  const all = [..."ABCDEFGHIJKLMNOP"].map((t) => `${t} c`).join("\n");
  assert.deepEqual(unusedTracks(all), []);
});

test("renaming touches the #assign and every track line", () => {
  assert.equal(
    apply(SONG, renameTrack(SONG, "A", "C")),
    [
      "; demo",
      "#assign C OPL2EX1 0",
      "#assign B \\",
      "        SCC 0",
      "#define RIFF \"cde\"",
      "",
      "C  O4 L8 cdefgab>c \\",
      "         >cbagfedc<",
      "B  @0 c",
      "C  r4",
      "",
    ].join("\n"),
  );
});

test("renaming finds a track name that a '\\' pushed onto the next line", () => {
  const text = "#assign \\\nB SCC 0\nB cde\n";
  assert.equal(apply(text, renameTrack(text, "B", "P")), "#assign \\\nP SCC 0\nP cde\n");
});

test("duplicating copies the MML lines, not the #assign", () => {
  assert.equal(
    apply(SONG, duplicateTrack(SONG, "A", "C")),
    [
      "; demo",
      "#assign A OPL2EX1 0",
      "#assign B \\",
      "        SCC 0",
      "#define RIFF \"cde\"",
      "",
      "A  O4 L8 cdefgab>c \\",
      "         >cbagfedc<",
      "C  O4 L8 cdefgab>c \\",
      "         >cbagfedc<",
      "B  @0 c",
      "A  r4",
      "C  r4",
      "",
    ].join("\n"),
  );
});

test("duplicating keeps the line endings it found", () => {
  const text = "#assign A SSGS 0\r\nA cde\r\n";
  assert.equal(apply(text, duplicateTrack(text, "A", "B")), "#assign A SSGS 0\r\nA cde\r\nB cde\r\n");
});

test("duplicating a last line that has no line break adds one", () => {
  const text = "#assign A SSGS 0\nA cde";
  assert.equal(apply(text, duplicateTrack(text, "A", "B")), "#assign A SSGS 0\nA cde\nB cde");
});

test("deleting takes the #assign and the track lines away", () => {
  assert.equal(
    apply(SONG, deleteTrack(SONG, "A")),
    ["; demo", "#assign B \\", "        SCC 0", "#define RIFF \"cde\"", "", "B  @0 c", ""].join("\n"),
  );
});

test("deleting takes a whole line, continuations and all", () => {
  const text = "#assign A \\\n  SSGS 0\nA cde \\\n  fga\nB c\n";
  assert.equal(apply(text, deleteTrack(text, "A")), "B c\n");
});

test("a track the source does not name has nothing to edit", () => {
  assert.deepEqual(renameTrack(SONG, "P", "C"), []);
  assert.deepEqual(duplicateTrack(SONG, "P", "C"), []);
  assert.deepEqual(deleteTrack(SONG, "P"), []);
});
