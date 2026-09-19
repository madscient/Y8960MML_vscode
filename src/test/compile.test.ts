import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { compile } from "../compile.js";

// Runs the real compiler. Set Y8MMLC to its executable; without it these skip.
const compilerPath = process.env.Y8MMLC;
const skip = compilerPath === undefined ? "Y8MMLC is not set" : false;

const DEMO = `#assign A OPL2EX1 0
A  T132 @0 V13 L8 O4 cdefgab>c
`;

function tempDir(name: string): string {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "y8960mml-")), name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test("a clean source writes the sequence", { skip }, async () => {
  const dir = tempDir("plain");
  const source = path.join(dir, "tune.mml");
  fs.writeFileSync(source, DEMO);
  const r = await compile({ compilerPath: compilerPath!, source, outDir: dir });
  assert.equal(r.kind, "ran");
  if (r.kind !== "ran") return;
  assert.equal(r.exitCode, 0);
  assert.deepEqual(r.written, [path.join(dir, "TUNE.SQ")]);
  assert.ok(fs.existsSync(r.written[0]!));
});

test("an error comes back with its line and byte column", { skip }, async () => {
  const dir = tempDir("bad");
  const source = path.join(dir, "bad.mml");
  fs.writeFileSync(source, '#voice 128 "あ", zz\n');
  const r = await compile({ compilerPath: compilerPath!, source, outDir: dir });
  assert.equal(r.kind, "ran");
  if (r.kind !== "ran") return;
  assert.equal(r.exitCode, 1);
  assert.deepEqual(r.written, []);
  assert.equal(r.diagnostics.length, 1);
  assert.equal(r.diagnostics[0]!.line, 1);
  assert.equal(r.diagnostics[0]!.column, 19);
});

test("a folder outside the ANSI code page still compiles", { skip }, async () => {
  const dir = tempDir("ü\u{1F600}");
  const source = path.join(dir, "tune.mml");
  fs.writeFileSync(source, DEMO);
  const r = await compile({ compilerPath: compilerPath!, source, outDir: dir });
  assert.equal(r.kind, "ran");
  if (r.kind !== "ran") return;
  assert.equal(r.exitCode, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, "TUNE.SQ")));
});

test("an out folder that does not exist yet is made", { skip }, async () => {
  const dir = tempDir("outdir");
  const source = path.join(dir, "tune.mml");
  fs.writeFileSync(source, DEMO);
  const outDir = path.join(dir, "build", "sq");
  const r = await compile({ compilerPath: compilerPath!, source, outDir });
  assert.equal(r.kind, "ran");
  if (r.kind !== "ran") return;
  assert.equal(r.exitCode, 0, r.stderr);
  assert.deepEqual(r.written, [path.join(outDir, "TUNE.SQ")]);
  assert.ok(fs.existsSync(r.written[0]!));
});

test("a missing compiler is reported as such", async () => {
  const dir = tempDir("missing");
  const source = path.join(dir, "tune.mml");
  fs.writeFileSync(source, DEMO);
  const r = await compile({ compilerPath: "y8mmlc-that-does-not-exist", source, outDir: dir });
  assert.equal(r.kind, "notFound");
});
