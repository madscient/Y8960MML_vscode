/**
 * Splitting a track's MML into tokens.
 *
 * This follows y8mmlc's own reading, in Y8960MMLCompiler's src/core/mml.cpp:
 * whitespace is skipped everywhere, the line breaks between a track's lines
 * included, so a note and its length need not touch. Numbers are decimal, or
 * '$' and exactly two hexadecimal digits, or '=name;'. What each command takes
 * after it is what decides where the next one begins.
 *
 * Nothing here reports an error. The text is read while it is being written,
 * so anything that does not parse becomes a one-character "other" token and
 * the reading goes on.
 */

export type Dialect = "melody" | "adpcm" | "rhythm";

/**
 * Channels 9 and 10 are the ADPCM and rhythm ones wherever they exist, so the
 * channel alone tells the dialect and the device table stays with the compiler.
 */
export function dialectOf(channel: string | undefined): Dialect {
  switch (Number(channel)) {
    case 9:
      return "adpcm";
    case 10:
      return "rhythm";
    default:
      return "melody";
  }
}

export type TokenKind =
  /** a note: a letter, N, or a run of rhythm instruments */
  | "note"
  | "rest"
  /** @W, which takes time without starting a note */
  | "wait"
  /** & */
  | "tie"
  /** ~ with its cents, if it wrote any */
  | "porta"
  /** X name; -- what it expands to is not read here */
  | "macro"
  /** a block or a bracketed mark: what plays next is not what is written next */
  | "branch"
  /** Ln, which sets the length of the notes that write none */
  | "setLength"
  | "tupletStart"
  | "tupletEnd"
  | "other";

/** The length written after a note, a rest, @W, Ln or a tuplet's '}'. */
export interface Length {
  /** the number, when a plain one was written */
  value: number | undefined;
  /** the name of the =name; that stands for the number */
  name: string | undefined;
  dots: number;
  /** false when no number was written, so the default length applies */
  written: boolean;
}

export interface Token {
  kind: TokenKind;
  /** offsets in the text handed to `tokens` */
  start: number;
  end: number;
  /** what this one wrote for its length, when it takes one */
  length?: Length;
}

/** What a place where a number may stand held, or undefined when none did. */
interface Written {
  value: number | undefined;
  name: string | undefined;
}

const SPACE = " \t\n\r";

class Scanner {
  /** just past the last character taken, which is where a token ends */
  taken = 0;
  private pos = 0;

  constructor(private readonly text: string) {}

  /** Where the next character to read is, past any whitespace. */
  at(): number {
    while (this.pos < this.text.length && SPACE.includes(this.text[this.pos]!)) {
      this.pos++;
    }
    return this.pos;
  }

  /** The next character, lowercased as the compiler reads it. */
  peek(): string | undefined {
    const at = this.at();
    return at < this.text.length ? this.text[at]!.toLowerCase() : undefined;
  }

  take(): string | undefined {
    const c = this.peek();
    if (c !== undefined) {
      this.pos++;
      this.taken = this.pos;
    }
    return c;
  }

  /** Takes `c` if it is next. */
  eat(c: string): boolean {
    if (this.peek() !== c) {
      return false;
    }
    this.take();
    return true;
  }

  private digits(): number | undefined {
    let value: number | undefined;
    for (;;) {
      const c = this.peek();
      if (c === undefined || c < "0" || c > "9") {
        return value;
      }
      this.take();
      value = (value ?? 0) * 10 + Number(c);
    }
  }

  /** A number where one may stand: decimal, $ and two hex digits, or =name;. */
  number(): Written | undefined {
    const c = this.peek();
    if (c === "$") {
      this.take();
      // Two digits and no more: a-f is a note letter as well as a hex digit.
      let value = 0;
      for (let i = 0; i < 2; i++) {
        const d = this.peek();
        if (d === undefined || !/[0-9a-f]/.test(d)) {
          return { value, name: undefined };
        }
        this.take();
        value = value * 16 + parseInt(d, 16);
      }
      return { value, name: undefined };
    }
    if (c === "=") {
      this.take();
      const from = this.taken;
      this.until(";");
      // Whitespace is skipped inside a name as it is anywhere else.
      const name = [...this.slice(from, this.taken)]
        .filter((ch) => !SPACE.includes(ch) && ch !== ";")
        .join("");
      return { value: undefined, name };
    }
    const value = this.digits();
    return value === undefined ? undefined : { value, name: undefined };
  }

  signed(): Written | undefined {
    const negative = this.peek() === "-";
    if (negative || this.peek() === "+") {
      this.take();
    }
    const n = this.number();
    return n !== undefined && negative && n.value !== undefined ? { ...n, value: -n.value } : n;
  }

