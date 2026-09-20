import assert from "node:assert/strict";
import { test } from "node:test";

import { dialectOf, tokens, type TokenKind } from "../mml.js";

/** The tokens as "kind:text" pairs, which reads as the split the lexer made. */
function split(text: string, dialect: "melody" | "adpcm" | "rhythm" = "melody"): string[] {
  return tokens(text, dialect).map((t) => `${t.kind}:${text.slice(t.start, t.end)}`);
}

function kinds(text: string): TokenKind[] {
  return tokens(text, "melody").map((t) => t.kind);
}

test("the dialect comes from the channel", () => {
  assert.equal(dialectOf("9"), "adpcm");
  assert.equal(dialectOf("10"), "rhythm");
  assert.equal(dialectOf("0"), "melody");
  assert.equal(dialectOf(undefined), "melody");
});

test("notes take their accidental, length and dots", () => {
  assert.deepEqual(split("O4 L8 c+4. d-16 e"), [
    "other:O4",
    "other:L8",
    "note:c+4.",
    "note:d-16",
    "note:e",
  ]);
});

test("whitespace inside a command belongs to it", () => {
  // y8mmlc skips whitespace everywhere, so "L 1 6" is L16 and "C 4" is a quarter note.
  assert.deepEqual(split("L 1 6 C 4"), ["other:L 1 6", "note:C 4"]);
});

test("$ takes two digits, so the note after it is not swallowed", () => {
  assert.deepEqual(split("Y$20,$0FCDE"), ["other:Y$20,$0F", "note:C", "note:D", "note:E"]);
});

test("=name; stands where a number does", () => {
  assert.deepEqual(split("T=TEMPO; c=LEN;"), ["other:T=TEMPO;", "note:c=LEN;"]);
});

test("X name; is one token and its MML is not read", () => {
  assert.deepEqual(split("XRIFF;c"), ["macro:XRIFF;", "note:c"]);
});

test("the @ commands", () => {
  assert.deepEqual(split("@10 @V127 @P-50 @W8."), [
    "other:@10",
    "other:@V127",
    "other:@P-50",
    "wait:@W8.",
  ]);
});

test("ties and portamentos", () => {
  assert.deepEqual(split("c&d ~e ~-1200 f ~0g"), [
    "note:c",
    "tie:&",
    "note:d",
    "porta:~",
    "note:e",
    "porta:~-1200",
    "note:f",
    "porta:~0",
    "note:g",
  ]);
});

test("repeats, blocks and the bracketed marks", () => {
  assert.deepEqual(split("|: c [1 d ] [2 e :|2 (TC)3 (CODA) (DC)"), [
    "other:|:",
    "note:c",
    "branch:[1",
    "note:d",
    "branch:]",
    "branch:[2",
    "note:e",
    "other::|2",
    "branch:(TC)3",
    "branch:(CODA)",
    "branch:(DC)",
  ]);
});

test("N and R carry a length like a note", () => {
  assert.deepEqual(split("N48 r4. N=X;"), ["note:N48", "rest:r4.", "note:N=X;"]);
});

test("tuplets", () => {
  assert.deepEqual(split("{cde}4."), ["other:{", "note:c", "note:d", "note:e", "other:}4."]);
});

test("a rhythm track has instruments, and no tie or portamento", () => {
  assert.deepEqual(split("BSH8 H8 S!H8 @A14", "rhythm"), [
    "note:BSH8",
    "note:H8",
    "note:S!H8",
    "other:@A14",
  ]);
  // '&' is not a rhythm command; it is read as one character and passed over.
  assert.deepEqual(split("B8&H8", "rhythm"), ["note:B8", "other:&", "note:H8"]);
});

test("an ADPCM track reads like a melody one", () => {
  assert.deepEqual(split("@0 c8 &d8", "adpcm"), ["other:@0", "note:c8", "tie:&", "note:d8"]);
});

test("text that does not parse is passed over one character at a time", () => {
  assert.deepEqual(kinds("c ?? d"), ["note", "other", "other", "note"]);
  // An unclosed name runs to the end of the text instead of hanging.
  assert.deepEqual(split("XRIFF"), ["macro:XRIFF"]);
  assert.deepEqual(split("c=LEN"), ["note:c=LEN"]);
  assert.deepEqual(split(""), []);
});
