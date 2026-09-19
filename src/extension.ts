import * as path from "node:path";

import * as vscode from "vscode";

import { assignedTracks, looksLikeY8960Mml, utf8ColumnToUtf16, type CompilerDiagnostic } from "./cli.js";
import { compile } from "./compile.js";
import { Player, playerArgs } from "./player.js";

const LANGUAGE_ID = "y8960mml";

let output: vscode.OutputChannel;
let diagnostics: vscode.DiagnosticCollection;
let player: Player;
let playingItem: vscode.StatusBarItem;
/** Documents a command is saving itself, so compile-on-save does not run twice. */
const savingForCommand = new Set<string>();

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("Y8960 MML");
  diagnostics = vscode.languages.createDiagnosticCollection(LANGUAGE_ID);
  player = new Player();
  playingItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  playingItem.text = "$(debug-stop) Y8960 再生中";
  playingItem.tooltip = "クリックで再生を止める";
  playingItem.command = "y8960mml.stop";

  context.subscriptions.push(
    output,
    diagnostics,
    playingItem,
    { dispose: () => player.stop() },
    vscode.commands.registerCommand("y8960mml.compile", () => compileCommand()),
    vscode.commands.registerCommand("y8960mml.play", () => playCommand()),
    vscode.commands.registerCommand("y8960mml.playParts", () => playPartsCommand()),
    vscode.commands.registerCommand("y8960mml.stop", () => player.stop()),
    vscode.workspace.onDidSaveTextDocument((doc) => onSave(doc)),
    vscode.workspace.onDidOpenTextDocument((doc) => detectLanguage(doc)),
  );
  for (const doc of vscode.workspace.textDocuments) {
    detectLanguage(doc);
  }
}

export function deactivate(): void {
  player?.stop();
}

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("y8960mml");
}

/**
 * Another extension (mml2mid64ide registers "mml") may have claimed .mml. A
 * file that has an #assign line is ours whichever extension won.
 */
function detectLanguage(doc: vscode.TextDocument): void {
  if (doc.languageId !== "mml" || !config().get<boolean>("detectFromContent", true)) {
    return;
  }
  if (looksLikeY8960Mml(doc.getText())) {
    void vscode.languages.setTextDocumentLanguage(doc, LANGUAGE_ID);
  }
}

function onSave(doc: vscode.TextDocument): void {
  if (doc.languageId !== LANGUAGE_ID || savingForCommand.has(doc.uri.toString())) {
    return;
  }
  if (config().get<boolean>("compileOnSave", false)) {
    void compileDocument(doc);
  }
}

async function activeSource(): Promise<vscode.TextDocument | undefined> {
  const doc = vscode.window.activeTextEditor?.document;
  if (doc === undefined || doc.languageId !== LANGUAGE_ID) {
    void vscode.window.showErrorMessage("Y8960 MML のファイルを開いてから実行してください。");
    return undefined;
  }
  if (doc.isUntitled) {
    void vscode.window.showErrorMessage("y8mmlc はファイルを読むので、先に保存してください。");
    return undefined;
  }
  if (doc.isDirty) {
    const key = doc.uri.toString();
    savingForCommand.add(key);
    try {
      if (!(await doc.save())) {
        return undefined;
      }
    } finally {
      savingForCommand.delete(key);
    }
  }
  return doc;
}

async function compileCommand(): Promise<void> {
  const doc = await activeSource();
  if (doc !== undefined) {
    await compileDocument(doc);
  }
}

async function playCommand(): Promise<void> {
  const doc = await activeSource();
  if (doc !== undefined) {
    await play(doc, config().get<string[]>("playerMute", []));
  }
}

/** The tracks picked last time, per document, to start the next pick from. */
const lastParts = new Map<string, Set<string>>();

async function playPartsCommand(): Promise<void> {
  const doc = await activeSource();
  if (doc === undefined) {
    return;
  }
  const tracks = assignedTracks(doc.getText());
  if (tracks.length === 0) {
    void vscode.window.showErrorMessage("#assign のあるトラックがありません。");
    return;
  }
  const key = doc.uri.toString();
  const last = lastParts.get(key);
  const picked = await vscode.window.showQuickPick(
    tracks.map((t) => ({
      label: t.track,
      description: `${t.device} ${t.channel}`,
      picked: last === undefined || last.has(t.track),
    })),
    { canPickMany: true, title: "鳴らすトラック", placeHolder: "鳴らすトラックを選ぶ" },
  );
  if (picked === undefined || picked.length === 0) {
    return;
  }
  lastParts.set(key, new Set(picked.map((p) => p.label)));
  // "!X" silences everything but X; several of them leave their union playing.
  // The playerMute setting is left out: its own "!" specs would narrow this.
  const mutes = picked.length === tracks.length ? [] : picked.map((p) => `!${p.label}`);
  await play(doc, mutes);
}

