import { LitElement, html, unsafeCSS, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import {
  defineComponents,
  IgcBadgeComponent,
  IgcButtonComponent,
  IgcChipComponent,
  IgcIconButtonComponent,
  IgcIconComponent,
} from "igniteui-webcomponents";
import type {
  IgcActionStripComponent,
  IgcCellTemplateContext,
  IgcGridRowEventArgs,
} from "igniteui-webcomponents-grids/grids";
import "igniteui-webcomponents-grids/grids/combined.js";
import type { Order, OrderStatus } from "../models/stock.model.js";
import type { Desk } from "../services/desk.js";
import { money, shortClock } from "../util/format.js";
import { prepareGridShadowRoot } from "../util/grid-shadow-root.js";
import { ICONS } from "../util/icons.js";
import { StoreController, memoize } from "../util/store.js";
import styles from "./blotter.scss?inline";

defineComponents(IgcBadgeComponent, IgcButtonComponent, IgcChipComponent, IgcIconButtonComponent, IgcIconComponent);

const STATUS_FILTERS = ["All", "Working", "Filled", "Cancelled"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

type BadgeVariant = "warning" | "success" | "danger" | "primary";

/** An order plus the single price the blotter shows for it. */
interface BlotterRow extends Order {
  /** Fill price once filled, otherwise the resting limit or stop. */
  displayPrice: number | null;
  priceKind: "Fill" | "Limit" | "Stop" | "Trail" | "Mkt";
}

/** The row an action strip is showing for. The strip's typings do not declare it. */
interface RowContext {
  data?: BlotterRow;
}

/** Order status to badge colour. */
function badgeVariant(status: OrderStatus): BadgeVariant {
  switch (status) {
    case "Working":
      return "warning";
    case "Filled":
      return "success";
    case "Rejected":
      return "danger";
    default:
      return "primary";
  }
}

function toBlotterRow(order: Order): BlotterRow {
  if (order.status === "Filled") {
    return { ...order, displayPrice: order.fillPrice, priceKind: "Fill" };
  }

  switch (order.type) {
    case "Market":
      return { ...order, displayPrice: null, priceKind: "Mkt" };
    case "Limit":
      return { ...order, displayPrice: order.limitPrice, priceKind: "Limit" };
    case "Trailing Stop":
      return { ...order, displayPrice: order.stopPrice, priceKind: "Trail" };
    default:
      return { ...order, displayPrice: order.stopPrice ?? order.limitPrice, priceKind: "Stop" };
  }
}

function countBy(orders: readonly Order[], status: OrderStatus): number {
  return orders.reduce((total, order) => total + (order.status === status ? 1 : 0), 0);
}

/** The order blotter: every order of the session, working, filled and refused. */
@customElement("grid-fintech-dock-manager-blotter")
export default class BlotterPane extends LitElement {
  static styles = unsafeCSS(styles);

  @property({ attribute: false }) desk!: Desk;

  @state() private activeFilter: StatusFilter = "All";

  @query("igc-action-strip") private actionStrip?: IgcActionStripComponent;

  /** The order the row actions were last rendered for. */
  private stripOrder: BlotterRow | undefined;
  private stripCheck: ReturnType<typeof setTimeout> | undefined;

  private readonly rowsFor = memoize((orders: readonly Order[], filter: StatusFilter): BlotterRow[] =>
    orders.filter((order) => filter === "All" || order.status === filter).map(toBlotterRow),
  );

  /** Per-status counts for the filter chips. */
  private readonly countsFor = memoize(
    (orders: readonly Order[]): Record<StatusFilter, number> => ({
      All: orders.length,
      Working: countBy(orders, "Working"),
      Filled: countBy(orders, "Filled"),
      Cancelled: countBy(orders, "Cancelled") + countBy(orders, "Rejected"),
    }),
  );

  constructor() {
    super();
    new StoreController(this).watch(() => this.desk.trading, "orders");
  }

  protected firstUpdated(): void {
    // The grid renders in this shadow root: give it its structural styles and let
    // its throttled scroll and input handlers read their event targets.
    prepareGridShadowRoot(this.renderRoot as ShadowRoot);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.stripCheck);
  }

  private get rowOrder(): BlotterRow | undefined {
    return (this.actionStrip as (IgcActionStripComponent & { context?: RowContext }) | undefined)?.context?.data;
  }

  /**
   * Single-choice filter, which the chips do not model on their own. A filter
   * is always applied, so clicking the active chip puts it back rather than
   * clearing the selection.
   */
  private onFilterChipSelect(filter: StatusFilter, event: CustomEvent<boolean>): void {
    if (!event.detail) {
      (event.target as IgcChipComponent).selected = true;
      return;
    }

    this.activeFilter = filter;
  }

  /**
   * The grid moves its row actions to a row as the pointer enters it. That
   * happens after this pane hears the pointer arrive, so the check waits for the
   * event to finish before it re-renders the cancel action for the new row.
   */
  private onGridPointerOver(): void {
    if (this.stripCheck !== undefined) {
      return;
    }

    this.stripCheck = setTimeout(() => {
      this.stripCheck = undefined;
      if (this.rowOrder !== this.stripOrder) {
        this.requestUpdate();
      }
    });
  }

  private onRowClick(event: CustomEvent<IgcGridRowEventArgs>): void {
    const symbol = (event.detail.row.data as BlotterRow | undefined)?.symbol;
    if (symbol) {
      this.desk.workspace.selectSymbol(symbol);
    }
  }

  private cancel(): void {
    const order = this.rowOrder;
    if (order?.status === "Working") {
      this.desk.trading.cancelOrder(order.id);
    }
  }

  private cancelAll(): void {
    this.desk.trading.cancelAllWorking();
  }

  private readonly timeTemplate = (ctx: IgcCellTemplateContext) => html`<span>${shortClock(ctx.cell.value as Date)}</span>`;

  private readonly symbolTemplate = (ctx: IgcCellTemplateContext) => html`<span class="symbol-cell">${ctx.cell.value}</span>`;

  private readonly sideTemplate = (ctx: IgcCellTemplateContext) => {
    const value = ctx.cell.value as string;
    return html`<span class="side-tag ${value === "BUY" ? "side-buy" : value === "SELL" ? "side-sell" : ""}">${value}</span>`;
  };

  private readonly priceTemplate = (ctx: IgcCellTemplateContext) => html`
    <span>${money(ctx.cell.value as number | null)}</span>
    <span class="price-kind">${(ctx.cell.row.data as BlotterRow).priceKind}</span>
  `;

  private readonly statusTemplate = (ctx: IgcCellTemplateContext) => {
    const status = ctx.cell.value as OrderStatus;
    return html`<igc-badge class="status-badge" variant=${badgeVariant(status)}>${status}</igc-badge>`;
  };

  private readonly noteTemplate = (ctx: IgcCellTemplateContext) =>
    html`<span class="note-cell" title=${ctx.cell.value}>${ctx.cell.value}</span>`;

  protected willUpdate(): void {
    // The cancel action is rendered for the row the strip sits on now.
    this.stripOrder = this.rowOrder;
  }

  protected render(): TemplateResult {
    const orders = this.desk.trading.orders;
    const counts = this.countsFor(orders);
    const working = this.desk.trading.workingOrders.length;

    return html`
      <link rel="stylesheet" href="${import.meta.env.BASE_URL}themes/fluent.css" />

      <header class="blotter-bar">
        <div class="blotter-filters" role="group" aria-label="Filter orders by status">
          ${STATUS_FILTERS.map(
            (filter) => html`
              <igc-chip
                selectable
                .selected=${live(this.activeFilter === filter)}
                @igcSelect=${(event: CustomEvent<boolean>) => this.onFilterChipSelect(filter, event)}
              >
                ${filter}
                <span slot="suffix" class="filter-count">${counts[filter]}</span>
              </igc-chip>
            `,
          )}
        </div>

        <igc-button variant="flat" class="cancel-all" ?disabled=${working === 0} @click=${this.cancelAll}>
          <igc-icon slot="prefix" name="cancel" collection=${ICONS} aria-hidden="true"></igc-icon>
          Cancel all
        </igc-button>
      </header>

      <div class="grid-host ig-typography">
        <igc-grid
          class="blotter-grid"
          .data=${this.rowsFor(orders, this.activeFilter)}
          primary-key="id"
          .autoGenerate=${false}
          .hideRowSelectors=${true}
          .rowHeight=${36}
          height="100%"
          width="100%"
          empty-grid-message="No orders yet \u2014 place one from the ticket."
          @rowClick=${this.onRowClick}
          @mouseover=${this.onGridPointerOver}
        >
          <igc-column field="placedAt" header="Time" data-type="date" .sortable=${true} width="70px" .bodyTemplate=${this.timeTemplate}></igc-column>
          <igc-column field="symbol" header="Symbol" .sortable=${true} width="82px" .bodyTemplate=${this.symbolTemplate}></igc-column>
          <igc-column field="side" header="Side" .sortable=${true} width="62px" .bodyTemplate=${this.sideTemplate}></igc-column>
          <igc-column field="quantity" header="Qty" data-type="number" .sortable=${true} width="62px"></igc-column>
          <igc-column field="type" header="Type" .sortable=${true} width="104px"></igc-column>
          <igc-column field="displayPrice" header="Price" data-type="number" .sortable=${true} width="112px" .bodyTemplate=${this.priceTemplate}></igc-column>
          <igc-column field="timeInForce" header="TIF" .sortable=${true} width="62px"></igc-column>
          <igc-column field="status" header="Status" .sortable=${true} width="96px" .bodyTemplate=${this.statusTemplate}></igc-column>
          <igc-column field="note" header="Detail" width="240px" .bodyTemplate=${this.noteTemplate}></igc-column>

          <igc-action-strip>
            <igc-icon-button
              variant="flat"
              name="delete_outline"
              collection=${ICONS}
              title="Cancel order"
              aria-label="Cancel order"
              ?disabled=${this.stripOrder?.status !== "Working"}
              @click=${this.cancel}
            ></igc-icon-button>
          </igc-action-strip>
        </igc-grid>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "grid-fintech-dock-manager-blotter": BlotterPane;
  }
}
