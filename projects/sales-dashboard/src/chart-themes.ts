export type SalesTheme = "light" | "dark";

/**
 * Chart colours, one set per appearance.
 *
 * The charts paint to canvas, so unlike everything else in the sample they cannot read the palette
 * through a CSS variable: every value below is a literal copy of a palette shade and has to change
 * alongside `_sales-palette.scss`:
 *
 * | | light | dark |
 * | --- | --- | --- |
 * | `series` | primary, warn, secondary, success -500 | same |
 * | `label`, `sliceLabel` | gray-700 | gray-500 |
 * | `axis` (the category axis line and its ticks) | gray-500 | gray-500 |
 * | `gridline` | gray-300 | gray-100 |
 * | `chip` | transparent | transparent |
 * | `bubble`, `bubbleText` | primary-500 + white | primary-500 + near-black |
 *
 * `series` is in the donut's slice order, which is also the legend's.
 *
 * The tooltip and the axis bubbles are two different elements and take two different fills:
 *
 * - `chip` is the canvas rectangle the item tooltip paints under the DOM box, and it is the callout,
 *   leg and all. It is transparent, so it draws nothing and the DOM box is the whole tooltip.
 * - `bubble` is the value chip the crosshairs park on the axis. It takes the accent rather than the
 *   tooltip's fill: it has no border input, so a fill a step off the panel is barely visible (1.05:1
 *   on the light theme). The accent is 4.9:1 / 5.7:1 against the panel, and it is the colour of the
 *   series the bubble annotates.
 *
 *   The ink flips with it, because the accent does not: primary-500 is the same value in both
 *   palettes, light enough on the dark set that white falls to 2.7:1 and deep enough on the light set
 *   that near-black falls to 3.3:1. White over the light accent is 4.9:1; near-black over the dark
 *   one is 6.0:1.
 */
export interface SalesChartPalette {
  series: string[];
  trend: string[];
  deals: string[];
  label: string;
  axis: string;
  gridline: string;
  sliceLabel: string;
  chip: string;
  bubble: string;
  bubbleText: string;
}

export const SALES_CHART_THEMES: Record<SalesTheme, SalesChartPalette> = {
  light: {
    series: ["#7f4cf6", "#b8690c", "#d84b98", "#17835f"],
    trend: ["#7f4cf6", "#17835f"],
    deals: ["#7f4cf6"],
    label: "#445d7e",
    axis: "#819bbb",
    gridline: "#d7dfe9",
    sliceLabel: "#445d7e",
    chip: "transparent",
    bubble: "#7f4cf6",
    bubbleText: "#ffffff",
  },
  dark: {
    series: ["#a78bfa", "#e0a33c", "#f07cb8", "#35c48c"],
    trend: ["#a78bfa", "#35c48c"],
    deals: ["#a78bfa"],
    label: "#a3bad6",
    axis: "#a3bad6",
    gridline: "#29405c",
    sliceLabel: "#a3bad6",
    chip: "transparent",
    bubble: "#a78bfa",
    bubbleText: "#17202b",
  },
};