  /** A length: a number where one is written, then its dots. */
  length(): Length {
    const n = this.number();
    let dots = 0;
    while (this.eat(".")) {
      dots++;
    }
    return { value: n?.value, name: n?.name, dots, written: n !== undefined };
  }

  slice(from: number, to: number): string {
    return this.text.slice(from, to);
  }

  /** Takes everything up to and including `end`, or to the text's end. */
  until(end: string): void {
    while (this.peek() !== undefined && this.peek() !== end) {
      this.take();
    }
    this.eat(end);
  }
}

const NOTE_LETTERS = "abcdefg";
const RHYTHM_LETTERS = "bsmch";

/** What one command came to: its kind, and the length it wrote if it takes one. */
interface Parsed {
  kind: TokenKind;
  length?: Length;
}

/** The commands both dialects share, which come before the dialect is looked at. */
function shared(s: Scanner, c: string): Parsed | undefined {
  switch (c) {
    case "|":
      s.eat(":");
      return { kind: "other" };
    case ":":
      s.eat("|");
      s.number();
      return { kind: "other" };
    case "[":
      s.number();
      return { kind: "branch" };
    case "]":
      return { kind: "branch" };
    case "(":
      // (*), (DS), (TC), (CODA), (FINE) and (DC), each with a number of its own.
      s.until(")");
      s.number();
      return { kind: "branch" };
    default:
      return undefined;
  }
}

function melody(s: Scanner, c: string): Parsed {
  if (NOTE_LETTERS.includes(c)) {
    if (s.peek() === "+" || s.peek() === "#" || s.peek() === "-") {
      s.take();
    }
    return { kind: "note", length: s.length() };
  }
  switch (c) {
    case "n":
      s.number();
      return { kind: "note", length: s.length() };
    case "r":
      return { kind: "rest", length: s.length() };
    case "&":
      return { kind: "tie" };
    case "~":
      // The cents are there only when something that starts a number follows.
      s.signed();
      return { kind: "porta" };
    case "x":
      s.until(";");
      return { kind: "macro" };
    case "@": {
      const d = s.peek();
      if (d === "w") {
        s.take();
        return { kind: "wait", length: s.length() };
      }
      if (d === "v") {
        s.take();
        s.number();
        return { kind: "other" };
      }
      if (d === "p") {
        s.take();
        s.signed();
        return { kind: "other" };
      }
      s.number();
      return { kind: "other" };
    }
    case "p":
      s.signed();
      return { kind: "other" };
    case "y":
      s.number();
      if (s.eat(",")) {
        s.number();
        if (s.eat(",")) {
          s.number();
        }
      }
      return { kind: "other" };
    case "l":
      // Ln takes dots of its own; the others take a plain number.
      return { kind: "setLength", length: s.length() };
    case "o":
    case "v":
    case "t":
    case "q":
    case "s":
    case "m":
    case "i":
      s.number();
      return { kind: "other" };
    case "{":
      return { kind: "tupletStart" };
    case "}":
      return { kind: "tupletEnd", length: s.length() };
    default:
      // The octave steps and anything that is not a command at all.
      return { kind: "other" };
  }
}

function rhythm(s: Scanner, c: string): Parsed {
  if (RHYTHM_LETTERS.includes(c)) {
    // A run of instruments, each able to carry '!', and one length for them all.
    for (;;) {
      s.eat("!");
      const d = s.peek();
      if (d === undefined || !RHYTHM_LETTERS.includes(d)) {
        break;
      }
      s.take();
    }
    return { kind: "note", length: s.length() };
  }
  switch (c) {
    case "r":
      return { kind: "rest", length: s.length() };
    case "x":
      s.until(";");
      return { kind: "macro" };
    case "@":
      // @V and @A, both with a number.
      if (s.peek() === "v" || s.peek() === "a") {
        s.take();
      }
      s.number();
      return { kind: "other" };
    case "y":
      s.number();
      if (s.eat(",")) {
        s.number();
        if (s.eat(",")) {
          s.number();
        }
      }
      return { kind: "other" };
    case "t":
    case "v":
      s.number();
      return { kind: "other" };
    default:
      return { kind: "other" };
  }
}

export function tokens(text: string, dialect: Dialect): Token[] {
  const s = new Scanner(text);
  const out: Token[] = [];
  for (;;) {
    const start = s.at();
    const c = s.take();
    if (c === undefined) {
      return out;
    }
    const parsed = shared(s, c) ?? (dialect === "rhythm" ? rhythm(s, c) : melody(s, c));
    out.push({ kind: parsed.kind, start, end: s.taken, ...(parsed.length && { length: parsed.length }) });
  }
}
