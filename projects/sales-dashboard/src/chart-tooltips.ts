import { html, type TemplateResult } from "lit";
import { classMap } from "lit/directives/class-map.js";
import type { RegionShare, RevenueTrendPoint, WeeklyDeals } from "./sales-data.js";

// The tooltips are real DOM, themed by the rules in sales-tooltips.scss. The two category charts
// default to the pointer tooltip, which is drawn entirely on canvas, box and text, with only the
// box fill exposed and no way to colour the text, so a dark box would carry unreadable dark text.
// The `Item` tooltip type moves them onto the per-item path, which honours the template and
// therefore the stylesheet.

/** A tooltip's content: a small caption over a bold line. */
function tip(dark: boolean, label: string, value: string): TemplateResult {
  return html`
    <div class=${classMap({ "chart-tip": true, "chart-tip-dark": dark })}>
      <span class="chart-tip-label">${label}</span>
      <span class="chart-tip-value">${value}</span>
    </div>
  `;
}

/** What the chart hands a series' tooltip template. */
interface SeriesTooltipContext<T> {
  item: T;
  series: { valueMemberPath: string };
}

/**
 * The Revenue Trend tooltip. An item tooltip is drawn once per series, and the two lines of this
 * chart are a few pixels apart in January, so the first series carries the month's whole line and
 * the second draws nothing.
 */
export function trendTooltip(dark: boolean): (context: SeriesTooltipContext<RevenueTrendPoint>) => TemplateResult {
  return ({ item, series }) =>
    series.valueMemberPath === "revenue"
      ? tip(dark, item.month, `Revenue ${item.revenue}K \u00b7 Target ${item.targetLine}K`)
      : html``;
}

/** The Deals Closed This Week tooltip. */
export function dealsTooltip(dark: boolean): (context: { item: WeeklyDeals }) => TemplateResult {
  return ({ item }) => tip(dark, item.day, `${item.deals} deals`);
}

/** The Revenue by Region tooltip. */
export function regionTooltip(dark: boolean, share: RegionShare): TemplateResult {
  return tip(dark, share.region, `${share.value}% of revenue`);
}
