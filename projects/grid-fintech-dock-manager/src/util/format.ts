import {
  formatCompact,
  formatMoney,
  formatPrice,
  formatShortClock,
  formatSigned,
  formatSignedMoney,
  formatSignedPct,
  formatSince,
} from "./finance.js";

// Template-facing formatters. Each one accepts a missing value and renders it
// as an em dash, so a pane can bind a quote that has not arrived yet.

/** What a missing figure reads as. */
const MISSING = "\u2014";

/** `plain` -> `+1.23`, `pct` -> `+1.23%`, `money` -> `+$1.23`. */
export type SignedFormat = "plain" | "pct" | "money";

export function price(value: number | null | undefined, digits = 2): string {
  return value == null ? MISSING : formatPrice(value, digits);
}

export function money(value: number | null | undefined): string {
  return value == null ? MISSING : formatMoney(value);
}

export function signed(value: number | null | undefined, format: SignedFormat = "plain"): string {
  if (value == null) {
    return MISSING;
  }

  switch (format) {
    case "pct":
      return formatSignedPct(value);
    case "money":
      return formatSignedMoney(value);
    default:
      return formatSigned(value);
  }
}

export function compact(value: number | null | undefined, digits = 2): string {
  return value == null ? MISSING : formatCompact(value, digits);
}

export function shortClock(value: Date | null | undefined): string {
  return value ? formatShortClock(value) : MISSING;
}

/** Relative timestamp against an explicit, ticking `now`. */
export function since(value: Date | null | undefined, now: number): string {
  return value ? formatSince(value, now) : MISSING;
}
