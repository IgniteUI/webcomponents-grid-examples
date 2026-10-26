import { LitElement, html, unsafeCSS, type TemplateResult } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { defineComponents, IgcIconButtonComponent, IgcLinearProgressComponent } from "igniteui-webcomponents";
import type {
  IgcActionStripComponent,
  IgcCellTemplateContext,
  IgcGridComponent,
  IgcGridRowEventArgs,
} from "igniteui-webcomponents-grids/grids";
import "igniteui-webcomponents-grids/grids/combined.js";
import type { Position } from "../models/stock.model.js";
import type { Desk } from "../services/desk.js";
import { money, price, signed } from "../util/format.js";
import { prepareGridShadowRoot } from "../util/grid-shadow-root.js";
import { ICONS } from "../util/icons.js";
import { refreshOnTick } from "../util/live-grid.js";
import { StoreController, memoize } from "../util/store.js";
import { CurrencySumSummary } from "./positions-summaries.js";
import styles from "./positions-grid.scss?inline";

defineComponents(IgcIconButtonComponent, IgcLinearProgressComponent);

/** The row an action strip is showing for. The strip's typings do not declare it. */
interface RowContext {
  data?: Position;
}

/**
 * Positions & P&L: the book marked to the live market, with the totals that
 * matter under it.
 */
@customElement("grid-fintech-dock-manager-positions")
export default class PositionsPane extends LitElement {
  static styles = unsafeCSS(styles);

  @property({ attribute: false }) desk!: Desk;

  @query("igc-grid") private grid?: IgcGridComponent;
  @query("igc-action-strip") private actionStrip?: IgcActionStripComponent;

  private readonly selectedRowsFor = memoize((symbol: string) => [symbol]);

  constructor() {
    super();
    new StoreController(this)
      // The positions array is stable across ticks: rows are marked to market
      // in place, so a mark-to-market pass only repaints the cells.
      .on(() => this.desk.trading, "marks", refreshOnTick(() => this.grid))
      .watch(() => this.desk.trading, "book", "account", "marks")
      .watch(() => this.desk.workspace, "selection");
  }

  protected firstUpdated(): void {
    // The grid renders in this shadow root: give it its structural styles and let
    // its throttled scroll and input handlers read their event targets.
    prepareGridShadowRoot(this.renderRoot as ShadowRoot);
  }

  private get rowSymbol(): string | undefined {
    return (this.actionStrip as (IgcActionStripComponent & { context?: RowContext }) | undefined)?.context?.data?.symbol;
  }

  private onRowClick(event: CustomEvent<IgcGridRowEventArgs>): void {
    const symbol = event.detail.row.key as string | undefined;
    if (symbol) {
      this.desk.workspace.selectSymbol(symbol);
    }
  }

  private addTo(): void {
    const symbol = this.rowSymbol;
    if (symbol) {
      this.desk.workspace.prepareOrder(symbol, "BUY");
    }
  }

  /** Sells the whole position at market: the desk's "flatten" shortcut. */
  private flatten(): void {
    const symbol = this.rowSymbol;
    if (symbol) {
      this.desk.trading.flatten(symbol);
    }
  }

  private readonly symbolTemplate = (ctx: IgcCellTemplateContext) => html`<span class="symbol-cell">${ctx.cell.value}</span>`;

  private readonly moneyTemplate = (ctx: IgcCellTemplateContext) => html`<span>${money(ctx.cell.value)}</span>`;

  private readonly lastTemplate = (ctx: IgcCellTemplateContext) => html`<span class="live-price">${money(ctx.cell.value)}</span>`;

  private readonly dayPlTemplate = (ctx: IgcCellTemplateContext) =>
    this.plCell(ctx.cell.value as number, (ctx.cell.row.data as Position).dayChangePct);

  private readonly openPlTemplate = (ctx: IgcCellTemplateContext) =>
    this.plCell(ctx.cell.value as number, (ctx.cell.row.data as Position).openPlPct);

  private readonly weightTemplate = (ctx: IgcCellTemplateContext) => {
    const value = ctx.cell.value as number;
    return html`
      <div class="weight-cell" title="${value}% of gross exposure">
        <igc-linear-progress class="weight-bar" .value=${value} .max=${100} hide-label></igc-linear-progress>
        <span class="weight-value">${price(value, 1)}%</span>
      </div>
    `;
  };

