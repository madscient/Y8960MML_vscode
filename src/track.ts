/**
 * The line structure of an MML source and the edits the track commands make.
 *
 * The rules followed here are y8mmlc's, in Y8960MMLCompiler's
 * doc/mml-source.md: a line's kind comes from its first character, a trailing
 * '\' joins the next line before the kind is decided, and each physical line
 * loses its trailing spaces first. Devices and channels are taken as written;
 * which ones exist is the compiler's to know.
 */

/** A replacement in the document's text, by offset. Edits never overlap. */
export interface Edit {
  start: number;
  end: number;
  text: string;
}

export interface TrackSummary {
  track: string;
  /** undefined when the track has no #assign */
  device: string | undefined;
  channel: string | undefined;
  /** how many track lines the source gives it */
  lines: number;
}

const TRACK_NAMES = "ABCDEFGHIJKLMNOP";

function isSpace(c: string): boolean {
  return c === " " || c === "\t";
}

/** A physical line: [start, end) is its text, `next` where the following one begins. */
interface Physical {
  start: number;
  end: number;
  next: number;
}

/**
 * A line as the compiler sees it. `text` is the physical lines joined, so an
 * offset in it is not an offset in the document: `pieces` holds where each
 * part came from, and the '\' and the line break between them are not in it.
 */
interface LogicalLine {
  text: string;
  pieces: Physical[];
  /** where the line begins in the document */
  start: number;
  /** the end of the last physical line, before its line break */
  rawEnd: number;
  /** where the next logical line begins, past the line break */
  next: number;
}

function physicalLines(text: string): Physical[] {
  const out: Physical[] = [];
  let pos = 0;
  for (;;) {
    const nl = text.indexOf("\n", pos);
    if (nl < 0) {
      out.push({ start: pos, end: text.length, next: text.length });
      return out;
    }
    out.push({ start: pos, end: nl > pos && text[nl - 1] === "\r" ? nl - 1 : nl, next: nl + 1 });
    pos = nl + 1;
  }
}

function logicalLines(text: string): LogicalLine[] {
  const physical = physicalLines(text);
  const out: LogicalLine[] = [];
  for (let n = 0; n < physical.length; ) {
    const pieces: Physical[] = [];
    let joined = "";
    let last = physical[n]!;
    for (;;) {
      const p = physical[n]!;
      let end = p.end;
      while (end > p.start && isSpace(text[end - 1]!)) {
        end--;
      }
      const joins = end > p.start && text[end - 1] === "\\";
      if (joins) {
        end--;
      }
      pieces.push({ start: p.start, end, next: p.next });
      joined += text.slice(p.start, end);
      last = p;
      n++;
      if (!joins || n >= physical.length) {
        break;
      }
    }
    out.push({ text: joined, pieces, start: pieces[0]!.start, rawEnd: last.end, next: last.next });
  }
  return out;
}

/** Where an offset in a logical line's text sits in the document. */
function offsetAt(line: LogicalLine, i: number): number {
  let rest = i;
  for (const piece of line.pieces) {
    const length = piece.end - piece.start;
    if (rest < length) {
      return piece.start + rest;
    }
    rest -= length;
  }
  return line.rawEnd;
}

interface Word {
  text: string;
  offset: number;
}

function words(s: string, from: number): Word[] {
  const out: Word[] = [];
  let i = from;
  while (i < s.length) {
    while (i < s.length && isSpace(s[i]!)) {
      i++;
    }
    if (i >= s.length) {
      break;
    }
    const start = i;
    while (i < s.length && !isSpace(s[i]!)) {
      i++;
    }
    out.push({ text: s.slice(start, i), offset: start });
  }
  return out;
}

interface TrackSource {
  /** every #assign naming the track; a second one is the compiler's error to report */
  assigns: Array<{ line: LogicalLine; nameOffset: number }>;
  device: string | undefined;
  channel: string | undefined;
  lines: LogicalLine[];
}

