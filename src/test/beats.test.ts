import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { lineTicks, TICKS_QUARTER } from "../beats.js";
import { compile } from "../compile.js";

/** The ticks of each track line that has a total, in the order the lines come. */
function ticks(source: string): number[] {
  return lineTicks(source).map((l) => l.ticks);
}

const HEAD = "#assign A SSGS 0\n";

test("the lengths the compiler's reference writes out", () => {
  // From Y8960MMLCompiler's doc/mml-reference.md: 192/n truncated, and a dot
  // adds half of what was added last.
  assert.deepEqual(ticks(HEAD + "A c4\nA c8\nA c7\nA c96\nA c4.\nA c4..\n"), [48, 24, 27, 2, 72, 84]);
  assert.equal(TICKS_QUARTER, 48);
});

test("a line with no length written takes what L last set", () => {
  assert.deepEqual(ticks(HEAD + "A O4 L8 cdefgab>c\n"), [192]);
  // L carries on to the track's next line, so a line alone does not decide it.
  assert.deepEqual(ticks(HEAD + "A L16 c\nA c\nA L4 c\nA c\n"), [12, 12, 48, 48]);
  // A dot goes on the length that L set.
  assert.deepEqual(ticks(HEAD + "A L4 c.\n"), [72]);
});

test("rests and @W take time, and the rest of the commands do not", () => {
  assert.deepEqual(ticks(HEAD + "A c4 r4 @W4\nA V10 Q6 O3 >< T120 @0 P100 ~ &\n"), [144, 0]);
});

test("what is counted is what the line writes, not what it plays", () => {
  // A repeat plays its notes four times and writes them once.
  assert.deepEqual(ticks(HEAD + "A |: c4 d4 :|4\n"), [96]);
});

test("a tuplet divides its length, truncating", () => {
  assert.deepEqual(ticks(HEAD + "A {cde}4\n"), [48]);
  // 48/5 is 9, five times over.
  assert.deepEqual(ticks(HEAD + "A {cdefg}4\n"), [45]);
  // A note that writes its own length keeps it; the others share what is left.
  assert.deepEqual(ticks(HEAD + "A {c8de}4\n"), [24 + 16 + 16]);
  // The dots of the tuplet's own length go to the share.
  assert.deepEqual(ticks(HEAD + "A {cde}4.\n"), [72]);
  // A tuplet may cross the line break between a track's lines.
  assert.deepEqual(ticks(HEAD + "A {cd\nA e}4\n"), [32, 16]);
});

test("a name stands for the number it was defined as", () => {
  assert.deepEqual(ticks("#define LEN 8\n" + HEAD + "A c=LEN; c\n"), [24 + 48]);
  assert.deepEqual(ticks("#define LEN 8\n" + HEAD + "A L=LEN; cd\n"), [48]);
});

test("X name; is expanded and counted", () => {
  const source = '#define RIFF "cde"\n' + HEAD + "A L8 XRIFF; XRIFF;\n";
  assert.deepEqual(ticks(source), [144]);
  // What the macro leaves behind carries on after it.
  assert.deepEqual(ticks('#define SET "L16"\n' + HEAD + "A XSET; c\n"), [12]);
});

test("a rhythm track counts its instrument runs", () => {
  assert.deepEqual(ticks("#assign D OPL2EX 10\nD BSH8 H8 S!H8 H8\n"), [96]);
  // A rhythm track has no L; a run with no length is a quarter note. Whitespace
  // does not end a run, so "B S H" is one hit of three instruments, not three.
  assert.deepEqual(ticks("#assign D OPL2EX 10\nD B S H\n"), [48]);
  assert.deepEqual(ticks("#assign D OPL2EX 10\nD B4 S4 H4\n"), [144]);
});

test("the commands whose letters are note or instrument letters take no time", () => {
  assert.deepEqual(ticks(HEAD + "A @E1 c4 @G1 d4\n"), [96]);
  assert.deepEqual(ticks("#assign D OPL2EX 10\nD @B5 @S5 @M5 @C5 @H5 @E1 @G1 BSH8\n"), [24]);
});

test("@W takes time on a rhythm track too", () => {
  assert.deepEqual(ticks("#assign D OPL2EX 10\nD BSH8 @W8 H8\n"), [72]);
});

