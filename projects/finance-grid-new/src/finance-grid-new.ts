import { LitElement, html, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import {
  configureTheme,
  defineComponents,
  IgcAvatarComponent,
  IgcChipComponent,
  IgcIconButtonComponent,
  IgcIconComponent,
  IgcInputComponent,
  IgcLinearProgressComponent,
} from "igniteui-webcomponents";
import { ModuleManager } from "igniteui-webcomponents-core";
import { IgcSparklineModule, SparklineDisplayType } from "igniteui-webcomponents-charts";
import "igniteui-webcomponents-grids/grids/combined.js";
import type {
  IgcCellTemplateContext,
  IgcColumnExportingEventArgs,
  IgcGridComponent,
  IgcGridToolbarExportEventArgs,
} from "igniteui-webcomponents-grids/grids";
import { buildFinanceRows, maxAllocation } from "./finance-data.js";
import { highlightedText } from "./highlighted-text.js";
import { ICON_COLLECTION, registerFinanceIcons } from "./icons.js";
import { LivePortfolio, type LivePortfolioRow } from "./live-portfolio.js";
import {
  allocationBarValue,
  avatarInitials,
  badgeLabel,
  chipVariant,
  formatCurrency,
  formatPercent,
  holdingTerm,
  sparklineBrush,
  sparklineNegativeBrush,
} from "./portfolio-format.js";
import { prepareGridShadowRoot } from "./grid-shadow-root.js";
import { SparklineJanitor } from "./sparkline-janitor.js";
import styles from "./finance-grid-new.scss?inline";

defineComponents(
  IgcAvatarComponent,
  IgcChipComponent,
  IgcIconButtonComponent,
  IgcIconComponent,
  IgcInputComponent,
  IgcLinearProgressComponent
);
ModuleManager.register(IgcSparklineModule);

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@600;700&family=DM+Sans:wght@400;500;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap";

/** Viewport width below which the Price Trend, Holding Period and Market Value columns are hidden. */
const NARROW_VIEWPORT_PX = 700;

/** The column the exporters leave out: it is a chart. */
const NON_EXPORTABLE_FIELD = "priceTrend";

/**
 * How long a returning element waits before it builds its new grid. A grid element tears itself
 * down 10 ms after it leaves the document, and that teardown removes component styles which a
 * grid created in the same shadow root in the meantime already relies on, leaving it unstyled.
 */
const GRID_REBUILD_DELAY_MS = 50;

/**
 * The exporter the toolbar passes to its export events. At run time it is the grid's own export
 * service, whose events are emitters with `subscribe` rather than the DOM events that the
 * `IgcBaseExporter` typing suggests.
 */
interface ToolbarExporter {
  columnExporting: { subscribe(next: (args: IgcColumnExportingEventArgs) => void): { unsubscribe(): void } };
}

/** Adds a stylesheet link to the document head once; fonts declared in a shadow root are ignored. */
function ensureDocumentStylesheet(href: string): void {
  const exists = Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).some(
    (link) => link.href === href
  );
  if (!exists) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.append(link);
  }
}

/** The holding a cell template belongs to: the live row object, not a copy. */
function rowOf(context: IgcCellTemplateContext): LivePortfolioRow {
  return context.cell.row.data as LivePortfolioRow;
}

/** Financial Portfolio: asset tracking with profit and loss analysis and a live, flashing price feed. */
@customElement("app-finance-grid-new")
export default class FinanceGridNew extends LitElement {
  static styles = unsafeCSS(styles);

  private readonly financeRows = buildFinanceRows();
  private readonly maxAllocationPct = maxAllocation(this.financeRows);

  // Rows are marked to market in place, so the grid never sees a new `data` array to react to:
  // `markForCheck()` is its own answer to that.
  private readonly portfolio = new LivePortfolio(this, this.financeRows, () => this.grid?.markForCheck());

  /** The rows the grid shows: the whole portfolio, or the ones the toolbar filter keeps. */
  private visibleRows: LivePortfolioRow[] = this.portfolio.rows;

  /** The exporters whose column events this sample listens to, so they can be released on removal. */
  private readonly exportSubscriptions = new Map<ToolbarExporter, { unsubscribe(): void }>();

  /** Stops the polling of sparklines the grid drops, which the chart does not do on its own. */
  private readonly janitor = new SparklineJanitor();

  @query("igc-grid")
  private grid?: IgcGridComponent;

  /** The grid the janitor currently watches. */
  private watchedGrid?: IgcGridComponent;

  /** Pending build of the grid after the element returned to the page; see `GRID_REBUILD_DELAY_MS`. */
  private rebuildTimer: ReturnType<typeof setTimeout> | undefined;

