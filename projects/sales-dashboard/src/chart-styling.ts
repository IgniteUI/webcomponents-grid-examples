import { DataChartStylingDefaults } from "igniteui-webcomponents-charts";
import type { SalesChartPalette } from "./chart-themes.js";
import tooltipStyles from "./sales-tooltips.scss?inline";

// What the charts read from the page rather than from their own inputs: the engine's styling table,
// `DataChartStylingDefaults`, which every chart on the page shares, and the document, where the
// charts put their tooltip DOM. A dashboard changes both while it is on the page and puts them back
// when the last one leaves.

/** The chart engine's lookup key for the rectangle it paints behind a tooltip. A CSS class name in shape only. */
const POINTER_TOOLTIP_KEY = "ui-chart-pointer-tooltip";

const stylingDefaults = DataChartStylingDefaults as Record<string, unknown>;

/**
 * The font the charts set their own text in: the slice labels of the doughnut, and the metrics that
 * size every chart's plot area. The engine takes it from its styling table rather than from the
 * CSS around the chart, where its default is Titillium Web, and the plot area moves by a couple of
 * pixels depending on whether that font happens to be on the page.
 */
const CHART_FONT_FAMILY = "Barlow, 'Segoe UI', sans-serif";

/** Live dashboards, so the changes below outlive exactly this sample. */
let openDashboards = 0;

/** The table's own font family, put back when the last dashboard goes. */
let packageFontFamily: unknown;

/** The document stylesheet of the chart tooltips, while a dashboard is on the page. */
let tooltipSheet: HTMLStyleElement | null = null;

/**
 * Themes the rectangle the engine paints behind every chart tooltip.
 *
 * There is no input for it: the fill comes from a CSS-shaped lookup the engine makes through its
 * renderer, and `DataChartStylingDefaults` is the table it reads. It reads that table once, while a
 * chart is being constructed, so the entry has to be in place before the chart exists: the
 * dashboard re-creates its charts on every appearance change for the same reason.
 *
 * The DOM tooltip that the tooltip stylesheet themes floats on top of this rectangle at the same
 * size, so the two have to agree; the border is dropped here and left to the box above.
 */
export function applySalesTooltipTheme(palette: SalesChartPalette): void {
  stylingDefaults[POINTER_TOOLTIP_KEY] = {
    "background-color": palette.chip,
    "border-top-color": palette.chip,
    "border-top-width": "0",
  };
}

/**
 * Notes that a dashboard is on the page. The first one sets the charts' font and adds the tooltip
 * stylesheet to the document: the charts put their tooltip DOM on `<body>`, out of reach of the
 * dashboard's shadow root.
 */
export function retainChartStyling(): void {
  if (openDashboards++ === 0) {
    packageFontFamily = stylingDefaults["font-family"];
    stylingDefaults["font-family"] = CHART_FONT_FAMILY;
    tooltipSheet = document.createElement("style");
    tooltipSheet.textContent = tooltipStyles;
    document.head.append(tooltipSheet);
  }
}

/**
 * Notes that a dashboard has left the page. The last one to go takes its table entries and its
 * stylesheet down again and leaves the package defaults for whatever opens next.
 */
export function releaseChartStyling(): void {
  if (--openDashboards === 0) {
    tooltipSheet?.remove();
    tooltipSheet = null;
    stylingDefaults["font-family"] = packageFontFamily;
    delete stylingDefaults[POINTER_TOOLTIP_KEY];
  }
}
