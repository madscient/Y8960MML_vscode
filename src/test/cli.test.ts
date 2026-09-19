import assert from "node:assert/strict";
import { test } from "node:test";

import { looksLikeY8960Mml, parseDiagnostics, parseWrittenFiles, utf8ColumnToUtf16 } from "../cli.js";

// The lines below are copies of what y8mmlc printed when run by hand, except
// the <path>:<line>: form, which no hand run produced.

test("the three diagnostic forms", () => {
  const stderr = [
    "D:\\songs\\bad.mml:1:19: error: 'zz' is not a value; a byte is -128 to 255",
    "p3.mml:4: error: something about line four",
    "verylongname.mml: warning: the output name does not fit MSX-DOS's eight characters; it is 'VERYLONG'",
    "nosuch.mml: error: cannot open the file",
    "y8mmlc: 2 error(s); nothing was written",
    "",
  ].join("\r\n");
  assert.deepEqual(parseDiagnostics(stderr), [
    { severity: "error", line: 1, column: 19, message: "'zz' is not a value; a byte is -128 to 255" },
    { severity: "error", line: 4, column: undefined, message: "something about line four" },
    {
      severity: "warning",
      line: undefined,
      column: undefined,
      message: "the output name does not fit MSX-DOS's eight characters; it is 'VERYLONG'",
    },
    { severity: "error", line: undefined, column: undefined, message: "cannot open the file" },
  ]);
});

test("a path that did not decode still yields the fields", () => {
  const d = parseDiagnostics("\uFFFD\uFFFD\u0082.mml:3:6: error: @n is 0 to 255\n");
  assert.deepEqual(d, [{ severity: "error", line: 3, column: 6, message: "@n is 0 to 255" }]);
});

test("a line that is none of the forms is not a diagnostic", () => {
  assert.deepEqual(parseDiagnostics("y8mmlc: cannot write 'out/DEMO.SQ'\n"), []);
});

test("written files keep only the file name", () => {
  const stdout = "out/FOO.SQ (367 bytes)\r\nD:\\x\\FOO.PC (1024 bytes)\r\n";
  assert.deepEqual(parseWrittenFiles(stdout), ["FOO.SQ", "FOO.PC"]);
});

test("UTF-8 byte column to UTF-16 offset", () => {
  // y8mmlc put 'zz' of this line at column 19.
  const line = '#voice 128 "あ", zz';
  assert.equal(line.indexOf("zz"), 16);
  assert.equal(utf8ColumnToUtf16(line, 19), 16);
  assert.equal(utf8ColumnToUtf16("abc", 1), 0);
  assert.equal(utf8ColumnToUtf16("abc", 4), 3);
  assert.equal(utf8ColumnToUtf16("abc", 99), 3);
  // U+1F600 is 4 bytes and 2 UTF-16 units.
  assert.equal(utf8ColumnToUtf16("\u{1F600}x", 5), 2);
  // A column inside a character lands on its start.
  assert.equal(utf8ColumnToUtf16("あx", 2), 0);
});

test("content detection", () => {
  assert.ok(looksLikeY8960Mml("; demo\n\n#assign A OPL2EX1 0\n"));
  assert.ok(looksLikeY8960Mml("#ASSIGN P SCC 4\n"));
  assert.ok(!looksLikeY8960Mml("#assign a SCC 0\n"));
  assert.ok(!looksLikeY8960Mml("#title \"x\"\ncdefg\n"));
  assert.ok(!looksLikeY8960Mml("; #assign A SCC 0\n"));
});