  /** False while a returning element waits to build a new grid, because the old one released its sparklines. */
  @state()
  private showGrid = true;

  /** Whether the grid's own stylesheet has arrived (or failed to); until then the grid is not painted. */
  @state()
  private themeSettled = false;

  @state()
  private isDark = false;

  @state()
  private assetFilter = "";

  /** Whether the viewport is below the breakpoint; kept as a flag so only a crossing re-renders. */
  @state()
  private narrow = window.innerWidth < NARROW_VIEWPORT_PX;

  connectedCallback(): void {
    // Theme and fonts are applied when the sample is shown, not on import: the shell bundle loads
    // every sample's module into every page.
    configureTheme("fluent", "light");
    ensureDocumentStylesheet(FONTS_HREF);
    registerFinanceIcons();
    window.addEventListener("resize", this.onResize);
    // The window may have been resized while the element was away.
    this.onResize();
    if (this.janitor.released) {
      // The sparklines were destroyed when the element was removed, and a destroyed sparkline cannot
      // be revived: the grid is built anew.
      this.janitor.reset();
      this.showGrid = false;
      this.rebuildTimer = setTimeout(() => {
        this.rebuildTimer = undefined;
        this.showGrid = true;
      }, GRID_REBUILD_DELAY_MS);
    }
    super.connectedCallback();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("resize", this.onResize);
    // Moving the element (remove and append within one task) disconnects and reconnects it, and has
    // to cost nothing: only a removal that outlasts the task releases what the grid holds.
    queueMicrotask(() => {
      if (!this.isConnected) {
        this.release();
      }
    });
  }

  /** Lets go of everything that would otherwise run on after the element has left the page. */
  private release(): void {
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = undefined;
    this.janitor.releaseAll(this.grid ?? null);
    for (const subscription of this.exportSubscriptions.values()) {
      subscription.unsubscribe();
    }
    this.exportSubscriptions.clear();
  }