async function play(doc: vscode.TextDocument, mutes: readonly string[]): Promise<void> {
  const written = await compileDocument(doc);
  if (written === undefined) {
    return;
  }
  const sequence = written.find((f) => /\.sq$/i.test(f));
  if (sequence === undefined) {
    void vscode.window.showErrorMessage("y8mmlc がシーケンスファイル（.SQ）を書き出していません。");
    return;
  }
  const adpcm = written.find((f) => /\.pc$/i.test(f));
  const tick = config().get<number | null>("playerTick", null);
  const repeat = config().get<number | null>("playerRepeat", null);
  const playerPath = toolPath("playerPath", "y8960player", doc);
  const request = { playerPath, sequence, adpcm, tick: tick ?? undefined, repeat: repeat ?? undefined, mutes };

  output.appendLine(`> ${playerPath} ${playerArgs(request).join(" ")}`);
  try {
    await player.start(
      request,
      (end) => {
        playingItem.hide();
        if (end.stderr.length > 0) {
          output.append(end.stderr);
        }
        if (!end.stopped && end.exitCode !== 0) {
          void vscode.window.showErrorMessage(`y8960player が終了コード ${end.exitCode} で終わりました。`);
          output.show(true);
        }
      },
    );
    playingItem.show();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      void notFound("y8960player", playerPath, "y8960mml.playerPath");
    } else {
      void vscode.window.showErrorMessage(`y8960player を起動できません: ${String(e)}`);
    }
  }
}

/**
 * A bare name is left for the PATH search. A relative path is taken from the
 * workspace folder: the tools run with the source's folder as their working
 * directory, which would otherwise make the same setting point somewhere
 * different for every source.
 */
function toolPath(key: string, fallback: string, doc: vscode.TextDocument): string {
  const raw = config().get<string>(key, fallback).trim() || fallback;
  if (path.isAbsolute(raw) || !/[\\/]/.test(raw)) {
    return raw;
  }
  const folder = vscode.workspace.getWorkspaceFolder(doc.uri) ?? vscode.workspace.workspaceFolders?.[0];
  return folder === undefined ? path.resolve(path.dirname(doc.uri.fsPath), raw) : path.resolve(folder.uri.fsPath, raw);
}

const OPEN_SETTING = "設定を開く";

async function notFound(tool: string, configured: string, setting: string): Promise<void> {
  const choice = await vscode.window.showErrorMessage(
    `${tool} が見つかりません（${configured}）。設定 ${setting} に実行ファイルのパスを入れてください。`,
    OPEN_SETTING,
  );
  if (choice === OPEN_SETTING) {
    await vscode.commands.executeCommand("workbench.action.openSettings", setting);
  }
}

function outDirFor(source: string): string {
  const setting = config().get<string>("outDir", "").trim();
  return setting === "" ? path.dirname(source) : path.resolve(path.dirname(source), setting);
}

/** Returns the files written, or undefined when nothing was. */
async function compileDocument(doc: vscode.TextDocument): Promise<string[] | undefined> {
  const source = doc.uri.fsPath;
  const compilerPath = toolPath("compilerPath", "y8mmlc", doc);
  output.appendLine(`> ${compilerPath} ${path.basename(source)}`);

  let result;
  try {
    result = await compile({ compilerPath, source, outDir: outDirFor(source) });
  } catch (e) {
    void vscode.window.showErrorMessage(`y8mmlc を起動できません: ${String(e)}`);
    return undefined;
  }
  if (result.kind === "notFound") {
    void notFound("y8mmlc", compilerPath, "y8960mml.compilerPath");
    return undefined;
  }

  if (result.stdout.length > 0) {
    output.append(result.stdout);
  }
  if (result.stderr.length > 0) {
    output.append(result.stderr);
  }
  // y8mmlc reads a single MML file, so every diagnostic belongs to it.
  diagnostics.set(doc.uri, result.diagnostics.map((d) => toDiagnostic(doc, d)));

  switch (result.exitCode) {
    case 0:
      vscode.window.setStatusBarMessage(`$(check) ${result.written.map((f) => path.basename(f)).join(", ")}`, 5000);
      return result.written;
    case 1:
      void vscode.window.showErrorMessage(
        "コンパイルに失敗しました。直して走らせ直すと、次の誤りが出ることがあります。",
      );
      if (result.diagnostics.length === 0) {
        output.show(true);
      }
      return undefined;
    default:
      void vscode.window.showErrorMessage(`y8mmlc が終了コード ${result.exitCode} で終わりました。`);
      output.show(true);
      return undefined;
  }
}

function toDiagnostic(doc: vscode.TextDocument, d: CompilerDiagnostic): vscode.Diagnostic {
  const severity = d.severity === "warning" ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
  const diag = new vscode.Diagnostic(rangeOf(doc, d), d.message, severity);
  diag.source = "y8mmlc";
  return diag;
}

function rangeOf(doc: vscode.TextDocument, d: CompilerDiagnostic): vscode.Range {
  if (d.line === undefined || d.line > doc.lineCount) {
    return new vscode.Range(0, 0, 0, 0);
  }
  const line = doc.lineAt(d.line - 1);
  if (d.column === undefined) {
    return line.range.with(line.range.start.with(undefined, line.firstNonWhitespaceCharacterIndex));
  }
  const start = utf8ColumnToUtf16(line.text, d.column);
  const rest = /^\S*/.exec(line.text.slice(start))![0].length;
  return new vscode.Range(line.lineNumber, start, line.lineNumber, start + Math.max(rest, 1));
}
