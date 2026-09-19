import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { parseDiagnostics, parseWrittenFiles, type CompilerDiagnostic } from "./cli.js";

export interface CompileRequest {
  compilerPath: string;
  /** absolute path of the .mml */
  source: string;
  /** absolute folder for the outputs */
  outDir: string;
}

export type CompileResult =
  | {
      kind: "ran";
      exitCode: number;
      diagnostics: CompilerDiagnostic[];
      /** absolute paths of the files written; empty unless exitCode is 0 */
      written: string[];
      stdout: string;
      stderr: string;
    }
  | { kind: "notFound" };

/**
 * Runs y8mmlc from the source's folder with the bare file name. Where y8mmlc's
 * UTF-8 manifest does not take effect (Windows before 1903; inferred from
 * Microsoft's documentation, not tried), it gets its arguments in the ANSI code
 * page; the file name alone keeps the folders above it out of that.
 */
export async function compile(req: CompileRequest): Promise<CompileResult> {
  const cwd = path.dirname(req.source);
  const args = [path.basename(req.source)];
  const sameFolder = path.relative(cwd, req.outDir) === "";
  if (!sameFolder) {
    // y8mmlc does not create the folder; it fails with a line that is none of
    // the diagnostic forms.
    await fs.mkdir(req.outDir, { recursive: true });
    args.push("--out-dir", path.relative(cwd, req.outDir));
  }

  let r: { code: number; stdout: string; stderr: string };
  try {
    r = await run(req.compilerPath, args, cwd);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "notFound" };
    }
    throw e;
  }

  return {
    kind: "ran",
    exitCode: r.code,
    diagnostics: parseDiagnostics(r.stderr),
    written: r.code === 0 ? parseWrittenFiles(r.stdout).map((f) => path.join(req.outDir, f)) : [],
    stdout: r.stdout,
    stderr: r.stderr,
  };
}

function run(file: string, args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err === null) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        const code = (err as NodeJS.ErrnoException).code;
        if (typeof code === "number") {
          resolve({ code, stdout, stderr });
          return;
        }
        reject(err);
      },
    );
  });
}
