/**
 * What the extension reads from y8mmlc's output. Only the order of the fields
 * is relied on; the message text may change between compiler versions.
 */

export interface CompilerDiagnostic {
  severity: "error" | "warning";
  /** 1-based; undefined when the diagnostic is about the whole file */
  line: number | undefined;
  /** 1-based, counted in UTF-8 bytes */
  column: number | undefined;
  message: string;
}

// The path is not captured: y8mmlc reads a single MML file, so every
// diagnostic is about it. The lazy path makes "D:\x.mml:1:19" split at the
// first place the rest can match.
const DIAGNOSTIC = /^.+?(?::(\d+)(?::(\d+))?)?: (error|warning): (.*)$/;

export function parseDiagnostics(stderr: string): CompilerDiagnostic[] {
  const out: CompilerDiagnostic[] = [];
  for (const raw of stderr.split(/\r?\n/)) {
    const m = DIAGNOSTIC.exec(raw);
    if (m === null) {
      continue;
    }
    out.push({
      severity: m[3] as "error" | "warning",
      line: m[1] === undefined ? undefined : Number(m[1]),
      column: m[2] === undefined ? undefined : Number(m[2]),
      message: m[4]!,
    });
  }
  return out;
}

/**
 * The file names of what a successful run wrote. Only the last path component
 * is taken; the caller knows the folder, and the path y8mmlc prints is
 * relative to wherever it was run.
 */
export function parseWrittenFiles(stdout: string): string[] {
  const out: string[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const m = /^(.+) \(\d+ bytes\)$/.exec(raw);
    if (m === null) {
      continue;
    }
    const parts = m[1]!.split(/[\\/]/);
    out.push(parts[parts.length - 1]!);
  }
  return out;
}

/**
 * Converts y8mmlc's 1-based UTF-8 byte column into a 0-based UTF-16 offset in
 * `lineText`. A column that falls inside a character lands on its start; one
 * past the end lands at the end.
 */
export function utf8ColumnToUtf16(lineText: string, column: number): number {
  let bytes = 0;
  let offset = 0;
  const target = column - 1;
  for (const ch of lineText) {
    const cp = ch.codePointAt(0)!;
    const width = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + width > target) {
      return offset;
    }
    bytes += width;
    offset += ch.length;
  }
  return offset;
}

/** True when the text carries a line only Y8960 MML has. */
export function looksLikeY8960Mml(text: string): boolean {
  // The meta command's name ignores case but the track name does not.
  return /^#[Aa][Ss][Ss][Ii][Gg][Nn][ \t]+[A-P][ \t]/m.test(text);
}
