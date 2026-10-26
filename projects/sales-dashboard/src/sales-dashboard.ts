import {
  LitElement,
  html,
  nothing,
  render as renderTemplate,
  unsafeCSS,
  type PropertyValues,
  type TemplateResult,
} from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { guard } from "lit/directives/guard.js";
import { keyed } from "lit/directives/keyed.js";
import {
  configureTheme,
  defineComponents,
  IgcAvatarComponent,
  IgcBadgeComponent,
  IgcCardComponent,
  IgcCardContentComponent,
  IgcIconButtonComponent,
  IgcIconComponent,
  IgcListComponent,
  IgcListItemComponent,
  IgcTooltipComponent,
} from "igniteui-webcomponents";
import { ModuleManager } from "igniteui-webcomponents-core";
import {
  CategoryChartType,
  IgcCategoryChartModule,
  IgcDoughnutChartModule,
  ToolTipType,
  type IgcCategoryChartComponent,
  type IgcDoughnutChartComponent,
  type IgcHoleDimensionsChangedEventArgs,
} from "igniteui-webcomponents-charts";
import "igniteui-webcomponents-grids/grids/combined.js";
import type { IgcCellTemplateContext } from "igniteui-webcomponents-grids/grids";
import { applySalesTooltipTheme, releaseChartStyling, retainChartStyling } from "./chart-styling.js";
import { SALES_CHART_THEMES, type SalesTheme } from "./chart-themes.js";
import { dealsTooltip, regionTooltip, trendTooltip } from "./chart-tooltips.js";
import { sliceAtPoint, sliceCentre, ringFromHole, type DonutRing } from "./donut-geometry.js";
import { prepareGridShadowRoot } from "./grid-shadow-root.js";
import { SALES_ICON_COLLECTION, registerSalesIcons } from "./icons.js";
import {
  ACTIVITY_ROWS,
  LEADERBOARD,
  METRICS,
  REVENUE_BY_REGION,
  REVENUE_TREND,
  WEEKLY_DEALS,
  stageClassFor,
} from "./sales-data.js";
import styles from "./sales-dashboard.scss?inline";

defineComponents(
  IgcAvatarComponent,
  IgcBadgeComponent,
  IgcCardComponent,
  IgcCardContentComponent,
  IgcIconButtonComponent,
  IgcIconComponent,
  IgcListComponent,
  IgcListItemComponent,
  IgcTooltipComponent
);
ModuleManager.register(IgcCategoryChartModule, IgcDoughnutChartModule);

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@600;700&display=swap";

/** How much of the doughnut's outer radius the hole takes, in percent. */
const DONUT_INNER_EXTENT = 55;

/** The slices' values, in the order the doughnut draws them. */
const REGION_VALUES = REVENUE_BY_REGION.map((share) => share.value);

/** The Revenue Trend's columns: the month is the category, and the two lines are the series. */
const TREND_PROPERTIES = ["month", "revenue", "targetLine"];

/** The canvas font of the axis labels. */
const AXIS_LABEL_FONT = "500 13px 'Barlow', sans-serif";

/**
 * The gap between the category axis' ticks and its labels. With this gap, a category axis whose
 * labels are horizontal has a 33px label area, which is what the layout is drawn with; the chart's
 * default gap is a pixel more and moves the plot area up by that pixel.
 *
 * The label area itself is left to the chart rather than fixed: a fixed extent stops the Deals
 * chart from turning its labels when its panel is narrow (213px to 285px in the four-across
 * layout), and most of them are then shown as ellipses. A turned axis ends up a pixel shorter than
 * it would with the default gap.
 */
const X_AXIS_LABEL_TOP_MARGIN = 4;

/** The fonts the charts paint with, which have to be loaded before they are created. */
const CHART_FONTS = [AXIS_LABEL_FONT, "400 13px 'Barlow', sans-serif"];

/**
 * How long the charts wait for those fonts. A font host that stalls would otherwise keep the page
 * without charts for as long as the browser takes to give up on it; past this the charts are
 * created in the fallback font.
 */
const FONT_WAIT_MS = 2500;

/**
 * Adds a stylesheet link to the document head once; fonts declared in a shadow root are ignored.
 * The promise settles when the stylesheet has loaded or failed to.
 */
function ensureDocumentStylesheet(href: string): Promise<void> {
  const settled = (link: HTMLLinkElement) =>
    new Promise<void>((resolve) => {
      link.addEventListener("load", () => resolve(), { once: true });
      link.addEventListener("error", () => resolve(), { once: true });
    });

  const existing = Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).find(
    (link) => link.href === href
  );
  if (existing) {
    return existing.sheet ? Promise.resolve() : settled(existing);
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  const done = settled(link);
  document.head.append(link);
  return done;
}

