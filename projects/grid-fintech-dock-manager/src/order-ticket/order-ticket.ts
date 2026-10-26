import { LitElement, html, nothing, unsafeCSS, type TemplateResult } from "lit";
import { customElement, property, query, queryAll, state } from "lit/decorators.js";
import {
  defineComponents,
  IgcButtonComponent,
  IgcButtonGroupComponent,
  IgcIconComponent,
  IgcInputComponent,
  IgcSelectComponent,
  IgcSnackbarComponent,
} from "igniteui-webcomponents";
import { ORDER_TYPES, TIME_IN_FORCE, type OrderSide, type OrderType, type StockItem, type TimeInForce } from "../models/stock.model.js";
import type { Desk } from "../services/desk.js";
import { COMMISSION_PER_SHARE, commissionFor } from "../services/trading.service.js";
import { round2 } from "../util/finance.js";
import { money, price } from "../util/format.js";
import { ICONS } from "../util/icons.js";
import { StoreController, memoize } from "../util/store.js";
import { LIMIT_TYPES, STOP_TYPES, TicketForm, type TicketField } from "./ticket-form.js";
import styles from "./order-ticket.scss?inline";

defineComponents(
  IgcButtonComponent,
  IgcButtonGroupComponent,
  IgcIconComponent,
  IgcInputComponent,
  IgcSelectComponent,
  IgcSnackbarComponent,
);

const QUICK_QUANTITIES = [25, 50, 100, 500] as const;

/** How long a confirmation stays up. Each new order restarts it. */
const SNACKBAR_TIME = 3200;

/** One segment of the quick-size group. */
interface QuickSize {
  label: string;
  quantity: number;
  disabled: boolean;
  hint?: string;
}

/** The two sides, in the order the button group renders them. */
const SIDE_OPTIONS: readonly { value: OrderSide; label: string }[] = [
  { value: "BUY", label: "Buy" },
  { value: "SELL", label: "Sell" },
];

/** Reads a number field the way a number input reports it: empty is no value. */
const parseNumber = (text: string): number | null => (text === "" ? null : parseFloat(text));

/**
 * The order ticket: the selected instrument's quote ladder, a side, a size, an
 * order type with the prices it needs, an estimate against buying power, and
 * the button that hands the order to the engine.
 */
@customElement("grid-fintech-dock-manager-order-ticket")
export default class OrderTicketPane extends LitElement {
  static styles = unsafeCSS(styles);

  @property({ attribute: false }) desk!: Desk;

  /** Rejection returned by the engine, cleared as soon as the ticket is edited. */
  @state() private rejection: string | null = null;
  @state() private snackbarMessage = "";

  @query("igc-snackbar") private snackbar?: IgcSnackbarComponent;
  @queryAll("igc-input[data-field]") private numberFields!: NodeListOf<IgcInputComponent>;

  private readonly form = new TicketForm();
  private snackbarTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * What the two button groups are handed as their selection. The groups keep
   * their own selection and tab stop in step, so the ticket sets it through them
   * rather than on their buttons, and a new array is made only when it changes.
   */
  private readonly sideItemsFor = memoize((side: OrderSide): string[] => [side]);
  private readonly quickSizeItemsFor = memoize((label: string | undefined): string[] => (label === undefined ? [] : [label]));

  /** What the ticket last re-seeded and switched for, so each happens once per change. */
  private seededSymbol: string | undefined;
  private switchedType: OrderType | undefined;
  private announcedValue: TicketForm["value"] | undefined;

