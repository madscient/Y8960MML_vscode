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
  | "other";

export interface Token {
  kind: TokenKind;
  /** offsets in the text handed to `tokens` */
  start: number;
  end: number;
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

  digits(): boolean {
    let any = false;
    while (this.peek() !== undefined && this.peek()! >= "0" && this.peek()! <= "9") {
      this.take();
      any = true;
    }
    return any;
  }

  /** A number where one may stand: decimal, $ and two hex digits, or =name;. */
  number(): boolean {
    const c = this.peek();
    if (c === "$") {
      this.take();
      // Two digits and no more: a-f is a note letter as well as a hex digit.
      for (let i = 0; i < 2; i++) {
        const d = this.peek();
        if (d === undefined || !/[0-9a-f]/.test(d)) {
          return true;
        }
        this.take();
      }
      return true;
    }
    if (c === "=") {
      this.take();
      this.until(";");
      return true;
    }
    return this.digits();
  }

  signed(): boolean {
    if (this.peek() === "-" || this.peek() === "+") {
      this.take();
    }
    return this.number();
  }

  /** A length: a number where one is written, then its dots. */
  length(): void {
    this.number();
    while (this.eat(".")) {
      // every dot belongs to the length
    }
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

/** The commands both dialects share, which come before the dialect is looked at. */
function shared(s: Scanner, c: string): TokenKind | undefined {
  switch (c) {
    case "|":
      s.eat(":");
      return "other";
    case ":":
      s.eat("|");
      s.number();
      return "other";
    case "[":
      s.number();
      return "branch";
    case "]":
      return "branch";
    case "(":
      // (*), (DS), (TC), (CODA), (FINE) and (DC), each with a number of its own.
      s.until(")");
      s.number();
      return "branch";
    default:
      return undefined;
  }
}

function melody(s: Scanner, c: string): TokenKind {
  if (NOTE_LETTERS.includes(c)) {
    if (s.peek() === "+" || s.peek() === "#" || s.peek() === "-") {
      s.take();
    }
    s.length();
    return "note";
  }
  switch (c) {
    case "n":
      s.number();
      s.length();
      return "note";
    case "r":
      s.length();
      return "rest";
    case "&":
      return "tie";
    case "~":
      // The cents are there only when something that starts a number follows.
      s.signed();
      return "porta";
    case "x":
      s.until(";");
      return "macro";
    case "@": {
      const d = s.peek();
      if (d === "w") {
        s.take();
        s.length();
        return "wait";
      }
      if (d === "v") {
        s.take();
        s.number();
        return "other";
      }
      if (d === "p") {
        s.take();
        s.signed();
        return "other";
      }
      s.number();
      return "other";
    }
    case "p":
      s.signed();
      return "other";
    case "y":
      s.number();
      if (s.eat(",")) {
        s.number();
        if (s.eat(",")) {
          s.number();
        }
      }
      return "other";
    case "l":
      // Ln takes dots of its own; the others take a plain number.
      s.length();
      return "other";
    case "o":
    case "v":
    case "t":
    case "q":
    case "s":
    case "m":
    case "i":
      s.number();
      return "other";
    case "}":
      s.length();
      return "other";
    default:
      // '>', '<', '{' and anything that is not a command at all.
      return "other";
  }
}

function rhythm(s: Scanner, c: string): TokenKind {
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
    s.length();
    return "note";
  }
  switch (c) {
    case "r":
      s.length();
      return "rest";
    case "x":
      s.until(";");
      return "macro";
    case "@":
      // @V and @A, both with a number.
      if (s.peek() === "v" || s.peek() === "a") {
        s.take();
      }
      s.number();
      return "other";
    case "y":
      s.number();
      if (s.eat(",")) {
        s.number();
        if (s.eat(",")) {
          s.number();
        }
      }
      return "other";
    case "t":
    case "v":
      s.number();
      return "other";
    default:
      return "other";
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
    const kind = shared(s, c) ?? (dialect === "rhythm" ? rhythm(s, c) : melody(s, c));
    out.push({ kind, start, end: s.taken });
  }
}