/** The tracks the source names, by track name. A track missing here is unused. */
function readTracks(text: string): Map<string, TrackSource> {
  const tracks = new Map<string, TrackSource>();
  const of = (name: string): TrackSource => {
    let t = tracks.get(name);
    if (t === undefined) {
      t = { assigns: [], device: undefined, channel: undefined, lines: [] };
      tracks.set(name, t);
    }
    return t;
  };

  for (const line of logicalLines(text)) {
    const head = line.text[0];
    if (head === undefined || head === ";") {
      continue;
    }
    if (head === "#") {
      const w = words(line.text, 1);
      if (w.length !== 4 || w[0]!.text.toLowerCase() !== "assign") {
        continue;
      }
      const name = w[1]!.text;
      if (name.length !== 1 || !TRACK_NAMES.includes(name)) {
        continue;
      }
      const t = of(name);
      t.assigns.push({ line, nameOffset: w[1]!.offset });
      if (t.device === undefined) {
        t.device = w[2]!.text;
        t.channel = w[3]!.text;
      }
      continue;
    }
    if (TRACK_NAMES.includes(head) && (line.text.length === 1 || isSpace(line.text[1]!))) {
      of(head).lines.push(line);
    }
  }
  return tracks;
}

/** The tracks the source names, in track order. */
export function trackSummaries(text: string): TrackSummary[] {
  const tracks = readTracks(text);
  const out: TrackSummary[] = [];
  for (const name of TRACK_NAMES) {
    const t = tracks.get(name);
    if (t !== undefined) {
      out.push({ track: name, device: t.device, channel: t.channel, lines: t.lines.length });
    }
  }
  return out;
}

/** The track names with neither an #assign nor a track line. */
export function unusedTracks(text: string): string[] {
  const tracks = readTracks(text);
  return [...TRACK_NAMES].filter((name) => !tracks.has(name));
}

function byStart(a: Edit, b: Edit): number {
  return a.start - b.start;
}

/** Renames a track in its #assign and in every track line it has. */
export function renameTrack(text: string, from: string, to: string): Edit[] {
  const t = readTracks(text).get(from);
  if (t === undefined) {
    return [];
  }
  const edits: Edit[] = [];
  // A track name is one character, so no replacement can straddle a '\' join.
  for (const assign of t.assigns) {
    const at = offsetAt(assign.line, assign.nameOffset);
    edits.push({ start: at, end: at + 1, text: to });
  }
  for (const line of t.lines) {
    const at = offsetAt(line, 0);
    edits.push({ start: at, end: at + 1, text: to });
  }
  return edits.sort(byStart);
}

/**
 * Copies a track's MML lines under themselves, renamed. The #assign is left
 * out: a device channel takes one track, so a copied assignment would not
 * compile.
 */
export function duplicateTrack(text: string, from: string, to: string): Edit[] {
  const t = readTracks(text).get(from);
  if (t === undefined) {
    return [];
  }
  const fallbackEol = text.includes("\r\n") ? "\r\n" : "\n";
  const edits: Edit[] = [];
  for (const line of t.lines) {
    const head = offsetAt(line, 0) - line.start;
    const raw = text.slice(line.start, line.rawEnd);
    const copy = raw.slice(0, head) + to + raw.slice(head + 1);
    if (line.next > line.rawEnd) {
      edits.push({ start: line.next, end: line.next, text: copy + text.slice(line.rawEnd, line.next) });
    } else {
      // The last line of a file that does not end with a line break.
      edits.push({ start: text.length, end: text.length, text: fallbackEol + copy });
    }
  }
  return edits.sort(byStart);
}

/** Removes a track's #assign and all of its track lines, whole lines at a time. */
export function deleteTrack(text: string, track: string): Edit[] {
  const t = readTracks(text).get(track);
  if (t === undefined) {
    return [];
  }
  const lines = [...t.assigns.map((a) => a.line), ...t.lines];
  return lines.map((line) => ({ start: line.start, end: line.next, text: "" })).sort(byStart);
}

/** A piece of a track's MML and where it came from in the document. */
export interface ViewPiece {
  /** where the piece begins in the view's text */
  at: number;
  start: number;
  end: number;
}

/**
 * A track's MML as the compiler reads it: the MML of its lines run together.
 * The compiler puts a '\n' between the lines, which its reader treats as any
 * other whitespace, so a note on one line and its length on the next still
 * make one note.
 */
