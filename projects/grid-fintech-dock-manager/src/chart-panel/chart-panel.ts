import { LitElement, html, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { guard } from "lit/directives/guard.js";
import { keyed } from "lit/directives/keyed.js";
import { ref } from "lit/directives/ref.js";
import { defineComponents, IgcButtonGroupComponent, IgcIconComponent } from "igniteui-webcomponents";
import { ModuleManager } from "igniteui-webcomponents-core";
import {
  DataChartStylingDefaults,
  FinancialChartType,
  FinancialChartVolumeType,
  FinancialChartXAxisMode,
  FinancialChartZoomSliderType,
  FinancialIndicatorType,
  IgcFinancialChartComponent,
  IgcFinancialChartModule,
  IgcFinancialIndicatorTypeCollection,
  ToolTipType,
} from "igniteui-webcomponents-charts";
import { SEED_STOCKS } from "../data/market-seed.js";
import type { Position, StockItem } from "../models/stock.model.js";
import type { Desk } from "../services/desk.js";
import type { ThemeMode } from "../services/workspace.service.js";
import { percentChange } from "../util/finance.js";
import { compact, price, signed } from "../util/format.js";
import { ICONS } from "../util/icons.js";
import { StoreController, memoize } from "../util/store.js";
import { buildHistory, nextCandle, type CandlePoint } from "./price-history.js";
import styles from "./chart-panel.scss?inline";

defineComponents(IgcButtonGroupComponent, IgcIconComponent);
ModuleManager.register(IgcFinancialChartModule);

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * The windows the chart offers, each with the bar it is drawn from.
 *
 * A window implies an interval: a minute of one-minute candles is one candle, so
 * the short ones step in seconds and the long ones in days or weeks. The bar
 * counts keep every window between 60 and 260 candles: enough shape to read,
 * few enough to redraw on a tick.
 *
 * Weekends come out of the daily windows only. The intraday ones are drawn as a
 * continuous tape rather than modelling session hours, and the five-year window
 * steps a whole week at a time, so every one of its bars falls on the same
 * weekday: skipping weekends there would either drop the series or keep none of
 * it, depending on the day the desk was opened.
 */
const RANGE_STEPS = {
  "1 min": { step: SECOND, bars: 60, skipWeekends: false },
  "1 hour": { step: MINUTE, bars: 60, skipWeekends: false },
  "1 week": { step: HOUR, bars: 168, skipWeekends: false },
  "1 month": { step: DAY, bars: 22, skipWeekends: true },
  "3 months": { step: DAY, bars: 63, skipWeekends: true },
  "1 year": { step: DAY, bars: 252, skipWeekends: true },
  "5 years": { step: WEEK, bars: 260, skipWeekends: false },
} as const;

type Range = keyof typeof RANGE_STEPS;
const RANGES = Object.keys(RANGE_STEPS) as Range[];

const CHART_TYPES = ["Candle", "Line", "Column", "Bar"] as const;
type ChartType = (typeof CHART_TYPES)[number];

const SERIES_TYPES: Record<ChartType, FinancialChartType> = {
  Candle: FinancialChartType.Candle,
  Line: FinancialChartType.Line,
  Column: FinancialChartType.Column,
  Bar: FinancialChartType.Bar,
};

/**
 * Chart colours per theme.
 *
 * The financial chart paints to a canvas and takes plain colour strings, so it
 * cannot read the `--ig-*` tokens. These are literal copies of the desk's
 * palettes (success and error for the series, gray-700 for the axis labels,
 * the hairline for the gridlines, gray-100/300/900 for the tooltip and gray-50
 * for the final-value badges) and have to be changed alongside them.
 */
const CHART_THEMES = {
  dark: {
    up: "#34d399",
    down: "#ff4d6a",
    label: "#7a93b5",
    gridline: "#1e2d44",
    tooltipBackground: "#141e2e",
    tooltipBorder: "#273d58",
    tooltipText: "#e2e8f0",

    // The badges the engine paints in the series brush (the final-value one on
    // each axis and the crosshair's price bubble), so this has to contrast with
    // the brush rather than with the desk: near-black on the dark theme's bright
    // green, near-white on the light theme's deep one.
    annotationText: "#0a0d14",

    // The final-value badges' fill: the up brush a step lighter, the shade the
    // volume pane's badge takes on its own. Stated so the price pane's badge
    // carries the same fill rather than the bare brush.
    annotationBackground: "#48d7a3",

    // The crosshair's *time* bubble, under the x axis, is the exception: the
    // engine does not brush that one, so both halves are stated and it reads as
    // a neutral desk chip (gray-300 carrying gray-900).
    axisChipBackground: "#273d58",
    axisChipText: "#e2e8f0",
  },
  light: {
    // Same hue angles as the two above, deepened for a white ground, and
    // holding the up colour's luminance lead over the down colour so the candle
    // field separates by value here too.
    up: "#147b55",
    down: "#a60722",
    label: "#646a78",

    // The hairline, not gray-200: a chart's worth of rules at full border weight
    // is the loudest thing on a white field.
    gridline: "#eeeff2",

    tooltipBackground: "#f8f9fb",
    tooltipBorder: "#cad0d8",
    tooltipText: "#212936",
    annotationText: "#ffffff",
    annotationBackground: "#199a6a",
    axisChipBackground: "#cad0d8",
    axisChipText: "#212936",
  },
} as const;

type ChartPalette = (typeof CHART_THEMES)[ThemeMode];

/** The series brushes per theme, as the arrays the chart takes. Built once, so a render never re-assigns them. */
const SERIES_BRUSHES: Record<ThemeMode, { up: string[]; down: string[] }> = {
  dark: { up: [CHART_THEMES.dark.up], down: [CHART_THEMES.dark.down] },
  light: { up: [CHART_THEMES.light.up], down: [CHART_THEMES.light.down] },
};

/**
 * Tooltip type, as CSS font shorthands: the engine hands them to the canvas.
 * The desk's own 11px type rather than the chart package's default.
 */
const TOOLTIP_FONT = "11px 'DM Sans', sans-serif";
const TOOLTIP_HEADER_FONT = "700 11px 'DM Sans', sans-serif";

/**
 * The chart engine's lookup key for the tooltip box. A CSS class name in shape
 * only: nothing in the document carries it.
 */
const POINTER_TOOLTIP_KEY = "ui-chart-pointer-tooltip";

/** Live chart panes, so the table entry below outlives exactly this sample. */
let openPanes = 0;

/**
 * Themes the box that the `Data` tooltip draws.
 *
 * There is no property for it: the whole `dataToolTip*` surface styles text.
 * The box's fill, border and thickness come from a CSS-shaped lookup the engine
 * makes through its renderer, and the charts are constructed with their
 * defaults table as the only source, so `DataChartStylingDefaults`, the table
 * the chart is handed at construction, is the only thing it can see. Writing
 * the entry there is the whole fix.
 *
 * `border-top-*` is not a slip: the engine reads one edge and applies it to all
 * four. The corner radius is out of reach, so the box has square corners.
 */
function applyPointerTooltipTheme(palette: ChartPalette): void {
  (DataChartStylingDefaults as Record<string, unknown>)[POINTER_TOOLTIP_KEY] = {
    "background-color": palette.tooltipBackground,
    "border-top-color": palette.tooltipBorder,
    "border-top-width": "1px",
  };
}

/** Opening close from the seed table: static, so the history stays stable. */
function anchorPriceOf(symbol: string): number {
  return SEED_STOCKS.find((stock) => stock.symbol === symbol)?.previousClose ?? 200;
}

/** One chart document: the instrument's header, the chart's controls, and the chart. */
@customElement("grid-fintech-dock-manager-chart")
export default class ChartPane extends LitElement {
  static styles = unsafeCSS(styles);

  @property({ attribute: false }) desk!: Desk;
  @property({ attribute: false }) symbol = "";

  @state() private selectedRange: Range = "1 min";
  @state() private chartType: ChartType = "Line";
  @state() private showVolume = true;
  @state() private showRsi = false;

  /** The chart currently on screen, so it can be torn down when it is replaced or the pane goes. */
  private chart?: IgcFinancialChartComponent;
  private readonly destroyedCharts = new WeakSet<Element>();
  /** Bumped when the pane reconnects, so a chart destroyed on the way out is stamped afresh. */
  private chartGeneration = 0;

  /**
   * The visible window: the chart's `dataSource`.
   *
   * Synthetic history, anchored on the instrument's opening close, so it is
   * deterministic per symbol and window and never regenerates on a price tick:
   * its identity changes only with the symbol or the range. Handing the chart a
   * new array once a second would make it re-bind and redraw the whole series;
   * instead the last candle is updated through `notifySetItem` (see
   * {@link markLiveCandle}).
   */
  private readonly chartDataFor = memoize((symbol: string, range: Range) =>
    buildHistory(symbol, anchorPriceOf(symbol), RANGE_STEPS[range]),
  );

  /**
   * A typed collection, not a comma-separated string: the indicator enum has no
   * "none" member, and an empty collection is how you say "no studies".
   */
  private readonly indicatorTypesFor = memoize(
    (rsi: boolean) => new IgcFinancialIndicatorTypeCollection(rsi ? [FinancialIndicatorType.RelativeStrengthIndex] : []),
  );

  constructor() {
    super();
    new StoreController(this)
      .watch(() => this.desk.market, "tick")
      .on(() => this.desk.market, "tick", () => {
        this.rollWindow();
        this.markLiveCandle();
      })
      .watch(() => this.desk.trading, "book", "marks")
      .watch(() => this.desk.workspace, "theme");
  }

  connectedCallback(): void {
    super.connectedCallback();
    openPanes++;
    if (this.hasUpdated) {
      this.chartGeneration++;
      this.requestUpdate();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    // A chart keeps polling its size until it is destroyed, removed or not.
    this.destroyChart();

    // The styling table is a module singleton shared by every chart in the
    // page, so the entry has to come back out with the last pane; otherwise
    // another sample's chart inherits this desk's tooltip.
    if (--openPanes === 0) {
      delete (DataChartStylingDefaults as Record<string, unknown>)[POINTER_TOOLTIP_KEY];
    }
  }

  protected updated(changed: PropertyValues): void {
    // Re-mark right after a symbol or range change rebuilds the window, so the
    // newest candle is never a tick behind the tape.
    if (changed.has("symbol") || changed.has("selectedRange")) {
      this.rollWindow();
      this.markLiveCandle();
    }
  }

  private get chartData(): CandlePoint[] {
    return this.chartDataFor(this.symbol, this.selectedRange);
  }

  /** The chart element, as Lit hands it over; a replaced one is destroyed. */
  private readonly chartRef = (element?: Element): void => {
    if (element === this.chart) {
      return;
    }

    this.destroyChart();
    // Reconnecting hands back the chart destroyed on the way out; it is not
    // taken back, and the template stamps a new one (see `connectedCallback`).
    if (element && !this.destroyedCharts.has(element)) {
      this.chart = element as IgcFinancialChartComponent;
    }
  };

  /** Destroys the current chart once: a chart destroyed a second time throws. */
  private destroyChart(): void {
    const chart = this.chart;
    this.chart = undefined;
    if (chart && !this.destroyedCharts.has(chart)) {
      this.destroyedCharts.add(chart);
      chart.destroy();
    }
  }

  /**
   * Advances the window as its bars come due: seals the live bar, appends a new
   * one and drops the oldest, so the window stays the length it claims to be.
   *
   * This is what makes the short windows live rather than a frozen snapshot with
   * one growing candle on the end. The long windows need nothing: a daily bar
   * comes due once a day, so the loop simply never fires.
   *
   * Bars are pushed and shifted in place and the chart is told item by item,
   * for the same reason {@link markLiveCandle} exists.
   */
  private rollWindow(): void {
    const chart = this.chart;
    const data = this.chartData;
    const spec = RANGE_STEPS[this.selectedRange];

    if (!chart || data.length === 0) {
      return;
    }

    // A backgrounded tab can come back hours later. Rolling a whole window's
    // worth of bars one at a time would just rebuild it, so that is the cap.
    const newest = data[data.length - 1].Date.getTime();
    const due = Math.min(Math.floor((Date.now() - newest) / spec.step), spec.bars);
    if (due <= 0) {
      return;
    }

    const live = this.desk.market.quoteOf(this.symbol)?.lastPrice;

    for (let index = 1; index <= due; index++) {
      const previous = data[data.length - 1];
      // Only the bar that is still open takes the live price. Any bars behind it
      // are ones nobody watched, so they close where they opened.
      const close = index === due && live !== undefined ? live : previous.Close;
      const candle = nextCandle(previous, spec, close, newest + index * spec.step);

      data.push(candle);
      chart.notifyInsertItem(data, data.length - 1, candle);

      const dropped = data[0];
      data.shift();
      chart.notifyRemoveItem(data, 0, dropped);
    }
  }

  /**
   * Rolls the live price into the last candle and tells the chart about that one
   * item: the chart's equivalent of a grid's `markForCheck()`, an incremental
   * update rather than a re-bind.
   */
  private markLiveCandle(): void {
    const chart = this.chart;
    const data = this.chartData;
    const live = this.desk.market.quoteOf(this.symbol)?.lastPrice;

    if (!chart || data.length === 0 || live === undefined) {
      return;
    }

    const index = data.length - 1;
    const previous = data[index];
    if (previous.Close === live) {
      return;
    }

    const updated: CandlePoint = {
      ...previous,
      Close: live,
      High: Math.max(previous.High, live),
      Low: Math.min(previous.Low, live),
    };

    data[index] = updated;
    chart.notifySetItem(data, index, previous, updated);
  }

  private onRangeSelected(event: CustomEvent<string | undefined>): void {
    const range = RANGES.find((entry) => entry === event.detail);
    if (range) {
      this.selectedRange = range;
    }
  }

  private onChartTypeSelected(event: CustomEvent<string | undefined>): void {
    const type = CHART_TYPES.find((entry) => entry === event.detail);
    if (type) {
      this.chartType = type;
    }
  }

  /** The studies group is multi-select, so both events route through here. */
  private onStudyToggled(event: CustomEvent<string | undefined>, selected: boolean): void {
    if (event.detail === "volume") {
      this.showVolume = selected;
    } else {
      this.showRsi = selected;
    }
  }

  protected render(): TemplateResult {
    const { market, trading, workspace } = this.desk;
    const quote: StockItem | undefined = market.snapshotOf(this.symbol);
    const held: Position | undefined = trading.positions.find((entry) => entry.symbol === this.symbol);
    const data = this.chartData;
    const latest = data.length > 0 ? data[data.length - 1] : undefined;

    const currentPrice = quote?.lastPrice ?? latest?.Close ?? 0;
    // Change over the visible window, not just the trading day.
    const rangeChange = data.length < 2 ? { pct: 0 } : { pct: percentChange(currentPrice, data[0].Close) };
    const sessionStats = {
      open: latest?.Open ?? null,
      high: quote?.dayHigh ?? latest?.High ?? null,
      low: quote?.dayLow ?? latest?.Low ?? null,
      volume: quote?.volume ?? latest?.Volume ?? null,
    };

    // The tooltip box's colours are read from the engine's styling table while a
    // chart is being built, so the entry goes in before the chart is stamped.
    const theme = workspace.theme;
    const palette = CHART_THEMES[theme];
    applyPointerTooltipTheme(palette);
    const brushes = SERIES_BRUSHES[theme];

    return html`
      <div class="chart-panel">
        <header class="chart-header">
          <div class="price-block">
            <div class="chart-symbol">
              <span class="chart-ticker">${this.symbol}</span>
              <span class="chart-name">${quote?.name}</span>
            </div>
            <div class="price-line">
              <span class="current-price mono">${price(currentPrice)}</span>
              <span class="price-change ${quote ? (quote.positive ? "pos" : "neg") : ""}">
                ${signed(quote?.change)} (${signed(quote?.changePct, "pct")})
              </span>
            </div>
          </div>

          <ul class="ohlc-stats">
            <li class="stat-item"><div class="ohlc-stats__label">O</div><span>${price(sessionStats.open)}</span></li>
            <li class="stat-item"><div class="ohlc-stats__label">H</div><span>${price(sessionStats.high)}</span></li>
            <li class="stat-item"><div class="ohlc-stats__label">L</div><span>${price(sessionStats.low)}</span></li>
            <li class="stat-item"><div class="ohlc-stats__label">Vol</div><span>${compact(sessionStats.volume)}</span></li>
            <li class="stat-item">
              <div class="ohlc-stats__label">${this.selectedRange}</div>
              <span class=${rangeChange.pct >= 0 ? "pos" : "neg"}>${signed(rangeChange.pct, "pct")}</span>
            </li>
          </ul>

          ${held
            ? html`
                <div class="position-chip ${held.openPl >= 0 ? "pos" : "neg"}">
                  <span class="chip-qty">${held.quantity} @ ${price(held.avgCost)}</span>
                  <span class="chip-pl mono">${signed(held.openPl, "money")}</span>
                </div>
              `
            : nothing}
        </header>

        <div class="chart-toolbar">
          <igc-button-group class="chart-group" selection="single-required" @igcSelect=${this.onRangeSelected}>
            ${RANGES.map(
              (range) => html`<igc-toggle-button value=${range} ?selected=${this.selectedRange === range}><span>${range}</span></igc-toggle-button>`,
            )}
          </igc-button-group>

          <igc-button-group class="chart-group" selection="single-required" @igcSelect=${this.onChartTypeSelected}>
            ${CHART_TYPES.map(
              (type) => html`<igc-toggle-button value=${type} ?selected=${this.chartType === type}><span>${type}</span></igc-toggle-button>`,
            )}
          </igc-button-group>

          <igc-button-group
            class="chart-group"
            selection="multiple"
            @igcSelect=${(event: CustomEvent<string | undefined>) => this.onStudyToggled(event, true)}
            @igcDeselect=${(event: CustomEvent<string | undefined>) => this.onStudyToggled(event, false)}
          >
            <igc-toggle-button value="volume" ?selected=${this.showVolume}>
              <igc-icon name="bar_chart" collection=${ICONS} aria-hidden="true"></igc-icon>
              <span>Volume</span>
            </igc-toggle-button>
            <igc-toggle-button value="rsi" ?selected=${this.showRsi}>
              <igc-icon name="show_chart" collection=${ICONS} aria-hidden="true"></igc-icon>
              <span>RSI</span>
            </igc-toggle-button>
          </igc-button-group>
        </div>

        <div class="chart-area">
          ${
            // Keyed on the theme so a theme flip stamps a new chart: everything
            // bound below re-themes in place, but the tooltip's box does not,
            // because the chart reads it from the styling table while it is being
            // built (see applyPointerTooltipTheme).
            //
            // The x axis is ordinal rather than a time scale: a true time scale
            // leaves a two-day hole at every weekend the daily windows skip.
            // Ordinal spaces the bars evenly and still labels them with their
            // timestamps, which is how a trading chart reads a calendar.
            //
            // The Data tooltip is the one the engine draws itself, and so the one
            // the styling table reaches. It covers the price pane only; the volume
            // and RSI panes keep the package's DOM tooltip, themed in the stylesheet.
            //
            // The pane renders on every tick, and Lit hands an object-valued
            // property to its element again on every render, even when it is the
            // same object. The chart takes each of those as a new value: new
            // brushes are re-applied to every series, and every series then puts
            // its tooltip back in the corner of the pane, and new indicator types
            // rebuild the indicator panes. So each object binding is guarded on
            // what it is derived from, and reaches the chart only when that changes.
            keyed(
              `${theme}:${this.chartGeneration}`,
              html`
                <igc-financial-chart
                  ${ref(this.chartRef)}
                  .zoomSliderType=${FinancialChartZoomSliderType.None}
                  .xAxisMode=${FinancialChartXAxisMode.Ordinal}
                  .isToolbarVisible=${false}
                  .dataSource=${guard([data], () => data)}
                  .chartType=${SERIES_TYPES[this.chartType]}
                  .volumeType=${this.showVolume ? FinancialChartVolumeType.Column : FinancialChartVolumeType.None}
                  .indicatorTypes=${guard([this.showRsi], () => this.indicatorTypesFor(this.showRsi))}
                  .brushes=${guard([brushes], () => brushes.up)}
                  .outlines=${guard([brushes], () => brushes.up)}
                  .negativeBrushes=${guard([brushes], () => brushes.down)}
                  .negativeOutlines=${guard([brushes], () => brushes.down)}
                  .xAxisLabelTextColor=${palette.label}
                  .yAxisLabelTextColor=${palette.label}
                  .xAxisMajorStroke=${palette.gridline}
                  .yAxisMajorStroke=${palette.gridline}
                  .finalValueAnnotationsBackground=${palette.annotationBackground}
                  .finalValueAnnotationsTextColor=${palette.annotationText}
                  .crosshairsAnnotationXAxisBackground=${palette.axisChipBackground}
                  .crosshairsAnnotationXAxisTextColor=${palette.axisChipText}
                  .crosshairsAnnotationYAxisTextColor=${palette.annotationText}
                  .toolTipType=${ToolTipType.Data}
                  .dataToolTipHeaderTextColor=${palette.tooltipText}
                  .dataToolTipTitleTextColor=${palette.tooltipText}
                  .dataToolTipLabelTextColor=${palette.label}
                  .dataToolTipValueTextColor=${palette.tooltipText}
                  .dataToolTipHeaderTextStyle=${TOOLTIP_HEADER_FONT}
                  .dataToolTipTitleTextStyle=${TOOLTIP_HEADER_FONT}
                  .dataToolTipLabelTextStyle=${TOOLTIP_FONT}
                  .dataToolTipValueTextStyle=${TOOLTIP_FONT}
                  height="100%"
                  width="100%"
                ></igc-financial-chart>
              `,
            )
          }
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "grid-fintech-dock-manager-chart": ChartPane;
  }
}