test("a line whose length cannot be told has no total, nor has any line after it", () => {
  // The name is not defined anywhere.
  assert.deepEqual(ticks(HEAD + "A c4\nA c=NOPE;\nA c4\n"), [48]);
  // A '{' with no '}' to close it.
  assert.deepEqual(ticks(HEAD + "A c4\nA {cde\n"), [48]);
  // A macro that is not defined.
  assert.deepEqual(ticks(HEAD + "A c4\nA XNOPE;\n"), [48]);
  // One track going quiet leaves the others alone.
  assert.deepEqual(ticks(HEAD + "#assign B SSGS 1\nA c=NOPE;\nB c4\n"), [48]);
});

// --------------------------------------------------------------------------
// Against the real compiler: the ticks it wrote into the sequence must be the
// ticks counted here. Set Y8MMLC to the compiler; without it this skips.
// --------------------------------------------------------------------------

const compilerPath = process.env.Y8MMLC;
const skip = compilerPath === undefined ? "Y8MMLC is not set" : false;

/**
 * The note, rest and @W ticks of every track of a .SQ, added up. Only the
 * events a source of notes and rests can make are stepped over; anything else
 * fails the test rather than being passed silently.
 */
function sequenceTicks(file: string): number {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.subarray(0, 4).toString("latin1"), "Y8SQ");
  let total = 0;
  let at = 7; // the magic, the version and the size
  while (at < bytes.length) {
    const kind = bytes[at]!;
    const size = bytes[at + 1]! | (bytes[at + 2]! << 8);
    const body = at + 3;
    at = body + size;
    if (kind !== 0x00) {
      continue; // a voice, an envelope or the like, not a track
    }
    let i = body + 3; // the track, the device and the channel
    while (i < body + size) {
      const op = bytes[i++]!;
      if (op === 0xff) {
        break;
      }
      if (op <= 0x0c || op === 0x0e || op === 0x0f || op === 0x10 || op === 0xc8) {
        // a note, a rest, a wait or a rhythm strike, each with a length of one
        // or two bytes; a strike has its instruments before the length
        if (op === 0xc8) {
          i++;
        }
        const first = bytes[i++]!;
        total += first < 0x80 ? first : ((first & 0x7f) << 8) | bytes[i++]!;
        continue;
      }
      if (op === 0x40 || op === 0x41) {
        continue; // the octave steps take nothing after them
      }
      if (op >= 0x80 && op <= 0xbf) {
        i++; // one byte follows
        continue;
      }
      if (op === 0xd8) {
        i += 2; // one rhythm instrument's level: the instrument and the level
        continue;
      }
      assert.fail(`the test does not know the event ${op.toString(16)}; keep the sources plain`);
    }
  }
  return total;
}

const CASES: Record<string, string> = {
  plain: "A O4 L8 cdefgab>c\nA c4. r8 @W2\n",
  dotted: "A L4 c. d.. e f16..\n",
  tuplets: "A {cde}4 {cdefg}4 {c8de}4 {cd\nA e}8.\n",
  names: '#define LEN 8\n#define RIFF "cde"\nA L=LEN; XRIFF; c=LEN; r16 XRIFF;\n',
  // A note of length 0 takes no time, so something that does has to follow it.
  odd: "A c7 c96 c1 c0 @W4 c3\n",
  // c- and b+ are events of their own, and @G is dropped off the SCC.
  envelope: "#env MUSICA @E1 16,20,8,10\n#assign A SSGS 0\nA @E1 @V100 c4 @G1 c-8 b+8 @E0 d4\n",
  scc: "#env MUSICA @E1 16,20,8,10\n#assign A SCC 0\nA @G1 @E1 c4 d8\n",
  rhythm: "#assign D OPLLEX 10\nD @B5 @V100 BSH8 @W8 H8 I128 S!H4 @E1 @G1 r8\n",
  opm: "#assign A OPM 0\nA c4 d8 @E1 @G1 e8\n",
};

test("the ticks counted here are the ticks the compiler wrote", { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "y8960mml-beats-"));
  for (const [name, mml] of Object.entries(CASES)) {
    const source = path.join(dir, `${name}.mml`);
    fs.writeFileSync(source, mml.includes("#assign") ? mml : "#assign A SSGS 0\n" + mml);
    const r = await compile({ compilerPath: compilerPath!, source, outDir: dir });
    assert.equal(r.kind, "ran");
    if (r.kind !== "ran") return;
    assert.equal(r.exitCode, 0, `${name} compiles: ${r.stderr}`);
    const mine = ticks(fs.readFileSync(source, "utf8")).reduce((a, b) => a + b, 0);
    assert.equal(mine, sequenceTicks(r.written[0]!), `${name}`);
  }
});
