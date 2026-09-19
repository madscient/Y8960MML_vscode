import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

import * as oniguruma from "vscode-oniguruma";
import * as textmate from "vscode-textmate";

// vscode-textmate and vscode-oniguruma are the libraries VS Code tokenizes
// with; this checks that the copied grammar loads and colours under them.

const root = path.resolve(__dirname, "..", "..");

async function loadGrammar(): Promise<textmate.IGrammar> {
  const wasm = fs.readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm"));
  await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
  const registry = new textmate.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (p: string[]) => new oniguruma.OnigScanner(p),
      createOnigString: (s: string) => new oniguruma.OnigString(s),
    }),
    loadGrammar: async (scopeName) => {
      if (scopeName !== "source.y8960mml") return null;
      const file = path.join(root, "syntaxes", "y8960mml.tmLanguage.json");
      return textmate.parseRawGrammar(fs.readFileSync(file, "utf8"), file);
    },
  });
  const g = await registry.loadGrammar("source.y8960mml");
  assert.ok(g);
  return g;
}

/** Each token's text with its innermost scope. */
function tokenize(grammar: textmate.IGrammar, text: string): Array<[string, string]>[] {
  let stack = textmate.INITIAL;
  return text.split("\n").map((line) => {
    const r = grammar.tokenizeLine(line, stack);
    stack = r.ruleStack;
    return r.tokens.map((t): [string, string] => [line.slice(t.startIndex, t.endIndex), t.scopes[t.scopes.length - 1]!]);
  });
}

function scopeOf(lines: Array<[string, string]>[], lineIndex: number, text: string): string | undefined {
  return lines[lineIndex]!.find(([t]) => t === text)?.[1];
}

test("the line kinds", async () => {
  const g = await loadGrammar();
  const lines = tokenize(g, [
    "; a comment",
    "#assign A OPL2EX1 0",
    "#bogus 1",
    "A  T=TEMPO; @128 V13 L8 |: cdefg :|2",
    "junk",
  ].join("\n"));
  assert.equal(lines[0]![0]![1], "comment.line.semicolon.y8960mml");
  assert.equal(scopeOf(lines, 1, "assign"), "keyword.control.directive.y8960mml");
  assert.equal(scopeOf(lines, 1, "OPL2EX1"), "support.constant.device.y8960mml");
  assert.equal(scopeOf(lines, 2, "bogus"), "invalid.illegal.directive.y8960mml");
  assert.equal(scopeOf(lines, 3, "A"), "entity.name.section.track.y8960mml");
  assert.equal(scopeOf(lines, 3, "TEMPO"), "variable.other.macro.y8960mml");
  assert.equal(scopeOf(lines, 3, "|:"), "keyword.control.flow.y8960mml");
  assert.equal(lines[4]![0]![1], "invalid.illegal.line.y8960mml");
});

test("a trailing backslash carries the line kind over", async () => {
  const g = await loadGrammar();
  const lines = tokenize(g, ["; comment \\", "still comment", "#wave 16 -124, \\", "  124"].join("\n"));
  assert.equal(lines[1]![0]![1], "comment.line.semicolon.y8960mml");
  assert.equal(scopeOf(lines, 3, "124"), "constant.numeric.decimal.y8960mml");
});

test("the compiler's demo tokenizes without an invalid line", async (t) => {
  const demo = path.join(root, "..", "Y8960MMLCompiler", "examples", "demo.mml");
  if (!fs.existsSync(demo)) {
    t.skip("the compiler repository is not next to this one");
    return;
  }
  const g = await loadGrammar();
  const lines = tokenize(g, fs.readFileSync(demo, "utf8").replace(/\r\n/g, "\n"));
  const invalid = lines.flat().filter(([, s]) => s.startsWith("invalid."));
  assert.deepEqual(invalid, []);
});