  constructor() {
    super();
    new StoreController(this)
      .watch(() => this.desk.market, "tick")
      .watch(() => this.desk.trading, "book", "orders", "account", "marks")
      .watch(() => this.desk.workspace, "selection");
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.snackbarTimer);
  }

  // Derived state

  private get symbol(): string {
    return this.desk.workspace.selectedSymbol;
  }

  private get side(): OrderSide {
    return this.desk.workspace.ticketSide;
  }

  /** A snapshot of the quote: the feed writes prices in place. */
  private get quote(): StockItem | undefined {
    return this.desk.market.snapshotOf(this.symbol);
  }

  private get heldQuantity(): number {
    const symbol = this.symbol;
    return this.desk.trading.positions.find((position) => position.symbol === symbol)?.quantity ?? 0;
  }

  private get orderType(): OrderType {
    return this.form.value.type ?? "Limit";
  }

  private get needsLimitPrice(): boolean {
    return LIMIT_TYPES.includes(this.orderType);
  }

  private get needsStopPrice(): boolean {
    return STOP_TYPES.includes(this.orderType);
  }

  private get isTrailing(): boolean {
    return this.orderType === "Trailing Stop";
  }

  /** The price this order would work against right now. */
  private referencePrice(quote: StockItem | undefined): number | null {
    if (!quote) {
      return null;
    }

    const limit = this.form.value.limitPrice;
    if (this.needsLimitPrice && limit) {
      return limit;
    }

    return this.side === "BUY" ? quote.ask : quote.bid;
  }

  private estimate(reference: number | null): { notional: number; commission: number; total: number } {
    const quantity = this.form.value.quantity ?? 0;
    const notional = round2(quantity * (reference ?? 0));
    const commission = quantity > 0 ? commissionFor(quantity) : 0;
    return { notional, commission, total: round2(notional + commission) };
  }

  /** Largest size the account can support for the current side. */
  private maxQuantity(reference: number | null): number {
    if (this.side === "SELL") {
      return this.heldQuantity;
    }

    // Commission is priced in, so "Max" is always a size the engine accepts.
    return reference && reference > 0 ? Math.floor(this.desk.trading.buyingPower / (reference + COMMISSION_PER_SHARE)) : 0;
  }

  /**
   * The quick sizes, in the order the button group renders them. `Max` carries
   * a live size, and it is last so that the fixed sizes keep their positions.
   */
  private quickSizes(max: number): QuickSize[] {
    return [
      ...QUICK_QUANTITIES.map((quantity) => ({ label: `${quantity}`, quantity, disabled: false })),
      {
        label: "Max",
        quantity: max,
        disabled: max < 1,
        // The only one whose size is not on its face, so it is the only one
        // that needs saying.
        hint: `Maximum size for this side: ${max}`,
      },
    ];
  }

  /**
   * Which quick size the field currently holds, or -1 for none of them: a size
   * typed by hand belongs to none of these. First match wins, so `Max` landing
   * on a fixed size exactly settles on the fixed one.
   */
  private selectedQuickSize(sizes: readonly QuickSize[]): number {
    const quantity = this.form.value.quantity ?? 0;
    return sizes.findIndex((size) => !size.disabled && size.quantity === quantity);
  }

  // Reactions

  protected willUpdate(): void {
    // Following the selected symbol means re-seeding the price fields; a limit
    // left over from the previous instrument would be nonsense. The seed is not
    // an edit, so it does not announce itself.
    const symbol = this.symbol;
    if (symbol !== this.seededSymbol) {
      this.seededSymbol = symbol;
      const quote = this.desk.market.quoteOf(symbol);
      if (quote) {
        this.form.patchSilently({ limitPrice: quote.lastPrice, stopPrice: null });
        this.writeField("limitPrice");
        this.writeField("stopPrice");
        this.rejection = null;
      }
    }

    // Price fields only validate while the chosen order type uses them.
    const type = this.orderType;
    if (type !== this.switchedType) {
      this.switchedType = type;
      this.form.setEnabled("limitPrice", LIMIT_TYPES.includes(type));
      this.form.setEnabled("stopPrice", STOP_TYPES.includes(type));
    }

    // Any edit clears a rejection.
    if (this.form.value !== this.announcedValue) {
      this.announcedValue = this.form.value;
      this.rejection = null;
    }
  }

  protected updated(): void {
    // A price field that has just appeared shows the current value.
    for (const input of this.numberFields) {
      const field = input.dataset.field as TicketField;
      if (input.dataset.written !== "true") {
        input.dataset.written = "true";
        this.writeField(field);
      }
    }
  }

  /** Shows a field's current value; edits never write back into the field being typed in. */
  private writeField(field: TicketField): void {
    const input = this.renderRoot.querySelector<IgcInputComponent>(`igc-input[data-field="${field}"]`);
    if (input) {
      const value = this.form.rawValue()[field];
      input.value = value === null ? "" : String(value);
    }
  }

  // Interaction

  private onNumberInput(field: "quantity" | "limitPrice" | "stopPrice", event: CustomEvent<string>): void {
    this.form.set(field, parseNumber(event.detail));
    this.requestUpdate();
  }

  private onTypeChange(event: CustomEvent<{ value: string }>): void {
    this.form.set("type", event.detail.value as OrderType);
    this.requestUpdate();
  }

  private onTimeInForceChange(event: CustomEvent<{ value: string }>): void {
    this.form.set("timeInForce", event.detail.value as TimeInForce);
    this.requestUpdate();
  }

  private onSideSelected(event: CustomEvent<string | undefined>): void {
    const option = SIDE_OPTIONS.find((entry) => entry.value === event.detail);
    if (option) {
      this.desk.workspace.setTicketSide(option.value);
    }
  }

  private onQuickSizeSelected(sizes: readonly QuickSize[], event: CustomEvent<string | undefined>): void {
    const size = sizes.find((entry) => entry.label === event.detail);
    if (size && !size.disabled) {
      this.setQuantity(size.quantity);
    }
  }

  private setQuantity(quantity: number): void {
    this.form.set("quantity", quantity);
    this.writeField("quantity");
    this.requestUpdate();
  }

  /** Clicking the bid or ask pulls that price into the limit field. */
  private usePrice(value: number | undefined): void {
    if (value === undefined || !this.needsLimitPrice) {
      return;
    }

    this.form.set("limitPrice", value);
    this.writeField("limitPrice");
    this.requestUpdate();
  }

  private canSubmit(quote: StockItem | undefined): boolean {
    return this.form.status === "VALID" && quote !== undefined;
  }

  private submit(event?: Event): void {
    event?.preventDefault();
    if (!this.canSubmit(this.quote)) {
      return;
    }

    const value = this.form.rawValue();
    const result = this.desk.trading.submitOrder({
      symbol: this.symbol,
      side: this.side,
      quantity: value.quantity ?? 0,
      type: value.type,
      limitPrice: this.needsLimitPrice ? value.limitPrice : null,
      stopPrice: this.needsStopPrice ? value.stopPrice : null,
      timeInForce: value.timeInForce,
    });

    if (!result.accepted) {
      this.rejection = result.reason;
      return;
    }

    const { order } = result;
    const outcome = order.status === "Filled" ? `filled at ${order.fillPrice?.toFixed(2)}` : `working (${order.timeInForce})`;
    void this.announce(`${order.id} \u00b7 ${order.side} ${order.quantity} ${order.symbol} \u2014 ${outcome}`);
  }

  /** Shows a confirmation; a new one replaces the text and restarts the clock. */
  private async announce(message: string): Promise<void> {
    this.snackbarMessage = message;
    await this.updateComplete;
    clearTimeout(this.snackbarTimer);
    void this.snackbar?.show();
    this.snackbarTimer = setTimeout(() => void this.snackbar?.hide(), SNACKBAR_TIME);
  }

  // Rendering

  protected render(): TemplateResult {
    const quote = this.quote;
    const held = this.heldQuantity;
    const side = this.side;
    const reference = this.referencePrice(quote);
    const estimate = this.estimate(reference);
    const sizes = this.quickSizes(this.maxQuantity(reference));
    const selectedSize = this.selectedQuickSize(sizes);
    const needsLimit = this.needsLimitPrice;

    return html`
      <div class="ticket">
        <header class="ticket-header">
          <div class="ticket-id">
            <span class="ticket-symbol">${this.symbol}</span>
            <span class="ticket-name">${quote?.name}</span>
          </div>
          ${held > 0 ? html`<div class="held-badge" aria-label="${held} shares currently held">${held} held</div>` : nothing}
        </header>

        <div class="ladder" role="group" aria-label="Market prices">
          <button type="button" class="ladder-cell bid" ?disabled=${!needsLimit} @click=${() => this.usePrice(quote?.bid)}>
            <span class="ladder-label">Bid</span>
            <span class="ladder-value mono">${price(quote?.bid)}</span>
          </button>
          <div class="ladder-cell last">
            <span class="ladder-label">Last</span>
            <span class="ladder-value mono ${quote ? (quote.positive ? "pos" : "neg") : ""}">${price(quote?.lastPrice)}</span>
          </div>
          <button type="button" class="ladder-cell ask" ?disabled=${!needsLimit} @click=${() => this.usePrice(quote?.ask)}>
            <span class="ladder-label">Ask</span>
            <span class="ladder-value mono">${price(quote?.ask)}</span>
          </button>
        </div>

        <!-- A single-choice group, not two toggles: the ticket always has a side. -->
        <igc-button-group
          class="bs-toggle"
          selection="single-required"
          aria-label="Order side"
          .selectedItems=${this.sideItemsFor(side)}
          @igcSelect=${this.onSideSelected}
        >
          ${SIDE_OPTIONS.map(
            (option) => html`
              <igc-toggle-button class="bs-btn ${option.value === "BUY" ? "bs-buy" : "bs-sell"}" value=${option.value}
                >${option.label}</igc-toggle-button
              >
            `,
          )}
        </igc-button-group>

        <!-- The number fields carry their own label: a label outside the
             element cannot name the input inside it. The selects are named by
             their placeholders and keep the section labels beside them.
             The ticket validates the order itself and the engine names whatever
             it refuses, so the browser's own constraint checks stay out of the
             way: a fractional size has to reach the engine to be rejected. -->
        <form class="ticket-form" novalidate @submit=${this.submit}>
          <div class="inline-row">
            <div class="form-row">
              <!-- No step: a number field steps by one share anyway, and a step
                   would make the field flag a fractional size itself. The ticket
                   checks only that there is a size of at least one, and the
                   engine is what refuses a fraction, with a reason. -->
              <igc-input
                class="form-field"
                data-field="quantity"
                label="Quantity"
                type="number"
                min="1"
                required
                @igcInput=${(event: CustomEvent<string>) => this.onNumberInput("quantity", event)}
              ></igc-input>
            </div>

            <div class="form-row">
              <span class="field-label" id="ticket-type-label">Order type</span>
              <igc-select
                class="form-field"
                placeholder="Select type"
                aria-labelledby="ticket-type-label"
                .value=${this.form.rawValue().type}
                @igcChange=${this.onTypeChange}
              >
                ${ORDER_TYPES.map((type) => html`<igc-select-item value=${type}>${type}</igc-select-item>`)}
              </igc-select>
            </div>
          </div>

          <!-- Sizes are one choice, not five actions: the field holds one
               quantity, so the group shows which size that is. A hand-typed size
               belongs to none of these and leaves every button unlit. -->
          <igc-button-group
            class="quick-qty"
            selection="single"
            aria-label="Quick quantities"
            .selectedItems=${this.quickSizeItemsFor(sizes[selectedSize]?.label)}
            @igcSelect=${(event: CustomEvent<string | undefined>) => this.onQuickSizeSelected(sizes, event)}
          >
            ${sizes.map(
              (size) => html`
                <igc-toggle-button
                  class="qty-chip ${size.label === "Max" ? "qty-max" : ""}"
                  value=${size.label}
                  ?disabled=${size.disabled}
                  title=${size.hint ?? nothing}
                  ><span>${size.label}</span></igc-toggle-button
                >
              `,
            )}
          </igc-button-group>

          <div class="inline-row">
            ${needsLimit
              ? html`
                  <div class="form-row">
                    <igc-input
                      class="form-field"
                      data-field="limitPrice"
                      label="Limit price"
                      type="number"
                      step="0.01"
                      min="0.01"
                      @igcInput=${(event: CustomEvent<string>) => this.onNumberInput("limitPrice", event)}
                    >
                      <span slot="prefix">$</span>
                    </igc-input>
                  </div>
                `
              : nothing}
            ${this.needsStopPrice
              ? html`
                  <div class="form-row">
                    <igc-input
                      class="form-field"
                      data-field="stopPrice"
                      label=${this.isTrailing ? "Trail amount" : "Stop price"}
                      type="number"
                      step="0.01"
                      min="0.01"
                      @igcInput=${(event: CustomEvent<string>) => this.onNumberInput("stopPrice", event)}
                    >
                      <span slot="prefix">$</span>
                    </igc-input>
                  </div>
                `
              : nothing}

            <div class="form-row tif-row">
              <span class="field-label" id="ticket-tif-label">Time in force</span>
              <igc-select
                class="form-field"
                placeholder="TIF"
                aria-labelledby="ticket-tif-label"
                .value=${this.form.rawValue().timeInForce}
                @igcChange=${this.onTimeInForceChange}
              >
                ${TIME_IN_FORCE.map((tif) => html`<igc-select-item value=${tif}>${tif}</igc-select-item>`)}
              </igc-select>
            </div>
          </div>

          <dl class="estimate">
            <div class="estimate-row">
              <dt>Notional</dt>
              <dd class="mono">${money(estimate.notional)}</dd>
            </div>
            <div class="estimate-row">
              <dt>Commission</dt>
              <dd class="mono">${money(estimate.commission)}</dd>
            </div>
            <div class="estimate-row total">
              <dt>Est. total</dt>
              <dd class="mono">${money(estimate.total)}</dd>
            </div>
            <div class="estimate-row muted">
              <dt>Buying power</dt>
              <dd class="mono">${money(this.desk.trading.buyingPower)}</dd>
            </div>
          </dl>

          ${this.rejection
            ? html`
                <p class="ticket-error" role="alert">
                  <igc-icon name="error_outline" collection=${ICONS} aria-hidden="true"></igc-icon>
                  ${this.rejection}
                </p>
              `
            : nothing}

          <igc-button
            type="submit"
            variant="contained"
            class="place-btn ${side === "BUY" ? "buy-action" : "sell-action"}"
            ?disabled=${!this.canSubmit(quote)}
            >${side === "BUY" ? "Buy" : "Sell"} ${this.symbol}</igc-button
          >
        </form>

        <igc-snackbar keep-open>${this.snackbarMessage}</igc-snackbar>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "grid-fintech-dock-manager-order-ticket": OrderTicketPane;
  }
}
