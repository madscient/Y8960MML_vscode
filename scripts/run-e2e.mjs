// Starts VS Code with this extension and runs out/e2e/suite.js inside it.
//   VSCODE_EXE      the VS Code executable to use; downloads one when unset
//   Y8MMLC          y8mmlc, handed to the extension as y8960mml.compilerPath
//   Y8960PLAYER     y8960player; with Y8960MML_E2E_PLAY=1 a short play is run
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runTests } from "@vscode/test-electron";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.Y8MMLC) {
  console.error("run-e2e: Y8MMLC を y8mmlc の実行ファイルにしてください。");
  process.exit(1);
}

// A terminal inside VS Code inherits this, and it makes Code.exe start as plain
// Node, which then rejects the options below.
delete process.env.ELECTRON_RUN_AS_NODE;

const userData =mkdtempSync(join(tmpdir(), "y8960mml-e2e-user-"));
mkdirSync(join(userData, "User"), { recursive: true });
const settings = { "y8960mml.compilerPath": process.env.Y8MMLC };
if (process.env.Y8960PLAYER) settings["y8960mml.playerPath"] = process.env.Y8960PLAYER;
writeFileSync(join(userData, "User", "settings.json"), JSON.stringify(settings, null, 2));

try {
  await runTests({
    ...(process.env.VSCODE_EXE ? { vscodeExecutablePath: process.env.VSCODE_EXE } : {}),
    extensionDevelopmentPath: root,
    extensionTestsPath: join(root, "out", "e2e", "suite.js"),
    launchArgs: ["--user-data-dir", userData, "--disable-extensions", "--skip-welcome", "--skip-release-notes"],
  });
} catch (e) {
  console.error(e);
  process.exit(1);
}