  protected firstUpdated(): void {
    prepareGridShadowRoot(this.renderRoot as ShadowRoot);
  }

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has("assetFilter")) {
      const query = this.assetFilter.trim().toLowerCase();
      this.visibleRows = query
        ? this.portfolio.rows.filter(
            (row) => row.ticker.toLowerCase().includes(query) || row.company.toLowerCase().includes(query)
          )
        : this.portfolio.rows;
    }
  }

  protected updated(changed: PropertyValues): void {
    const grid = this.grid;
    if (grid && grid !== this.watchedGrid) {
      this.watchedGrid = grid;
      this.janitor.observe(grid);
    }

    // The cell templates read the appearance (the sparkline brushes are plain inputs) and the filter
    // (the highlight), and the grid has no reason to re-run them when only a property the host
    // owns has changed: a row that survives the filter keeps its cells.
    if (changed.has("isDark") || changed.has("assetFilter")) {
      this.grid?.markForCheck();
    }
  }

  private readonly onResize = (): void => {
    this.narrow = window.innerWidth < NARROW_VIEWPORT_PX;
  };

  private readonly onThemeSettled = (): void => {
    this.themeSettled = true;
  };

  private toggleTheme(): void {
    this.isDark = !this.isDark;
  }

  private toggleLive(): void {
    this.portfolio.toggle();
  }

  private readonly onAssetSearch = (event: CustomEvent<string>): void => {
    this.assetFilter = event.detail;
  };

  /**
   * Keeps the sparkline column out of every export. The exporters are created once and reused, so
   * each is subscribed to the first time it is seen, and released when the element leaves the page.
   */
  private readonly onToolbarExporting = (event: CustomEvent<IgcGridToolbarExportEventArgs>): void => {
    const exporter = event.detail.exporter as unknown as ToolbarExporter;
    if (!this.exportSubscriptions.has(exporter)) {
      this.exportSubscriptions.set(exporter, exporter.columnExporting.subscribe(this.skipChartColumn));
    }
  };

  private readonly skipChartColumn = (args: IgcColumnExportingEventArgs): void => {
    if (args.field === NON_EXPORTABLE_FIELD) {
      args.cancel = true;
    }
  };

  private readonly assetCell = (context: IgcCellTemplateContext): TemplateResult => {
    const row = rowOf(context);
    return html`
      <div class="ticker-cell">
        <igc-avatar
          class="ticker-logo tone-${row.tone}"
          shape="circle"
          initials=${avatarInitials(row.ticker)}
          aria-hidden="true"
        ></igc-avatar>
        <div class="ticker-meta">
          <span class="ticker-symbol">${highlightedText(row.ticker, this.assetFilter)}</span>
          <span class="ticker-name">${highlightedText(row.company, this.assetFilter)}</span>
        </div>
      </div>
    `;
  };

  private readonly trendCell = (context: IgcCellTemplateContext): TemplateResult => {
    const row = rowOf(context);
    return html`
      <igc-sparkline
        class="price-trend-spark"
        width="100%"
        height="20px"
        .dataSource=${context.cell.value}
        .valueMemberPath=${"value"}
        .displayType=${SparklineDisplayType.Line}
        .lineThickness=${1.8}
        .brush=${sparklineBrush(row.changePct, this.isDark)}
        .negativeBrush=${sparklineNegativeBrush(this.isDark)}
      ></igc-sparkline>
    `;
  };

  private readonly priceCell = (context: IgcCellTemplateContext): TemplateResult => {
    const row = rowOf(context);
    // Percentage first in the DOM as well as on screen, so the reading order a screen reader takes
    // is the order the cell is laid out in.
    return html`
      <div class="price-combined-cell">
        ${this.deltaChip(row, row.changePct)}
        <span class="numeric-cell price-combined-price">${formatCurrency(row.lastPrice)}</span>
      </div>
    `;
  };

  private readonly holdingCell = (context: IgcCellTemplateContext): TemplateResult => {
    const term = holdingTerm(context.cell.value);
    return html`
      <div class="holding-cell">
        <div class="holding-head">
          <igc-chip
            class="finance-chip finance-term-chip"
            outlined
            variant=${term.variant}
            tabindex="-1"
            aria-hidden="true"
            >${term.label}</igc-chip
          >
          <span class="holding-elapsed">${term.elapsed}</span>
        </div>
        <igc-linear-progress
          class="holding-bar"
          .value=${term.progressValue}
          .max=${100}
          variant=${term.barVariant}
          hide-label
          .animationDuration=${0}
          aria-hidden="true"
        ></igc-linear-progress>
        <span class="sr-only">${term.hint}</span>
      </div>
    `;
  };

  private readonly marketValueCell = (context: IgcCellTemplateContext): TemplateResult =>
    html`<span class="numeric-cell">${formatCurrency(context.cell.value)}</span>`;

  private readonly netProfitCell = (context: IgcCellTemplateContext): TemplateResult => {
    const row = rowOf(context);
    return html`
      <div class="net-profit-combined-cell">
        ${this.deltaChip(row, row.netProfitPct)}
        <span aria-hidden="true">${formatCurrency(row.netProfit)}</span>
      </div>
    `;
  };

  private readonly allocationCell = (context: IgcCellTemplateContext): TemplateResult => html`
    <div class="allocation-cell">
      <span class="allocation-value">${formatPercent(context.cell.value)}</span>
      <!-- Hidden for the same reason as the Holding Period bar: the value it would announce is the
           share of the *largest* holding, not the figure printed directly above it. -->
      <igc-linear-progress
        class="allocation-bar"
        .value=${allocationBarValue(context.cell.value, this.maxAllocationPct)}
        .max=${100}
        hide-label
        .animationDuration=${0}
        aria-hidden="true"
      ></igc-linear-progress>
    </div>
  `;

  /** The signed percentage as an outlined chip that flashes in the direction of the row's last tick. */
  private deltaChip(row: LivePortfolioRow, value: number): TemplateResult {
    const flash = classMap({ "is-up": row.direction === "up", "is-down": row.direction === "down" });
    return html`<igc-chip
      class="finance-chip finance-delta-chip ${flash}"
      outlined
      variant=${chipVariant(value)}
      tabindex="-1"
      aria-hidden="true"
      >${badgeLabel(value)}</igc-chip
    >`;
  }

  protected render(): TemplateResult {
    // The theme class sits on the shell rather than on the host, so both palettes stay inside the
    // component's own subtree and everything the grid renders, toolbar overlays included,
    // resolves against the live one.
    return html`
      <link
        rel="stylesheet"
        href="${import.meta.env.BASE_URL}themes/fluent.css"
        @load=${this.onThemeSettled}
        @error=${this.onThemeSettled}
      />
      <section
        class="finance-grid-new ${classMap({ "finance-shell": true, "dark-theme": this.isDark })}"
        data-app="finance-grid-new"
        aria-label="Financial portfolio"
      >
        ${this.renderHeader()} ${this.showGrid ? this.renderGrid() : nothing}
      </section>
    `;
  }

  private renderHeader(): TemplateResult {
    const isLive = this.portfolio.isLive;
    return html`
      <header class="finance-topbar">
        <div class="finance-title-wrap">
          <div class="sample-logo">
            <igc-icon
              class="finance-title-icon"
              name="account_balance"
              collection=${ICON_COLLECTION}
              aria-hidden="true"
            ></igc-icon>
          </div>
          <h1>Financial Portfolio</h1>
        </div>

        <div class="finance-topbar-actions">
          <!-- The feed's state in words, for anyone who cannot see the pulsing dot. -->
          <span class=${classMap({ "finance-feed-status": true, "is-paused": !isLive })} role="status">
            <span class="finance-feed-dot" aria-hidden="true"></span>
            ${isLive ? "Live" : "Paused"}
          </span>

          <igc-icon-button
            variant="flat"
            collection=${ICON_COLLECTION}
            name=${isLive ? "pause" : "play_arrow"}
            title=${isLive ? "Pause live market updates" : "Resume live market updates"}
            aria-label=${isLive ? "Pause live market updates" : "Resume live market updates"}
            @click=${this.toggleLive}
          ></igc-icon-button>

          <igc-icon-button
            variant="flat"
            collection=${ICON_COLLECTION}
            name=${this.isDark ? "light_mode" : "dark_mode"}
            title=${this.isDark ? "Switch to light theme" : "Switch to dark theme"}
            aria-label=${this.isDark ? "Switch to light theme" : "Switch to dark theme"}
            @click=${this.toggleTheme}
          ></igc-icon-button>
        </div>
      </header>
    `;
  }

  private renderGrid(): TemplateResult {
    // The row height is stated because three columns stack two rows of figures. The large size
    // budgets 50px, and an outlined chip over an outlined chip is 47px of that before the cell's
    // own padding, so the taller stacks were clipping. 60px carries them with room to breathe and
    // leaves the single-line columns comfortable rather than cramped.
    //
    // `ig-typography` and `ig-scrollbar` are the classes the grid theme keys its type scale and
    // scrollbars on. They have to sit inside this shadow root: a class on the page's body does not
    // reach it.
    return html`
      <igc-grid
        class="finance-grid ig-typography ig-scrollbar ${classMap({ "is-pending": !this.themeSettled })}"
        .data=${this.visibleRows}
        .autoGenerate=${false}
        .showGroupArea=${true}
        row-selection="none"
        primary-key="ticker"
        height="100%"
        .rowHeight=${60}
        @toolbarExporting=${this.onToolbarExporting}
      >
        <igc-grid-toolbar>
          <igc-grid-toolbar-title>Holdings</igc-grid-toolbar-title>
          <igc-input
            class="finance-toolbar-search"
            id="finance-asset-filter"
            type="search"
            placeholder="Filter by asset"
            aria-label="Filter by asset"
            .value=${this.assetFilter}
            @igcInput=${this.onAssetSearch}
          >
            <igc-icon slot="prefix" name="search" collection=${ICON_COLLECTION} aria-hidden="true"></igc-icon>
          </igc-input>
          <igc-grid-toolbar-actions>
            <igc-grid-toolbar-hiding></igc-grid-toolbar-hiding>
            <igc-grid-toolbar-pinning></igc-grid-toolbar-pinning>
            <igc-grid-toolbar-exporter></igc-grid-toolbar-exporter>
          </igc-grid-toolbar-actions>
        </igc-grid-toolbar>

        <igc-column
          field="ticker"
          header="Asset"
          sortable
          .filterable=${false}
          min-width="260px"
          .bodyTemplate=${this.assetCell}
        ></igc-column>

        <igc-column
          field="priceTrend"
          header="Price Trend"
          .sortable=${false}
          .filterable=${false}
          min-width="200px"
          .hidden=${this.narrow}
          .bodyTemplate=${this.trendCell}
        ></igc-column>

        <igc-column
          field="lastPrice"
          header="Price (Change)"
          sortable
          .filterable=${false}
          min-width="200px"
          data-type="number"
          .bodyTemplate=${this.priceCell}
        ></igc-column>

        <igc-column
          field="holdingPeriodDays"
          header="Holding Period"
          sortable
          .filterable=${false}
          min-width="230px"
          .hidden=${this.narrow}
          .bodyTemplate=${this.holdingCell}
        ></igc-column>

        <igc-column
          field="marketValue"
          header="Market Value"
          sortable
          .filterable=${false}
          min-width="180px"
          .hidden=${this.narrow}
          data-type="number"
          .bodyTemplate=${this.marketValueCell}
        ></igc-column>

        <igc-column
          field="netProfit"
          header="Total Revenue"
          sortable
          .filterable=${false}
          min-width="200px"
          data-type="number"
          .bodyTemplate=${this.netProfitCell}
        ></igc-column>

        <igc-column
          field="allocationPct"
          header="Allocation"
          sortable
          .filterable=${false}
          min-width="170px"
          .bodyTemplate=${this.allocationCell}
        ></igc-column>
      </igc-grid>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "app-finance-grid-new": FinanceGridNew;
  }
}
