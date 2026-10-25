import type { IgcChipComponent, IgcLinearProgressComponent } from "igniteui-webcomponents";

type ChipVariant = NonNullable<IgcChipComponent["variant"]>;
type BarVariant = IgcLinearProgressComponent["variant"];

/** Year length the elapsed figure is expressed in. */
const DAYS_PER_YEAR = 365;

/**
 * The line the tax code draws through a portfolio.
 *
 * A position held longer than a year is taxed as a long-term gain rather than at the income
 * rate, which makes this the most consequential thing about a holding after its P&L, and the
 * one thing none of the other columns can say. A $3,074 gain two days old and the same gain two
 * years old are not worth the same money.
 *
 * A day past the year, not the year itself: the rule is "held *more* than one year", so a
 * position at exactly 365 days is still short-term and the day after is the one that counts.
 * Two of the seeded rows sit on 365 precisely, which makes them the column's most interesting
 * cells rather than a rounding question: they read "1 day to long-term treatment".
 */
const LONG_TERM_DAYS = DAYS_PER_YEAR + 1;

/** A fill below this share of a rounded 10px track renders as a dot rather than a bar. */
const MIN_BAR_VALUE = 6;

/** How one row's holding period reads: a tag, a figure, and progress to the line. */
export interface HoldingTerm {
  label: string;
  variant: ChipVariant;

  /** Elapsed period in the shortest honest form: `1y 287d`, or `94d`. */
  elapsed: string;

  /** Progress toward `LONG_TERM_DAYS` as a 0-100 value for the progress bar. */
  progressValue: number;

  /** The bar's colour keyword: the same two states the tag above it carries. */
  barVariant: BarVariant;

  /** What the tag and the bar convey, for anything that cannot see either. */
  hint: string;
}

/** Sparkline brushes per appearance. The chart paints to a canvas and cannot read a `var()`. */
const SPARKLINE_BRUSHES = {
  light: { up: "#1a9b62", down: "#d33a75" },
  dark: { up: "#34d399", down: "#ff7aae" },
} as const;

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const percentFormatter = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

export function formatPercent(value: number): string {
  return `${percentFormatter.format(Math.abs(value))}%`;
}

/** A signed percentage with its direction as an arrow. */
export function badgeLabel(value: number): string {
  const arrow = value > 0 ? "\u2191 " : value < 0 ? "\u2193 " : "";
  return `${arrow}${formatPercent(value)}`;
}

/** The chip variant for a signed figure. */
export function chipVariant(value: number): ChipVariant {
  if (value > 0) return "success";
  if (value < 0) return "danger";
  return "info";
}

/** The first two letters of the ticker, which is all the avatar has room for. */
export function avatarInitials(ticker: string): string {
  const normalized = ticker.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  return normalized.slice(0, 2) || "EQ";
}

/**
 * One row's holding period, resolved in a single call: the cell needs the tag, the figure, the
 * bar and the spoken description, and they all follow from the same day count.
 */
export function holdingTerm(days: number): HoldingTerm {
  const held = Math.max(0, Math.trunc(days));
  const isLongTerm = held >= LONG_TERM_DAYS;
  const years = Math.floor(held / DAYS_PER_YEAR);
  const remainder = held % DAYS_PER_YEAR;
  const remaining = LONG_TERM_DAYS - held;

  // Short holdings get a visible floor instead of a stray pixel, the same one `allocationBarValue`
  // uses. Zero stays zero: a position opened today has not started counting, and a bar that says
  // it has is worse than an empty one.
  const scaled = held > 0 ? Math.min(100, Math.max(MIN_BAR_VALUE, (held / LONG_TERM_DAYS) * 100)) : 0;

  return {
    label: isLongTerm ? "LONG TERM" : "SHORT TERM",

    // Not `danger` for the short-term case: holding a position under a year is an ordinary state,
    // not a fault. `info` reads as "noted", which is all this is until the position crosses over.
    variant: isLongTerm ? "success" : "info",

    // `1y` rather than `1y 0d` on the anniversary: a trailing zero reads as a measurement that
    // stopped short.
    elapsed: years > 0 ? (remainder > 0 ? `${years}y ${remainder}d` : `${years}y`) : `${held}d`,

    progressValue: scaled,
    barVariant: isLongTerm ? "success" : "info",
    hint: isLongTerm
      ? "Long term \u2014 gains taxed at the long-term rate"
      : `Short term \u2014 ${remaining} ${remaining === 1 ? "day" : "days"} to long-term treatment`,
  };
}

/**
 * Allocation as a 0-100 bar value, scaled against the largest holding rather than against 100:
 * the biggest position fills the track and the rest read relative to it, which is the only way a
 * 0.21% holding is visible at all. Floored for the same reason as the holding period bar.
 */
export function allocationBarValue(value: number, maxAllocationPct: number): number {
  const magnitude = Math.abs(value);
  if (magnitude === 0 || maxAllocationPct <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(MIN_BAR_VALUE, (magnitude / maxAllocationPct) * 100));
}

/** The line's colour: the direction the holding is going. */
export function sparklineBrush(changePct: number, isDark: boolean): string {
  const brushes = isDark ? SPARKLINE_BRUSHES.dark : SPARKLINE_BRUSHES.light;
  return changePct < 0 ? brushes.down : brushes.up;
}

/** The colour of the stretch below zero, whichever way the session ends. */
export function sparklineNegativeBrush(isDark: boolean): string {
  return isDark ? SPARKLINE_BRUSHES.dark.down : SPARKLINE_BRUSHES.light.down;
}
