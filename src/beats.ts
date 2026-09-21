/**
 * How much time each track line writes.
 *
 * The arithmetic is y8mmlc's, in Y8960MMLCompiler's src/core/mml.cpp: a note
 * that writes n is 192/n ticks with the division truncated, a dot adds half of
 * what was added last, and a note that writes nothing takes the tuplet's share
 * or what Ln last set. Only notes, rests, N and @W take time.
 *
 * What is counted is what the line *writes*, not what it plays: a line inside
 * a repeat counts once. A line whose length cannot be worked out - an unknown
 * name, a tuplet with no '}' - has no total, and neither has any line after it
 * in the same track, because the state carried on from it is unknown too.
 */

import { dialectOf, tokens, type Dialect, type Length, type Token } from "./mml.js";
import { defines, trackViews, type Defines } from "./track.js";

/** A quarter note is 48 ticks and a whole note 192. */
export const TICKS_QUARTER = 48;
const TICKS_WHOLE = TICKS_QUARTER * 4;
/** How deep X name; may nest, as the compiler counts it. */
const MACRO_DEPTH = 8;
const SPACE = " \t\n\r";

export interface LineTicks {
  /** the end of the line in the document, where a hint goes */
  at: number;
  ticks: number;
}

interface State {
  /** what Ln set, 48 (L4) until it does */
  defaultLen: number;
  /** the share of an open tuplet, 0 when none is open */
  tuplet: number;
}

/** Each dot adds half of what the dot before it added. */
function dots(base: number, count: number): number {
  let total = base;
  let add = base;
  for (let i = 0; i < count; i++) {
    add = Math.floor(add / 2);
    total += add;
  }
  return total;
}

/** The ticks a written length comes to, or undefined when it cannot be told. */
function lengthTicks(length: Length | undefined, state: State, defs: Defines): number | undefined {
  if (length === undefined) {
    return undefined;
  }
  if (!length.written) {
    return dots(state.tuplet !== 0 ? state.tuplet : state.defaultLen, length.dots);
  }
  const n = length.name !== undefined ? defs.numbers.get(length.name) : length.value;
  if (n === undefined || n < 0) {
    return undefined;
  }
  if (n === 0) {
    // A length of 0 takes no time, and its dots add nothing to it.
    return 0;
  }
  return dots(Math.floor(TICKS_WHOLE / n), length.dots);
}

/**
 * The share one note of a tuplet gets. The notes are counted the way the
 * compiler counts them: over the raw characters up to the '}', where a-g, n
 * and r each count as one and a '$' takes the two digits after it out of the
 * reckoning. What a name or an X expands to is not looked into.
 */
function tupletShare(
  text: string,
  from: number,
  dialect: Dialect,
  state: State,
  defs: Defines,
): number | undefined {
  let i = from;
  const next = (): string | undefined => {
    while (i < text.length && SPACE.includes(text[i]!)) {
      i++;
    }
    return i < text.length ? text[i++]!.toLowerCase() : undefined;
  };

  let notes = 0;
  let close = -1;
  for (;;) {
    const c = next();
    if (c === undefined || c === "{") {
      return undefined; // no '}' to close it, or a nested '{', which is an error
    }
    if (c === "}") {
      close = i - 1;
      break;
    }
    if (c === "$") {
      next();
      next();
      continue;
    }
    if (c === "n" || c === "r" || (c >= "a" && c <= "g")) {
      notes++;
    }
  }
  if (notes === 0) {
    return undefined;
  }
  // The length written after the '}' is the one the notes divide, and the
  // tuplet is not open yet while it is read.
  const end = tokens(text.slice(close), dialect)[0];
  const total = lengthTicks(end?.length, { defaultLen: state.defaultLen, tuplet: 0 }, defs);
  if (total === undefined) {
    return undefined;
  }
  const share = Math.floor(total / notes);
  // Under two ticks is what the compiler refuses.
  return share < 2 ? undefined : share;
}

function macroName(token: Token, text: string): string {
  return [...text.slice(token.start + 1, token.end)].filter((c) => !SPACE.includes(c) && c !== ";").join("");
}

/** What one token adds to its line, with the state it leaves behind. */
function ticksOf(
  token: Token,
  text: string,
  dialect: Dialect,
  state: State,
  defs: Defines,
  depth: number,
): number | undefined {
  switch (token.kind) {
    case "note":
    case "rest":
    case "wait":
      return lengthTicks(token.length, state, defs);
    case "setLength": {
      const set = lengthTicks(token.length, { defaultLen: state.defaultLen, tuplet: 0 }, defs);
      if (set === undefined || set === 0) {
        return undefined; // Ln takes a number, and 0 is not one of them
      }
      state.defaultLen = set;
      return 0;
    }
    case "tupletStart": {
      const share = tupletShare(text, token.end, dialect, state, defs);
      if (share === undefined) {
        return undefined;
      }
      state.tuplet = share;
      return 0;
    }
    case "tupletEnd":
      state.tuplet = 0;
      return 0;
    case "macro": {
      const body = defs.strings.get(macroName(token, text));
      if (body === undefined || depth >= MACRO_DEPTH) {
        return undefined;
      }
      let total = 0;
      for (const inner of tokens(body, dialect)) {
        const n = ticksOf(inner, body, dialect, state, defs, depth + 1);
        if (n === undefined) {
          return undefined;
        }
        total += n;
      }
      return total;
    }
    default:
      return 0;
  }
}

/** The ticks each track line writes, in the order the lines come. */
export function lineTicks(source: string): LineTicks[] {
  const defs = defines(source);
  const out: LineTicks[] = [];
  for (const view of trackViews(source)) {
    const dialect = dialectOf(view.channel);
    const state: State = { defaultLen: TICKS_QUARTER, tuplet: 0 };
    const sums = view.lines.map(() => 0);
    let line = 0;
    let lost = -1;
    for (const token of tokens(view.text, dialect)) {
      while (line + 1 < view.lines.length && token.start >= view.lines[line + 1]!.from) {
        line++;
      }
      const n = ticksOf(token, view.text, dialect, state, defs, 0);
      if (n === undefined) {
        lost = line;
        break;
      }
      sums[line] += n;
    }
    view.lines.forEach((l, i) => {
      if (lost < 0 || i < lost) {
        out.push({ at: l.at, ticks: sums[i]! });
      }
    });
  }
  return out;
}