/**
 * Sales Overview: KPI tiles, revenue and deals charts, revenue by region, recent activity and a leaderboard.
 *
 * The element is made for one visit and thrown away with it: the router creates a new one each time
 * the page is shown. Its charts are destroyed when it is disconnected, and a destroyed chart cannot
 * be revived, so a disconnected dashboard is not meant to be attached again.
 */
@customElement("app-sales-dashboard")
export default class SalesDashboard extends LitElement {
  @state() private theme: SalesTheme = "light";

  /**
   * False until the fonts of the chart text are loaded, or have taken too long. A chart measures its
   * labels and paints them once, in whatever font is there, so it is created only after they have
   * loaded.
   */
  @state() private fontsReady = false;

  private fontTimer?: number;

  /** The slice of the doughnut the pointer is over, or -1. */
  private hoveredSlice = -1;

  /** Where the doughnut's ring is, as the chart last reported it. */
  private donutRing: DonutRing | null = null;

  /** The tooltip templates of the current appearance. */
  private trendTooltipTemplate = trendTooltip(false);
  private dealsTooltipTemplate = dealsTooltip(false);

  @query(".donut-host") private donutHost!: HTMLElement;
  @query(".donut-tooltip") private donutTooltip!: IgcTooltipComponent;
  @query(".donut-anchor") private donutAnchor!: HTMLElement;

  connectedCallback() {
    // Theme, fonts and icons are applied when the sample is shown, not on import: the shell bundle
    // loads every sample's module into every page.
    configureTheme("fluent", "light");
    void this.loadFonts();
    registerSalesIcons();
    retainChartStyling();
    super.connectedCallback();
  }

  private async loadFonts() {
    const loaded = ensureDocumentStylesheet(FONTS_HREF)
      .then(() => Promise.all(CHART_FONTS.map((font) => document.fonts.load(font))))
      .catch(() => undefined);
    const tooLong = new Promise<void>((resolve) => {
      this.fontTimer = window.setTimeout(resolve, FONT_WAIT_MS);
    });
    await Promise.race([loaded, tooLong]);
    window.clearTimeout(this.fontTimer);
    this.fontsReady = true;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.clearTimeout(this.fontTimer);
    // A chart polls its size until it is destroyed, and removing its element does not stop that.
    this.destroyCharts();
    this.stopWatchingOutsideTaps();
    releaseChartStyling();
  }

  firstUpdated() {
    prepareGridShadowRoot(this.renderRoot as ShadowRoot);
    this.donutTooltip.anchor = this.donutAnchor;
  }

  protected willUpdate(changed: PropertyValues) {
    if (!changed.has("theme")) {
      return;
    }
    const dark = this.theme === "dark";
    // The appearance is a host class: the palette follows it for everything but the charts, which
    // follow `SALES_CHART_THEMES` and are re-created by the template.
    this.classList.toggle("dark-theme", dark);
    // The engine reads its tooltip styling table once, while a chart is being constructed, so the
    // entry has to be in place before the template creates the charts.
    applySalesTooltipTheme(SALES_CHART_THEMES[this.theme]);
    this.destroyCharts();
    this.trendTooltipTemplate = trendTooltip(dark);
    this.dealsTooltipTemplate = dealsTooltip(dark);
    this.donutRing = null;
    if (this.hasUpdated) {
      // The slice the tooltip describes belongs to the chart that has just been replaced.
      void this.showSliceTooltip(-1);
    }
  }

  /**
   * Stops the size watchers of the charts in this tree. A chart polls its size until it is
   * destroyed, and removing its element does not stop that.
   */
  private destroyCharts() {
    if (!this.renderRoot) {
      return;
    }
    for (const chart of this.renderRoot.querySelectorAll<IgcCategoryChartComponent>("igc-category-chart")) {
      chart.destroy();
    }
    for (const chart of this.renderRoot.querySelectorAll<IgcDoughnutChartComponent>("igc-doughnut-chart")) {
      chart.ngOnDestroy();
    }
  }

  private onHoleDimensions = (_chart: unknown, args: IgcHoleDimensionsChangedEventArgs) => {
    this.donutRing = ringFromHole(args.center.x, args.center.y, args.radius, DONUT_INNER_EXTENT);
  };

  /**
   * The doughnut's ring series throws when it is given a tooltip template (its tooltip container
   * is not there yet when the chart first sets its context), so it carries none. The slice under
   * the pointer is worked out from the ring's geometry instead, and an `igc-tooltip` anchored in
   * the slice shows it.
   */
  private onDonutPointerMove(event: PointerEvent) {
    this.pointToSlice(this.sliceUnder(event));
  }

