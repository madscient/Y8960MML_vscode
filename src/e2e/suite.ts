import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as vscode from "vscode";

// Runs inside an extension host started by scripts/run-e2e.mjs.

async function until<T>(get: () => T | undefined, what: string, ms = 10000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = get();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function open(file: string): Promise<vscode.TextDocument> {
  const doc = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(doc);
  return doc;
}

async function languageAndCompile(dir: string): Promise<void> {
  const bad = path.join(dir, "bad.mml");
  fs.writeFileSync(bad, '#voice 128 "あ", zz\n');
  const doc = await open(bad);
  assert.equal(doc.languageId, "y8960mml");

  await vscode.commands.executeCommand("y8960mml.compile");
  const diags = await until(() => {
    const d = vscode.languages.getDiagnostics(doc.uri);
    return d.length > 0 ? d : undefined;
  }, "diagnostics");
  assert.equal(diags.length, 1);
  const d = diags[0]!;
  assert.equal(d.severity, vscode.DiagnosticSeverity.Error);
  assert.equal(d.source, "y8mmlc");
  // 'zz' is at UTF-8 byte column 19, which is UTF-16 offset 16.
  assert.deepEqual(
    [d.range.start.line, d.range.start.character, d.range.end.character],
    [0, 16, 18],
  );
}

async function fixClearsDiagnostics(dir: string): Promise<void> {
  const file = path.join(dir, "ok.mml");
  fs.writeFileSync(file, "#assign A SSGS 0\nA cdef @999\n");
  const doc = await open(file);
  await vscode.commands.executeCommand("y8960mml.compile");
  await until(() => (vscode.languages.getDiagnostics(doc.uri).length > 0 ? true : undefined), "the error");

  const editor = vscode.window.activeTextEditor!;
  await editor.edit((e) => e.replace(doc.lineAt(1).range, "A cdef"));
  assert.ok(doc.isDirty);
  await vscode.commands.executeCommand("y8960mml.compile");
  await until(() => (vscode.languages.getDiagnostics(doc.uri).length === 0 ? true : undefined), "the error to clear");
  assert.ok(!doc.isDirty, "the command saves first");
  assert.ok(fs.existsSync(path.join(dir, "OK.SQ")));
}

async function compileOnSave(dir: string): Promise<void> {
  const file = path.join(dir, "save.mml");
  fs.writeFileSync(file, "#assign A SSGS 0\nA cdef\n");
  const doc = await open(file);
  const cfg = vscode.workspace.getConfiguration("y8960mml");
  await cfg.update("compileOnSave", true, vscode.ConfigurationTarget.Global);
  try {
    const editor = vscode.window.activeTextEditor!;
    await editor.edit((e) => e.replace(doc.lineAt(1).range, "A cdef @999"));
    await doc.save();
    await until(() => (vscode.languages.getDiagnostics(doc.uri).length > 0 ? true : undefined), "compile on save");
  } finally {
    await cfg.update("compileOnSave", undefined, vscode.ConfigurationTarget.Global);
  }
}

async function playAndStop(dir: string): Promise<void> {
  const file = path.join(dir, "play.mml");
  fs.writeFileSync(file, "#assign A SSGS 0\nA T60 L1 cdefgab\n");
  await open(file);
  await vscode.commands.executeCommand("y8960mml.play");
  assert.ok(fs.existsSync(path.join(dir, "PLAY.SQ")));
  // Looks at every y8960player on the machine, so none should be running besides.
  const players = () =>
    execSync('tasklist /FI "IMAGENAME eq y8960player.exe" /NH', { encoding: "utf8" }).includes("y8960player.exe");
  await until(() => (players() ? true : undefined), "the player to run");
  await vscode.commands.executeCommand("y8960mml.stop");
  await until(() => (players() ? undefined : true), "the player to end");
}

export async function run(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "y8960mml-e2e-"));
  const cases: Array<[string, (dir: string) => Promise<void>]> = [
    ["language and compile", languageAndCompile],
    ["fixing clears the diagnostics", fixClearsDiagnostics],
    ["compile on save", compileOnSave],
  ];
  if (process.env.Y8960MML_E2E_PLAY === "1") {
    cases.push(["play and stop", playAndStop]);
  }
  let failed = 0;
  for (const [name, fn] of cases) {
    try {
      await fn(dir);
      console.log(`ok   ${name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${name}: ${e instanceof Error ? e.stack : String(e)}`);
    }
  }
  if (failed > 0) {
    throw new Error(`${failed} case(s) failed`);
  }
}
