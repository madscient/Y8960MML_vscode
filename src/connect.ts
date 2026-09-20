/**
 * Joining the notes of a selection with '&' or '~', and taking those away.
 *
 * '&' goes between two notes and '~' in front of the second one, so both are
 * written just before the note they reach: the one the compiler reads next.
 */

import { dialectOf, tokens } from "./mml.js";
import { documentOffset, documentSpans, trackViews, type Edit, type TrackView } from "./track.js";

/** Tie and legato are both '&'; which one it is depends on the two pitches. */
export type Link = "tie" | "porta";

/** A span of the document, as a selection gives it. */
export interface Range {
  start: number;
  end: number;
}

export interface LinkResult {
  edits: Edit[];
  /** rhythm tracks the selection covered, which have neither '&' nor '~' */
  rhythm: string[];
}

function selects(ranges: readonly Range[], at: number): boolean {
  return ranges.some((r) => at >= r.start && at < r.end);
}

function byStart(a: Edit, b: Edit): number {
  return a.start - b.start;
}

function views(source: string, ranges: readonly Range[]): TrackView[] {
  // A track whose MML is nowhere near the selection has nothing to give.
  return trackViews(source).filter((v) =>
    v.pieces.some((p) => ranges.some((r) => p.start < r.end && r.start < p.end)),
  );
}

/**
 * Writes `link` between the notes of the selection. A pair already joined
 * either way is left alone. The chain breaks at a rest or an @W (both take
 * time of their own), at an X name; (what it ends with is not in this text)
 * and at a block or a bracketed mark, where the note written next is not the
 * note that sounds next.
 */
export function linkNotes(source: string, ranges: readonly Range[], link: Link): LinkResult {
  const edits: Edit[] = [];
  const rhythm: string[] = [];
  for (const view of views(source, ranges)) {
    const dialect = dialectOf(view.channel);
    if (dialect === "rhythm") {
      rhythm.push(view.track);
      continue;
    }
    let previous = false;
    let joined = false;
    for (const token of tokens(view.text, dialect)) {
      const at = documentOffset(view, token.start);
      const picked = selects(ranges, at);
      switch (token.kind) {
        case "note":
          if (picked && previous && !joined) {
            edits.push({ start: at, end: at, text: link === "tie" ? "&" : "~" });
          }
          previous = picked;
          joined = false;
          break;
        case "rest":
        case "wait":
        case "macro":
        case "branch":
          previous = false;
          joined = false;
          break;
        case "tie":
        case "porta":
          joined = true;
          break;
        default:
          break;
      }
    }
  }
  return { edits: edits.sort(byStart), rhythm };
}

/** Takes the '&' or the '~' of the selection away, a whole token at a time. */
export function unlinkNotes(source: string, ranges: readonly Range[], link: Link): LinkResult {
  const edits: Edit[] = [];
  for (const view of views(source, ranges)) {
    const dialect = dialectOf(view.channel);
    for (const token of tokens(view.text, dialect)) {
      if (token.kind !== link || !selects(ranges, documentOffset(view, token.start))) {
        continue;
      }
      for (const span of documentSpans(view, token.start, token.end)) {
        edits.push({ start: span.start, end: span.end, text: "" });
      }
    }
  }
  return { edits: edits.sort(byStart), rhythm: [] };
}