  private plCell(value: number, pct: number): TemplateResult {
    return html`
      <div class="pl-cell ${value >= 0 ? "pos-pnl" : "neg-pnl"}">
        <span class="pl-amount">${signed(value, "money")}</span>
        <span class="pl-pct">${signed(pct, "pct")}</span>
      </div>
    `;
  }

  protected render(): TemplateResult {
    const { trading, workspace } = this.desk;
    const account = trading.account;

    return html`
      <link rel="stylesheet" href="${import.meta.env.BASE_URL}themes/fluent.css" />

      <div class="grid-host ig-typography">
        <igc-grid
          class="positions-grid"
          .data=${trading.positions}
          primary-key="symbol"
          .autoGenerate=${false}
          .hideRowSelectors=${true}
          row-selection="single"
          .selectedRows=${this.selectedRowsFor(workspace.selectedSymbol)}
          .rowHeight=${38}
          .summaryRowHeight=${42}
          height="100%"
          width="100%"
          empty-grid-message="No open positions \u2014 place an order to build the book."
          @rowClick=${this.onRowClick}
        >
          <igc-column field="symbol" header="Symbol" .sortable=${true} .pinned=${true} width="88px" .bodyTemplate=${this.symbolTemplate}></igc-column>
          <igc-column field="quantity" header="Qty" data-type="number" .sortable=${true} width="64px"></igc-column>
          <igc-column field="avgCost" header="Avg cost" data-type="number" .sortable=${true} width="94px" .bodyTemplate=${this.moneyTemplate}></igc-column>
          <igc-column field="last" header="Last" data-type="number" .sortable=${true} width="94px" .bodyTemplate=${this.lastTemplate}></igc-column>
          <igc-column
            field="marketValue"
            header="Market value"
            data-type="number"
            .sortable=${true}
            .hasSummary=${true}
            .summaries=${CurrencySumSummary}
            width="120px"
            .bodyTemplate=${this.moneyTemplate}
          ></igc-column>
          <igc-column
            field="dayChange"
            header="Day P&L"
            data-type="number"
            .sortable=${true}
            .hasSummary=${true}
            .summaries=${CurrencySumSummary}
            width="118px"
            .bodyTemplate=${this.dayPlTemplate}
          ></igc-column>
          <igc-column
            field="openPl"
            header="Open P&L"
            data-type="number"
            .sortable=${true}
            .hasSummary=${true}
            .summaries=${CurrencySumSummary}
            width="118px"
            .bodyTemplate=${this.openPlTemplate}
          ></igc-column>
          <igc-column field="weight" header="Weight" data-type="number" .sortable=${true} width="96px" .bodyTemplate=${this.weightTemplate}></igc-column>

          <igc-action-strip>
            <igc-icon-button
              variant="flat"
              name="add"
              collection=${ICONS}
              title="Add to position"
              aria-label="Add to position"
              @click=${this.addTo}
            ></igc-icon-button>
            <igc-icon-button
              variant="flat"
              class="flatten-btn"
              name="close_fullscreen"
              collection=${ICONS}
              title="Flatten position at market"
              aria-label="Flatten position at market"
              @click=${this.flatten}
            ></igc-icon-button>
          </igc-action-strip>
        </igc-grid>
      </div>

      <!-- Net liq. and Day P&L are account-wide and already sit in the command
           bar. What is left here is what the book itself says: unrealised,
           realised, and how much of the account it uses. -->
      <footer class="account-footer">
        <div class="footer-stat">
          <span class="footer-label">Open P&amp;L</span>
          <span class="footer-value mono ${account.openPl >= 0 ? "pos-pnl" : "neg-pnl"}">${signed(account.openPl, "money")}</span>
        </div>
        <div class="footer-stat">
          <span class="footer-label">Realised</span>
          <span class="footer-value mono ${account.realizedPl >= 0 ? "pos-pnl" : "neg-pnl"}">${signed(account.realizedPl, "money")}</span>
        </div>
        <div class="footer-stat">
          <span class="footer-label">Exposure</span>
          <span class="footer-value mono">${price(account.utilisation, 1)}%</span>
        </div>
      </footer>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "grid-fintech-dock-manager-positions": PositionsPane;
  }
}