  /**
   * A finger raises no `pointermove` before it lifts, so a tap shows its tooltip as it lands. The
   * tooltip then stays, as it has no pointer leaving to close it, until another tap lands.
   */
  private onDonutPointerDown(event: PointerEvent) {
    if (event.pointerType !== "touch") {
      return;
    }
    this.pointToSlice(this.sliceUnder(event));
    document.addEventListener("pointerdown", this.onOutsideTap, true);
  }

  private onDonutPointerLeave(event: PointerEvent) {
    // A finger leaves the chart as it lifts, and its tooltip is closed by the next tap instead.
    if (event.pointerType !== "touch") {
      void this.showSliceTooltip(-1);
    }
  }

  /** Closes the tooltip of a tap when the next tap lands outside the doughnut. */
  private onOutsideTap = (event: PointerEvent) => {
    if (!event.composedPath().includes(this.donutHost)) {
      void this.showSliceTooltip(-1);
    }
  };

  private stopWatchingOutsideTaps() {
    document.removeEventListener("pointerdown", this.onOutsideTap, true);
  }

  /** The slice under a pointer event on the doughnut, or -1. */
  private sliceUnder(event: PointerEvent): number {
    if (!this.donutRing) {
      return -1;
    }
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return sliceAtPoint(REGION_VALUES, this.donutRing, event.clientX - bounds.left, event.clientY - bounds.top);
  }

  private pointToSlice(slice: number) {
    if (slice !== this.hoveredSlice) {
      void this.showSliceTooltip(slice);
    }
  }

  private async showSliceTooltip(slice: number) {
    const tooltip = this.donutTooltip;
    this.hoveredSlice = slice;
    if (slice === -1 || !this.donutRing) {
      this.stopWatchingOutsideTaps();
      // The text stays until the next slice replaces it, so it does not vanish before the box does.
      await tooltip.hide();
      return;
    }
    // A popover is positioned when it opens, so moving between slices closes it first, and the box
    // moves and changes its text only once it is closed.
    tooltip.open = false;
    await tooltip.updateComplete;
    if (this.hoveredSlice !== slice) {
      return;
    }
    const centre = sliceCentre(REGION_VALUES, this.donutRing, slice);
    this.donutAnchor.style.left = `${centre.x}px`;
    this.donutAnchor.style.top = `${centre.y}px`;
    // The text is rendered into the tooltip rather than through the dashboard's own template, which
    // would otherwise render again, and set every chart's inputs again, on each change of slice.
    renderTemplate(regionTooltip(this.theme === "dark", REVENUE_BY_REGION[slice]), tooltip);
    await tooltip.show();
  }

  private toggleTheme() {
    this.theme = this.theme === "dark" ? "light" : "dark";
  }

  private stageTemplate = (context: IgcCellTemplateContext) =>
    html`<span class="stage-pill ${stageClassFor(context.cell.value)}">${context.cell.value}</span>`;

  /**
   * A chart's place in the template. The chart is created once the fonts are in, and again, keyed on
   * the appearance, whenever that changes (see `applySalesTooltipTheme`).
   *
   * Lit sets every non-primitive input of an element again on each render, and a chart paints again
   * for each of them, so the slot renders for those two changes only, and the dashboard's own state
   * stays out of the way of the charts: the doughnut tooltip's text is rendered outside the template.
   */
  private chartSlot(chart: () => TemplateResult) {
    // A chart starts polling its size as soon as it is created, so none is created while the element
    // is detached (a font that arrives after a disconnect must not bring one back) or before its fonts
    // are there.
    const ready = this.fontsReady && this.isConnected;
    return guard([this.theme, ready], () => (ready ? keyed(this.theme, chart()) : nothing));
  }