/** Where one track line sits in the view, and where that line ends in the document. */
export interface ViewLine {
  /** the line's MML in the view's text */
  from: number;
  to: number;
  /** the end of the line in the document, past its last character */
  at: number;
}

export interface TrackView {
  track: string;
  channel: string | undefined;
  text: string;
  pieces: ViewPiece[];
  lines: ViewLine[];
}

/** The document spans of a logical line from `from` in its text onwards. */
function spansFrom(line: LogicalLine, from: number): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let seen = 0;
  for (const piece of line.pieces) {
    const length = piece.end - piece.start;
    if (seen + length > from) {
      out.push({ start: piece.start + Math.max(0, from - seen), end: piece.end });
    }
    seen += length;
  }
  return out;
}

export function trackViews(source: string): TrackView[] {
  const tracks = readTracks(source);
  const out: TrackView[] = [];
  for (const name of TRACK_NAMES) {
    const t = tracks.get(name);
    if (t === undefined) {
      continue;
    }
    const pieces: ViewPiece[] = [];
    const lines: ViewLine[] = [];
    let text = "";
    for (const line of t.lines) {
      if (text.length > 0) {
        text += "\n";
      }
      const from = text.length;
      // The track name and the whitespace after it are not part of the MML.
      let mml = 1;
      while (mml < line.text.length && isSpace(line.text[mml]!)) {
        mml++;
      }
      for (const span of spansFrom(line, mml)) {
        pieces.push({ at: text.length, start: span.start, end: span.end });
        text += source.slice(span.start, span.end);
      }
      lines.push({ from, to: text.length, at: line.rawEnd });
    }
    out.push({ track: name, channel: t.channel, text, pieces, lines });
  }
  return out;
}

/** Where an offset in the view's text sits in the document. */
export function documentOffset(view: TrackView, at: number): number {
  let last = 0;
  for (const piece of view.pieces) {
    const length = piece.end - piece.start;
    if (at < piece.at + length) {
      return piece.start + Math.max(0, at - piece.at);
    }
    last = piece.end;
  }
  return last;
}

/**
 * The document spans a range of the view's text covers. A range that a '\'
 * continuation split comes back as more than one span, so an edit leaves the
 * backslash and the line break where they are.
 */
export function documentSpans(view: TrackView, start: number, end: number): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (const piece of view.pieces) {
    const length = piece.end - piece.start;
    const from = Math.max(start, piece.at);
    const to = Math.min(end, piece.at + length);
    if (from < to) {
      out.push({ start: piece.start + (from - piece.at), end: piece.start + (to - piece.at) });
    }
  }
  return out;
}

/** What the #define lines named: a number, or a piece of MML. */
export interface Defines {
  numbers: Map<string, number>;
  strings: Map<string, string>;
}

function isMacroName(name: string): boolean {
  return /^[A-Za-z][0-9A-Za-z_]*$/.test(name);
}

/**
 * The names the source defines. The first definition of a name wins, as it
 * does in the compiler, where a second one is an error.
 */
export function defines(source: string): Defines {
  const numbers = new Map<string, number>();
  const strings = new Map<string, string>();
  for (const line of logicalLines(source)) {
    if (line.text[0] !== "#") {
      continue;
    }
    const w = words(line.text, 1);
    if (w.length < 3 || w[0]!.text.toLowerCase() !== "define") {
      continue;
    }
    const name = w[1]!.text;
    if (!isMacroName(name) || numbers.has(name) || strings.has(name)) {
      continue;
    }
    // A "..." value runs to the last quote on the line; anything else is a number.
    const rest = line.text.slice(w[1]!.offset + name.length);
    const open = rest.indexOf('"');
    const close = rest.lastIndexOf('"');
    if (open >= 0 && close > open && rest.slice(0, open).trim() === "") {
      strings.set(name, rest.slice(open + 1, close));
    } else if (w.length === 3 && /^[-+]?[0-9]+$/.test(w[2]!.text)) {
      numbers.set(name, Number(w[2]!.text));
    }
  }
  return { numbers, strings };
}
