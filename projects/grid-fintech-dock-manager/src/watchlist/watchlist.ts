import { LitElement, html, nothing, unsafeCSS, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import {
  defineComponents,
  IgcComboComponent,
  IgcIconButtonComponent,
  IgcIconComponent,
  IgcInputComponent,
  IgcListComponent,
  IgcTabsComponent,
  type IgcComboChangeEventArgs,
} from "igniteui-webcomponents";
import type {
  IgcActionStripComponent,
  IgcCellTemplateContext,
  IgcGridComponent,
  IgcGridRowEventArgs,
} from "igniteui-webcomponents-grids/grids";
import "igniteui-webcomponents-grids/grids/combined.js";
import { TRADABLE_SYMBOLS } from "../data/market-seed.js";
import type { StockItem } from "../models/stock.model.js";
import type { Desk } from "../services/desk.js";
import { rangePosition } from "../util/finance.js";
import { compact, price, signed } from "../util/format.js";
import { prepareGridShadowRoot } from "../util/grid-shadow-root.js";
import { ICONS } from "../util/icons.js";
import { refreshOnTick } from "../util/live-grid.js";
import { StoreController, memoize } from "../util/store.js";
import styles from "./watchlist.scss?inline";

defineComponents(IgcComboComponent, IgcIconButtonComponent, IgcIconComponent, IgcInputComponent, IgcListComponent, IgcTabsComponent);

const MOVER_TABS = ["Gainers", "Losers", "Most Active"] as const;
type MoverTab = (typeof MOVER_TABS)[number];

/** How many rows each movers tab shows. */
const MOVERS_LIMIT = 5;

/** One entry of the add-symbol picker. */
interface SymbolOption {
  symbol: string;
  added: boolean;
}

/** The row an action strip is showing for. The strip's typings do not declare it. */
interface RowContext {
  data?: StockItem;
}

/**
 * The columns the template declares hidden or pinned, before the toolbar's hide
 * and pin menus can change them. Every other column is declared shown and
 * unpinned. The template binds these, and a reset puts them back.
 */
const DECLARED_COLUMNS: Readonly<Partial<Record<keyof StockItem, { hidden?: boolean; pinned?: boolean }>>> = {
  symbol: { pinned: true },
  bid: { hidden: true },
  ask: { hidden: true },
  avgVol3M: { hidden: true },
};

const isDeclaredHidden = (field: keyof StockItem): boolean => DECLARED_COLUMNS[field]?.hidden ?? false;
const isDeclaredPinned = (field: keyof StockItem): boolean => DECLARED_COLUMNS[field]?.pinned ?? false;

/** Inline, because the combo renders its items inside its own shadow root. */
const OPTION_STYLE = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", width: "100%" };
/** Present for context, not for picking. */
const OPTION_ADDED_STYLE = { ...OPTION_STYLE, opacity: "0.45", cursor: "default" };
const OPTION_TAG_STYLE = {
  fontSize: "9px",
  fontWeight: "600",
  textTransform: "uppercase",
  letterSpacing: "0.6px",
  color: "var(--ig-gray-700)",
};

/**
 * The watchlist pane: the trader's instruments against the live feed, a filter
 * and an add-symbol picker above them, and the day's movers below.
 */
@customElement("grid-fintech-dock-manager-watchlist")
export default class WatchlistPane extends LitElement {
  static styles = unsafeCSS(styles);

  @property({ attribute: false }) desk!: Desk;

  /** Index rather than name: the tabs report the tab, and the index finds its name. */
  @state() private activeMoverIndex = 0;

  @query("igc-grid") private grid?: IgcGridComponent;
  @query("igc-combo") private addCombo?: IgcComboComponent<SymbolOption>;
  @query("igc-action-strip") private actionStrip?: IgcActionStripComponent;

  /** The watchlist joined against the live feed, in the trader's own order. */
  private readonly quotesFor = memoize((watchlist: readonly string[]) =>
    watchlist.map((symbol) => this.desk.market.quoteOf(symbol)).filter((quote): quote is StockItem => quote !== undefined),
  );

  /**
   * The grid's `data`. Deliberately independent of the price tick: these are
   * the live quote objects, so a new price shows up through `markForCheck()`
   * rather than a new array, which would make the grid re-measure and its
   * scrollbar flicker once a second.
   */
  private readonly rowsFor = memoize((quotes: readonly StockItem[], search: string) => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return quotes;
    }

    return quotes.filter((quote) => `${quote.symbol} ${quote.name} ${quote.sector}`.toLowerCase().includes(query));
  });

  /** Bound to the grid so the shared symbol and the highlighted row cannot drift. */
  private readonly selectedRowsFor = memoize((symbol: string) => [symbol]);

  /**
   * The whole universe, each entry flagged with whether it is already watched.
   *
   * Watched symbols stay in the list rather than being filtered out: the
   * drop-down then reads the same every time, and "already added" is stated
   * rather than left to be inferred from an absence.
   */
  private readonly symbolOptionsFor = memoize((watchlist: readonly string[]): SymbolOption[] => {
    const watched = new Set(watchlist);
    return TRADABLE_SYMBOLS.map((symbol) => ({ symbol, added: watched.has(symbol) }));
  });

  constructor() {
    super();
    new StoreController(this)
      // The movers re-rank on every tick; the grid only repaints its cells.
      .watch(() => this.desk.market, "tick")
      .on(() => this.desk.market, "tick", refreshOnTick(() => this.grid))
      .watch(() => this.desk.workspace, "watchlist", "search", "selection")
      // Hiding, pinning, sorting and filtering live on the grid's own columns,
      // out of reach of the workspace, so a reset has to restore them here.
      .on(() => this.desk.workspace, "reset", () => this.restoreColumns());
  }

  protected firstUpdated(): void {
    // The grid renders in this shadow root: give it its structural styles and let
    // its throttled scroll and input handlers read their event targets.
    prepareGridShadowRoot(this.renderRoot as ShadowRoot);
  }

  private get rows(): readonly StockItem[] {
    const { workspace } = this.desk;
    return this.rowsFor(this.quotesFor(workspace.watchlist), workspace.searchQuery);
  }

  /** Recomputed per render: the ordering, unlike the grid, is price-dependent. */
  private get movers(): StockItem[] {
    const rows = this.rows;
    const tab: MoverTab = MOVER_TABS[this.activeMoverIndex];

    switch (tab) {
      case "Gainers":
        return rows
          .filter((row) => row.changePct > 0)
          .sort((a, b) => b.changePct - a.changePct)
          .slice(0, MOVERS_LIMIT);
      case "Losers":
        return rows
          .filter((row) => row.changePct < 0)
          .sort((a, b) => a.changePct - b.changePct)
          .slice(0, MOVERS_LIMIT);
      default:
        return [...rows].sort((a, b) => b.volume - a.volume).slice(0, MOVERS_LIMIT);
    }
  }

  /**
   * Puts the columns back as declared. Properties are flipped on the live
   * columns rather than the columns being re-created, so their cell templates
   * stay in place.
   */
  private restoreColumns(): void {
    const grid = this.grid;
    if (!grid) {
      return;
    }

    for (const column of grid.columns) {
      const field = column.field as keyof StockItem;
      const pinned = isDeclaredPinned(field);
      if (column.pinned !== pinned) {
        if (pinned) {
          column.pin();
        } else {
          column.unpin();
        }
      }

      column.hidden = isDeclaredHidden(field);
    }

    grid.clearSort();
    grid.clearFilter();
  }

  private focusSymbol(symbol: string | undefined): void {
    if (symbol) {
      this.desk.workspace.focusSymbol(symbol);
    }
  }

  private onSearchInput(event: CustomEvent<string>): void {
    this.desk.workspace.updateSearchQuery(event.detail);
  }

  /**
   * Enter opens a chart for the first row the filter leaves: the rows the
   * trader can actually see, rather than a match against the whole universe.
   */
  private onSearchKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      this.focusSymbol(this.rows[0]?.symbol);
    }
  }

  private onRowClick(event: CustomEvent<IgcGridRowEventArgs>): void {
    this.focusSymbol(event.detail.row.key as string | undefined);
  }

  private onRemoveClick(): void {
    const symbol = (this.actionStrip as (IgcActionStripComponent & { context?: RowContext }) | undefined)?.context?.data?.symbol;
    if (symbol) {
      this.desk.workspace.removeFromWatchlist(symbol);
    }
  }

  /**
   * The combo is a picker rather than a value holder: it fires the add and keeps
   * no selection. A retained selection would seed the next open's filter with
   * that symbol, so every change is cancelled. Whatever was picked, a symbol that
   * is already watched included, the picker then starts over.
   */
  private addSymbol(event: CustomEvent<IgcComboChangeEventArgs<SymbolOption>>): void {
    event.preventDefault();

    const symbol = event.detail.newValue[0];
    const { workspace } = this.desk;
    if (typeof symbol === "string" && symbol && !workspace.isWatched(symbol)) {
      workspace.addToWatchlist(symbol);
      workspace.selectSymbol(symbol);
    }

    this.resetPicker();
  }

  /**
   * Closes the add-symbol picker and empties it, so that the next open offers the
   * whole universe rather than the matches of the last search. The combo has no
   * reset of its own: it drops its search text and its selection when it is asked
   * to select nothing, and a cancelled change leaves both in place.
   */
  private resetPicker(): void {
    const combo = this.addCombo;
    if (combo) {
      combo.select([]);
      void combo.hide();
    }
  }

  private onMoverTabChange(event: CustomEvent<HTMLElement>): void {
    const index = MOVER_TABS.indexOf(event.detail.dataset.tab as MoverTab);
    if (index >= 0) {
      this.activeMoverIndex = index;
    }
  }

  // Templates

  /** Symbols already on the list stay visible so the universe reads the same every time; they are just marked and inert. */
  private readonly optionTemplate = ({ item }: { item: SymbolOption }): TemplateResult => html`
    <div style=${styleMap(item.added ? OPTION_ADDED_STYLE : OPTION_STYLE)} aria-disabled=${item.added ? "true" : "false"}>
      <span>${item.symbol}</span>
      ${item.added ? html`<span style=${styleMap(OPTION_TAG_STYLE)}>Added</span>` : nothing}
    </div>
  `;

  private readonly symbolTemplate = (ctx: IgcCellTemplateContext) => html`<span class="symbol-cell">${ctx.cell.value}</span>`;

  private readonly priceTemplate = (ctx: IgcCellTemplateContext) => html`<span>${price(ctx.cell.value)}</span>`;

  private readonly compactTemplate = (ctx: IgcCellTemplateContext) => html`<span>${compact(ctx.cell.value)}</span>`;

  private readonly changePctTemplate = (ctx: IgcCellTemplateContext) => {
    const value = ctx.cell.value as number;
    return html`<span class=${value >= 0 ? "pos" : "neg"}>${signed(value, "pct")}</span>`;
  };

  private readonly changeTemplate = (ctx: IgcCellTemplateContext) => {
    const value = ctx.cell.value as number;
    return html`<span class=${value >= 0 ? "pos" : "neg"}>${signed(value)}</span>`;
  };

  private readonly dayRangeTemplate = (ctx: IgcCellTemplateContext) => {
    const quote = ctx.cell.row.data as StockItem;
    return this.rangeCell(quote, quote.dayLow, quote.dayHigh);
  };

  private readonly weekRangeTemplate = (ctx: IgcCellTemplateContext) => {
    const quote = ctx.cell.row.data as StockItem;
    return this.rangeCell(quote, quote.week52Low, quote.week52High);
  };

  /** The current price as a marker on the band between two prices. */
  private rangeCell(quote: StockItem, low: number, high: number): TemplateResult {
    return html`
      <div class="range-cell">
        <span class="range-value">${price(low)}</span>
        <div class="range-track" aria-hidden="true">
          <div
            class="range-marker ${quote.positive ? "pos" : "neg"}"
            style=${styleMap({ left: `${rangePosition(quote.lastPrice, low, high)}%` })}
          ></div>
        </div>
        <span class="range-value">${price(high)}</span>
      </div>
    `;
  }

  protected render(): TemplateResult {
    const { workspace } = this.desk;

    return html`
      <link rel="stylesheet" href="${import.meta.env.BASE_URL}themes/fluent.css" />

      <div class="wl-toolbar">
        <!-- Scoped to this pane: the query filters the grid below and the movers
             tabs, and nothing outside the watchlist reads it. -->
        <igc-input
          class="wl-search"
          type="search"
          placeholder="Filter \u2014 Enter opens a chart"
          aria-label="Filter the watchlist. Press Enter to open a chart for the first match."
          .value=${workspace.searchQuery}
          @igcInput=${this.onSearchInput}
          @keydown=${this.onSearchKeydown}
        >
          <igc-icon slot="prefix" name="filter_alt" collection=${ICONS} aria-hidden="true"></igc-icon>
        </igc-input>

        <igc-combo
          class="wl-add"
          single-select
          .data=${this.symbolOptionsFor(workspace.watchlist)}
          value-key="symbol"
          display-key="symbol"
          placeholder="Add symbol"
          placeholder-search="Search the universe\u2026"
          .itemTemplate=${this.optionTemplate}
          @igcChange=${this.addSymbol}
        >
          <igc-icon slot="prefix" name="add" collection=${ICONS} aria-hidden="true"></igc-icon>
        </igc-combo>
      </div>

      <div class="watchlist-grid-wrap ig-typography">
        <igc-grid
          class="watchlist-grid"
          .data=${this.rows}
          primary-key="symbol"
          .autoGenerate=${false}
          .allowFiltering=${true}
          filter-mode="excelStyleFilter"
          .allowAdvancedFiltering=${true}
          .moving=${true}
          row-selection="single"
          .hideRowSelectors=${true}
          .selectedRows=${this.selectedRowsFor(workspace.selectedSymbol)}
          .rowHeight=${38}
          width="100%"
          height="100%"
          @rowClick=${this.onRowClick}
        >
          <igc-grid-toolbar>
            <igc-grid-toolbar-actions>
              <igc-grid-toolbar-advanced-filtering></igc-grid-toolbar-advanced-filtering>
              <igc-grid-toolbar-pinning></igc-grid-toolbar-pinning>
              <igc-grid-toolbar-hiding></igc-grid-toolbar-hiding>
              <igc-grid-toolbar-exporter .exportCSV=${true} .exportExcel=${true} filename="watchlist"></igc-grid-toolbar-exporter>
            </igc-grid-toolbar-actions>
          </igc-grid-toolbar>

          <igc-column
            field="symbol"
            header="Symbol"
            .sortable=${true}
            .pinned=${isDeclaredPinned("symbol")}
            .disableHiding=${true}
            width="90px"
            .bodyTemplate=${this.symbolTemplate}
          ></igc-column>
          <igc-column field="lastPrice" header="Last" data-type="number" .sortable=${true} width="100px" .bodyTemplate=${this.priceTemplate}></igc-column>
          <igc-column
            field="changePct"
            header="Change %"
            data-type="number"
            .sortable=${true}
            width="105px"
            .bodyTemplate=${this.changePctTemplate}
          ></igc-column>
          <igc-column field="change" header="Change" data-type="number" .sortable=${true} width="95px" .bodyTemplate=${this.changeTemplate}></igc-column>
          <igc-column
            field="bid"
            header="Bid"
            data-type="number"
            .sortable=${true}
            .hidden=${isDeclaredHidden("bid")}
            width="95px"
            .bodyTemplate=${this.priceTemplate}
          ></igc-column>
          <igc-column
            field="ask"
            header="Ask"
            data-type="number"
            .sortable=${true}
            .hidden=${isDeclaredHidden("ask")}
            width="95px"
            .bodyTemplate=${this.priceTemplate}
          ></igc-column>
          <igc-column field="sector" header="Sector" .sortable=${true} width="120px"></igc-column>
          <igc-column field="marketTime" header="Market Time" .sortable=${true} width="120px"></igc-column>
          <igc-column field="volume" header="Volume" data-type="number" .sortable=${true} width="105px" .bodyTemplate=${this.compactTemplate}></igc-column>
          <igc-column
            field="avgVol3M"
            header="Avg Vol 3M"
            data-type="number"
            .sortable=${true}
            .hidden=${isDeclaredHidden("avgVol3M")}
            width="110px"
            .bodyTemplate=${this.compactTemplate}
          ></igc-column>
          <igc-column field="dayHigh" header="Day Range" data-type="number" .sortable=${true} width="230px" .bodyTemplate=${this.dayRangeTemplate}></igc-column>
          <igc-column
            field="week52High"
            header="52-Wk Range"
            data-type="number"
            .sortable=${true}
            width="230px"
            .bodyTemplate=${this.weekRangeTemplate}
          ></igc-column>
          <igc-column
            field="marketCap"
            header="Market Cap"
            data-type="number"
            .sortable=${true}
            width="110px"
            .bodyTemplate=${this.compactTemplate}
          ></igc-column>

          <!-- Removing the symbol is the only thing left that a row click cannot
               do for you: the click already opens the chart and narrows the wire. -->
          <igc-action-strip>
            <igc-icon-button
              variant="flat"
              name="playlist_remove"
              collection=${ICONS}
              title="Remove from watchlist"
              aria-label="Remove from watchlist"
              @click=${this.onRemoveClick}
            ></igc-icon-button>
          </igc-action-strip>
        </igc-grid>
      </div>

      <section class="movers-panel" aria-label="Market movers">
        <igc-tabs class="movers-tabs" alignment="justify" @igcChange=${this.onMoverTabChange}>
          ${MOVER_TABS.map(
            (tab, index) => html`
              <igc-tab data-tab=${tab} ?selected=${index === this.activeMoverIndex}>
                <span slot="label">${tab}</span>
                ${index === this.activeMoverIndex ? this.renderMovers() : nothing}
              </igc-tab>
            `,
          )}
        </igc-tabs>
      </section>
    `;
  }

  private renderMovers(): TemplateResult {
    const movers = this.movers;

    return html`
      <igc-list class="movers-list plain-list">
        ${movers.map(
          (mover) => html`
            <igc-list-item @click=${() => this.focusSymbol(mover.symbol)}>
              <div class="mover-row">
                <span class="mover-symbol">${mover.symbol}</span>
                <span class="mover-last">${price(mover.lastPrice)}</span>
                <span class="mover-change ${mover.changePct >= 0 ? "pos" : "neg"}">${signed(mover.changePct, "pct")}</span>
              </div>
            </igc-list-item>
          `,
        )}
        ${movers.length === 0 ? html`<p class="movers-empty">No symbols match the current search.</p>` : nothing}
      </igc-list>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "grid-fintech-dock-manager-watchlist": WatchlistPane;
  }
}