  protected render() {
    const dark = this.theme === "dark";
    const palette = SALES_CHART_THEMES[this.theme];
    const toggleLabel = dark ? "Switch to light mode" : "Switch to dark mode";

    return html`
      <link rel="stylesheet" href="${import.meta.env.BASE_URL}themes/fluent.css" />

      <header class="title-row">
        <h1>Sales Overview</h1>
        <div class="status-row">
          <igc-badge variant="success" shape="square" dot aria-label="Live status"></igc-badge>
          <span>LIVE &middot; UPDATED JUST NOW</span>
          <igc-icon-button
            class="theme-toggle"
            variant="flat"
            collection=${SALES_ICON_COLLECTION}
            name=${dark ? "light_mode" : "dark_mode"}
            title=${toggleLabel}
            aria-label=${toggleLabel}
            @click=${this.toggleTheme}
          ></igc-icon-button>
        </div>
      </header>

      <section class="metrics-grid" aria-label="KPI metrics">
        ${METRICS.map(
          (item) => html`
            <igc-card class="metric-tile" role="group">
              <igc-card-content class="metric-body">
                <div class="metric-head">
                  <span class="metric-label">${item.label}</span>
                  <igc-avatar class="metric-icon ${item.iconClass}" aria-hidden="true">
                    <igc-icon name=${item.icon} collection=${SALES_ICON_COLLECTION}></igc-icon>
                  </igc-avatar>
                </div>
                <div class="metric-value">${item.value}</div>
                <igc-badge
                  class=${classMap({ "metric-delta": true, negative: !item.positive })}
                  variant=${item.positive ? "success" : "danger"}
                >
                  <igc-icon
                    name=${item.positive ? "arrow_upward" : "arrow_downward"}
                    collection=${SALES_ICON_COLLECTION}
                    aria-hidden="true"
                  ></igc-icon
                  >${item.delta}
                </igc-badge>
              </igc-card-content>
            </igc-card>
          `
        )}
      </section>

      <section class="upper-panels">
        <article class="panel trend-panel">
          <header class="panel-title split">
            <span>Revenue Trend</span>
            <div class="trend-legend" role="group" aria-label="Revenue trend legend">
              <span class="trend-legend-item">
                <span class="trend-legend-swatch" style="background: ${palette.trend[0]}"></span>
                <span>Revenue</span>
              </span>
              <span class="trend-legend-item">
                <span class="trend-legend-swatch" style="background: ${palette.trend[1]}"></span>
                <span>Target</span>
              </span>
            </div>
          </header>
          <div class="panel-body">
            ${this.chartSlot(
              () => html`
                <igc-category-chart
                  class="chart-box"
                  width="100%"
                  height="100%"
                  .dataSource=${REVENUE_TREND}
                  .xAxisLabel=${"month"}
                  .includedProperties=${TREND_PROPERTIES}
                  .chartType=${CategoryChartType.Line}
                  .xAxisLabelTopMargin=${X_AXIS_LABEL_TOP_MARGIN}
                  .xAxisLabelTextStyle=${AXIS_LABEL_FONT}
                  .yAxisLabelTextStyle=${AXIS_LABEL_FONT}
                  .xAxisLabelTextColor=${palette.label}
                  .yAxisLabelTextColor=${palette.label}
                  .xAxisStroke=${palette.axis}
                  .xAxisTickStroke=${palette.axis}
                  .xAxisMajorStroke=${palette.gridline}
                  .yAxisMajorStroke=${palette.gridline}
                  .crosshairsAnnotationXAxisBackground=${palette.bubble}
                  .crosshairsAnnotationXAxisTextColor=${palette.bubbleText}
                  .crosshairsAnnotationYAxisBackground=${palette.bubble}
                  .crosshairsAnnotationYAxisTextColor=${palette.bubbleText}
                  .brushes=${palette.trend}
                  .outlines=${palette.trend}
                  .markerBrushes=${palette.trend}
                  .markerOutlines=${palette.trend}
                  .toolTipType=${ToolTipType.Item}
                  .tooltipTemplate=${this.trendTooltipTemplate}
                  .isItemHighlightingEnabled=${false}
                  .isHorizontalZoomEnabled=${false}
                  .isVerticalZoomEnabled=${false}
                  .thickness=${2}
                  .yAxisInterval=${25}
                  .yAxisMinimumValue=${620}
                  .yAxisMaximumValue=${810}
                ></igc-category-chart>
              `
            )}
          </div>
        </article>

        <article class="panel region-panel">
          <header class="panel-title">Revenue by Region</header>
          <div class="panel-body">
            <p class="subtle">$842K total</p>
            <div class="donut-host">
              ${this.chartSlot(
                () => html`
                  <igc-doughnut-chart
                    width="100%"
                    height="190px"
                    .allowSliceSelection=${true}
                    .allowSliceExplosion=${true}
                    .innerExtent=${DONUT_INNER_EXTENT}
                    .holeDimensionsChanged=${this.onHoleDimensions}
                    @pointermove=${this.onDonutPointerMove}
                    @pointerdown=${this.onDonutPointerDown}
                    @pointerleave=${this.onDonutPointerLeave}
                  >
                    <igc-ring-series
                      .dataSource=${REVENUE_BY_REGION}
                      value-member-path="value"
                      label-member-path="region"
                      labels-position="OutsideEnd"
                      .brushes=${palette.series}
                      .outlines=${palette.series}
                      .labelOuterColor=${palette.sliceLabel}
                      .labelInnerColor=${palette.sliceLabel}
                    ></igc-ring-series>
                  </igc-doughnut-chart>
                `
              )}
              <span class="donut-anchor" aria-hidden="true"></span>
              <igc-tooltip class="donut-tooltip" placement="bottom-start" .showDelay=${0} .hideDelay=${0}></igc-tooltip>
            </div>

            <ul class="legend-list" aria-label="Revenue by region legend">
              ${REVENUE_BY_REGION.map(
                (region, index) => html`
                  <li>
                    <span class="legend-name-wrap">
                      <span class="legend-swatch" style="background: ${palette.series[index]}"></span>
                      <span class="legend-name">${region.region}</span>
                    </span>
                    <span class="legend-value">${region.value}%</span>
                  </li>
                `
              )}
            </ul>
          </div>
        </article>

        <article class="panel deals-panel">
          <header class="panel-title split">
            <span>Deals Closed This Week</span>
            <span class="subtle">37 total</span>
          </header>

          <div class="panel-body">
            ${this.chartSlot(
              () => html`
                <igc-category-chart
                  class="deals-chart"
                  .dataSource=${WEEKLY_DEALS}
                  .xAxisLabel=${"day"}
                  .chartType=${CategoryChartType.Column}
                  .brushes=${palette.deals}
                  .outlines=${palette.deals}
                  .xAxisLabelTopMargin=${X_AXIS_LABEL_TOP_MARGIN}
                  .xAxisLabelTextStyle=${AXIS_LABEL_FONT}
                  .yAxisLabelTextStyle=${AXIS_LABEL_FONT}
                  .xAxisLabelTextColor=${palette.label}
                  .yAxisLabelTextColor=${palette.label}
                  .xAxisStroke=${palette.axis}
                  .xAxisTickStroke=${palette.axis}
                  .xAxisMajorStroke=${palette.gridline}
                  .yAxisMajorStroke=${palette.gridline}
                  .crosshairsAnnotationXAxisBackground=${palette.bubble}
                  .crosshairsAnnotationXAxisTextColor=${palette.bubbleText}
                  .crosshairsAnnotationYAxisBackground=${palette.bubble}
                  .crosshairsAnnotationYAxisTextColor=${palette.bubbleText}
                  .toolTipType=${ToolTipType.Item}
                  .tooltipTemplate=${this.dealsTooltipTemplate}
                  .isHorizontalZoomEnabled=${false}
                  .isVerticalZoomEnabled=${false}
                  .thickness=${1}
                  .yAxisInterval=${10}
                  .yAxisMinimumValue=${0}
                  .yAxisMaximumValue=${50}
                ></igc-category-chart>
              `
            )}
          </div>
        </article>
      </section>

      <section class="lower-panels">
        <section class="panel activity-panel">
          <header class="panel-title split">
            <span>Recent Activity</span>
          </header>

          <div class="panel-body">
            <igc-grid class="activity-grid" .data=${ACTIVITY_ROWS} .height=${null}>
              <igc-column field="company" header="COMPANY"></igc-column>
              <igc-column field="region" header="REGION"></igc-column>
              <igc-column field="stage" header="STAGE" .bodyTemplate=${this.stageTemplate}></igc-column>
              <igc-column field="value" header="VALUE"></igc-column>
              <igc-column field="rep" header="REP"></igc-column>
              <igc-column field="source" header="SOURCE"></igc-column>
              <igc-column field="when" header="WHEN"></igc-column>
            </igc-grid>
          </div>
        </section>

        <article class="panel leaderboard-panel">
          <header class="panel-title">Leaderboard</header>

          <div class="panel-body">
            <igc-list>
              ${LEADERBOARD.map(
                (person) => html`
                  <igc-list-item>
                    <div class="leader-row">
                      <div class="leader-left">
                        <igc-avatar
                          class=${classMap({ "rank-badge": true, [`rank-${person.rank}`]: person.rank <= 3 })}
                          initials=${person.rank}
                        ></igc-avatar>
                        <div>
                          <div class="leader-name">${person.name}</div>
                          <small>${person.quota}</small>
                        </div>
                      </div>
                      <div class="leader-right">
                        <div class="leader-amount">${person.amount}</div>
                        <small class=${classMap({ negative: !person.positive })}>${person.delta}</small>
                      </div>
                    </div>
                  </igc-list-item>
                `
              )}
            </igc-list>
          </div>
        </article>
      </section>
    `;
  }

  static styles = unsafeCSS(styles);
}

declare global {
  interface HTMLElementTagNameMap {
    "app-sales-dashboard": SalesDashboard;
  }
}
