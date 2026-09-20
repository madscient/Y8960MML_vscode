import assert from "node:assert/strict";
import { test } from "node:test";

import { linkNotes, unlinkNotes, type Range } from "../connect.js";
import { type Edit } from "../track.js";

function apply(text: string, edits: readonly Edit[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

/** The range of `part`, which the tests write out of the source itself. */
function range(text: string, part: string): Range {
  const start = text.indexOf(part);
  assert.ok(start >= 0, `'${part}' is in the source`);
  return { start, end: start + part.length };
}

/** The whole source, as selecting everything gives it. */
function all(text: string): Range[] {
  return [{ start: 0, end: text.length }];
}

test("the notes of a selection are joined, one connector before each note", () => {
  const text = "#assign A SSGS 0\nA c d e\n";
  assert.equal(apply(text, linkNotes(text, all(text), "tie").edits), "#assign A SSGS 0\nA c &d &e\n");
  assert.equal(apply(text, linkNotes(text, all(text), "porta").edits), "#assign A SSGS 0\nA c ~d ~e\n");
});

test("only the notes inside the selection are joined", () => {
  const text = "#assign A SSGS 0\nA cdefg\n";
  const edits = linkNotes(text, [range(text, "def")], "tie").edits;
  assert.equal(apply(text, edits), "#assign A SSGS 0\nA cd&e&fg\n");
});

test("a rest, an @W and a macro break the chain", () => {
  const text = "#assign A SSGS 0\nA c4 d4 r4 e4 f4 @W4 g4 XRIFF; a4 b4\n";
  assert.equal(
    apply(text, linkNotes(text, all(text), "tie").edits),
    "#assign A SSGS 0\nA c4 &d4 r4 e4 &f4 @W4 g4 XRIFF; a4 &b4\n",
  );
});

test("a block and a bracketed mark break the chain", () => {
  // The notes of [1 and [2 never sound one after the other.
  const text = "#assign A SSGS 0\nA |: c [1 d ] [2 e :|2 (DC)\n";
  assert.deepEqual(linkNotes(text, all(text), "tie").edits, []);
  // Across a repeat the notes do follow one another, so those pairs are joined.
  const loop = "#assign A SSGS 0\nA |: c d :|2 e\n";
  assert.equal(apply(loop, linkNotes(loop, all(loop), "tie").edits), "#assign A SSGS 0\nA |: c &d :|2 &e\n");
});

test("a pair already joined either way is left alone", () => {
  const text = "#assign A SSGS 0\nA c&d ~e f\n";
  assert.equal(apply(text, linkNotes(text, all(text), "tie").edits), "#assign A SSGS 0\nA c&d ~e &f\n");
  assert.equal(apply(text, linkNotes(text, all(text), "porta").edits), "#assign A SSGS 0\nA c&d ~e ~f\n");
});

test("the chain follows a track onto its next line", () => {
  const text = "#assign A SSGS 0\nA c\nA d\nA e\n";
  assert.equal(apply(text, linkNotes(text, all(text), "tie").edits), "#assign A SSGS 0\nA c\nA &d\nA &e\n");
});

test("a '\\' continuation is one line for the chain", () => {
  const text = "#assign A SSGS 0\nA c \\\n  d\n";
  assert.equal(apply(text, linkNotes(text, all(text), "tie").edits), "#assign A SSGS 0\nA c \\\n  &d\n");
});

test("two tracks are two chains", () => {
  const text = "#assign A SSGS 0\n#assign B SSGS 1\nA c d\nB e f\n";
  assert.equal(
    apply(text, linkNotes(text, all(text), "tie").edits),
    "#assign A SSGS 0\n#assign B SSGS 1\nA c &d\nB e &f\n",
  );
});

test("a rhythm track is named back, and nothing is written into it", () => {
  const text = "#assign D OPL2EX1 10\nD BSH8 H8\n";
  const result = linkNotes(text, all(text), "tie");
  assert.deepEqual(result.rhythm, ["D"]);
  assert.deepEqual(result.edits, []);
});

test("an ADPCM track is joined like a melody one", () => {
  const text = "#assign D OPL2EX1 9\nD @0 c8 d8\n";
  const result = linkNotes(text, all(text), "tie");
  assert.deepEqual(result.rhythm, []);
  assert.equal(apply(text, result.edits), "#assign D OPL2EX1 9\nD @0 c8 &d8\n");
});

test("taking a kind away leaves the other one", () => {
  const text = "#assign A SSGS 0\nA c&d ~e ~-1200f\n";
  assert.equal(apply(text, unlinkNotes(text, all(text), "tie").edits), "#assign A SSGS 0\nA cd ~e ~-1200f\n");
  assert.equal(apply(text, unlinkNotes(text, all(text), "porta").edits), "#assign A SSGS 0\nA c&d e f\n");
});

test("only what the selection covers is taken away", () => {
  const text = "#assign A SSGS 0\nA c&d&e&f\n";
  assert.equal(apply(text, unlinkNotes(text, [range(text, "d&e")], "tie").edits), "#assign A SSGS 0\nA c&de&f\n");
});

test("a '&' in a comment or a meta command is not a tie", () => {
  const text = "; c&d\n#define RIFF \"c&d\"\n#assign A SSGS 0\nA c d\n";
  assert.deepEqual(unlinkNotes(text, all(text), "tie").edits, []);
});

test("nothing to do comes back as no edits", () => {
  const text = "#assign A SSGS 0\nA c\n";
  assert.deepEqual(linkNotes(text, all(text), "tie").edits, []);
  assert.deepEqual(unlinkNotes(text, all(text), "porta").edits, []);
});
