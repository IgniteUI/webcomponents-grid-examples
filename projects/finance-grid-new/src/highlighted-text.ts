import { html, type TemplateResult } from "lit";

/** One run of the source text, flagged if the query matched it. */
interface TextSegment {
  text: string;
  hit: boolean;
}

/**
 * Text with every occurrence of a query marked.
 *
 * The grid ships a search of its own (`findNext`/`findPrev`), but it highlights **default cell
 * templates only**, and every column in this sample renders through a template. Its match cache
 * is also built per *column field*, so it could never mark the company name: that text comes
 * from `company`, which the Asset column renders but does not bind to.
 *
 * Marking the segments here instead keeps the highlight and the toolbar filter driven by exactly
 * the same comparison, so what lights up is precisely what kept the row on screen.
 */
export function highlightedText(text: string, query: string): TemplateResult {
  return html`${splitOnMatches(text, query).map((segment) =>
    segment.hit ? html`<mark class="search-hit">${segment.text}</mark>` : html`<span>${segment.text}</span>`
  )}`;
}

/**
 * Splits `text` into alternating plain and matching runs.
 *
 * Case-insensitive, and it walks the string rather than building a `RegExp`, so a query like
 * `C++` or `(` is matched literally instead of throwing.
 */
export function splitOnMatches(text: string, query: string): TextSegment[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [{ text, hit: false }];
  }

  const haystack = text.toLowerCase();
  const segments: TextSegment[] = [];
  let cursor = 0;
  let match = haystack.indexOf(needle);

  while (match !== -1) {
    if (match > cursor) {
      segments.push({ text: text.slice(cursor, match), hit: false });
    }

    segments.push({ text: text.slice(match, match + needle.length), hit: true });
    cursor = match + needle.length;
    match = haystack.indexOf(needle, cursor);
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), hit: false });
  }

  return segments;
}
