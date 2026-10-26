import { OPENING_CASH, OPENING_LOTS } from "../data/market-seed.js";
import type { AccountSummary, Order, OrderDraft, Position, PositionLot, StockItem } from "../models/stock.model.js";
import { formatMoney, percentChange, round2 } from "../util/finance.js";
import { Store, afterTask, memoize } from "../util/store.js";
import type { MarketDataService } from "./market-data.service.js";
import type { NotificationsService } from "./notifications.service.js";

/**
 * `orders` when the blotter changes, `book` when the lots change (and with them
 * the positions array), `account` when cash or realised P&L move, and `marks`
 * after every mark-to-market pass.
 */
export type TradingTopic = "orders" | "book" | "account" | "marks";

/** Outcome of a ticket submission. `reason` is set only when rejected. */
export interface OrderResult {
  accepted: boolean;
  reason: string | null;
  order: Order;
}

export const COMMISSION_PER_SHARE = 0.005;
const MIN_COMMISSION = 1;
/** Reg-T style margin: cash buys twice its value in stock. */
const MARGIN_MULTIPLIER = 2;

/** Broker commission for a given size. Surfaced so the ticket can preview it. */
export function commissionFor(quantity: number): number {
  return round2(Math.max(MIN_COMMISSION, quantity * COMMISSION_PER_SHARE));
}

/**
 * The trading engine: accepts drafts from the order ticket, keeps working
 * orders alive against the live feed, and books fills into the position lots
 * and cash balance that every P&L figure on the desk derives from.
 */
export class TradingService extends Store<TradingTopic> {
  private readonly market: MarketDataService;
  private readonly notifications: NotificationsService;

  private _lots: PositionLot[] = OPENING_LOTS.map((lot) => ({ ...lot }));
  private _orders: Order[] = [];
  private _cash = OPENING_CASH;
  private _realizedPl = 0;
  private _marks = 0;
  private sequence = 0;

  /**
   * The book marked to the live market, rebuilt only when the lots change: a
   * fill, not a tick. The positions grid keeps the same `data` array between
   * fills and never re-measures; each tick marks these rows in place.
   */
  private readonly positionsOf = memoize((lots: readonly PositionLot[]): Position[] => {
    const rows = lots.map(blankPosition);
    markPositions(rows, this.market.quotes);
    return rows;
  });

  private readonly workingOf = memoize((orders: readonly Order[]): Order[] =>
    orders.filter((order) => order.status === "Working"),
  );

  private readonly accountOf = memoize(
    (_marks: number, positions: readonly Position[], cash: number, realizedPl: number, buyingPower: number): AccountSummary => {
      const marketValue = round2(positions.reduce((total, p) => total + p.marketValue, 0));
      const openPl = round2(positions.reduce((total, p) => total + p.openPl, 0));
      const dayPl = round2(positions.reduce((total, p) => total + p.dayChange, 0) + realizedPl);
      const netLiquidation = round2(cash + marketValue);

      return {
        cash,
        marketValue,
        netLiquidation,
        openPl,
        dayPl,
        realizedPl,
        buyingPower,
        utilisation: netLiquidation === 0 ? 0 : round2((marketValue / netLiquidation) * 100),
      };
    },
  );

  constructor(market: MarketDataService, notifications: NotificationsService) {
    super();
    this.market = market;
    this.notifications = notifications;

    // One pass per price tick: re-mark the book, then re-evaluate working
    // orders. It runs after the task that moved the prices, and once at start.
    const markToMarket = afterTask(() => {
      markPositions(this.positions, this.market.quotes);
      this._marks++;
      this.emit("marks");
      this.matchWorkingOrders(this.market.quotes);
    });
    market.subscribe("tick", markToMarket);
    markToMarket();
  }

  /** Newest first: the blotter renders this directly. */
  get orders(): readonly Order[] {
    return this._orders;
  }

  get cash(): number {
    return this._cash;
  }

  get realizedPl(): number {
    return this._realizedPl;
  }

  /** Incremented after every mark-to-market pass, while {@link positions} keeps its identity. */
  get marks(): number {
    return this._marks;
  }

  get positions(): Position[] {
    return this.positionsOf(this._lots);
  }

  get workingOrders(): readonly Order[] {
    return this.workingOf(this._orders);
  }

  /** Cash committed to unfilled buy orders, held back from buying power. */
  private get reservedCash(): number {
    return round2(
      this.workingOrders
        .filter((order) => order.side === "BUY")
        .reduce((total, order) => total + order.quantity * (order.limitPrice ?? order.stopPrice ?? 0), 0),
    );
  }

  get buyingPower(): number {
    return round2(Math.max(0, this._cash - this.reservedCash) * MARGIN_MULTIPLIER);
  }

  get account(): AccountSummary {
    return this.accountOf(this._marks, this.positions, this._cash, this._realizedPl, this.buyingPower);
  }

  quantityHeld(symbol: string): number {
    return this._lots.find((lot) => lot.symbol === symbol)?.quantity ?? 0;
  }

  submitOrder(draft: OrderDraft): OrderResult {
    const quote = this.market.quoteOf(draft.symbol);
    const rejection = this.validate(draft, quote);
    const order: Order = {
      ...draft,
      id: `ORD-${(++this.sequence).toString().padStart(4, "0")}`,
      status: rejection ? "Rejected" : "Working",
      placedAt: new Date(),
      filledAt: null,
      fillPrice: null,
      note: rejection ?? "",
      peakPrice: draft.type === "Trailing Stop" ? (quote?.lastPrice ?? null) : null,
    };

    this.setOrders([order, ...this._orders]);

    if (rejection) {
      this.notifications.push({
        title: `Order rejected \u2014 ${order.symbol}`,
        detail: rejection,
        icon: "block",
        tone: "error",
      });
      return { accepted: false, reason: rejection, order };
    }

    // Market orders (and any resting order already through its trigger) fill
    // on this pass rather than waiting for the next tick.
    this.matchWorkingOrders(this.market.quotes);
    this.expireImmediateOrder(order.id);

    // Report the settled state so the ticket can say "filled" rather than "working".
    const settled = this._orders.find((entry) => entry.id === order.id) ?? order;
    return { accepted: true, reason: null, order: settled };
  }

  /**
   * Returns the book to its opening state: seeded lots, opening cash, no
   * realised P&L and an empty blotter.
   */
  reset(): void {
    this._lots = OPENING_LOTS.map((lot) => ({ ...lot }));
    this._orders = [];
    this._cash = OPENING_CASH;
    this._realizedPl = 0;
    this.sequence = 0;
    // Positions are rebuilt from the new lots; this is what tells the grids.
    this._marks++;
    this.emit("book", "orders", "account", "marks");
  }

  cancelOrder(id: string): void {
    this.setOrders(
      this._orders.map((order) =>
        order.id === id && order.status === "Working" ? { ...order, status: "Cancelled", note: "Cancelled by user" } : order,
      ),
    );
  }

  cancelAllWorking(): void {
    const count = this.workingOrders.length;
    if (count === 0) {
      return;
    }

    this.setOrders(
      this._orders.map((order) =>
        order.status === "Working" ? { ...order, status: "Cancelled", note: "Cancelled by user" } : order,
      ),
    );

    this.notifications.push({
      title: "Working orders cancelled",
      detail: `${count} order${count === 1 ? "" : "s"} pulled from the market`,
      icon: "cancel",
      tone: "info",
    });
  }

  /** Sells the whole position at market. */
  flatten(symbol: string): OrderResult | null {
    const quantity = this.quantityHeld(symbol);
    if (quantity <= 0) {
      return null;
    }

    return this.submitOrder({
      symbol,
      side: "SELL",
      quantity,
      type: "Market",
      limitPrice: null,
      stopPrice: null,
      timeInForce: "Day",
    });
  }

  // Validation

  private validate(draft: OrderDraft, quote: StockItem | undefined): string | null {
    if (!quote) {
      return `${draft.symbol} is not tradable on this desk`;
    }
    if (!Number.isInteger(draft.quantity) || draft.quantity < 1) {
      return "Quantity must be a whole number of shares";
    }
    if ((draft.type === "Limit" || draft.type === "Stop Limit") && !(draft.limitPrice && draft.limitPrice > 0)) {
      return `${draft.type} orders require a limit price`;
    }
    if (draft.type !== "Market" && draft.type !== "Limit" && !(draft.stopPrice && draft.stopPrice > 0)) {
      return draft.type === "Trailing Stop" ? "Trailing stop orders require a trail amount" : `${draft.type} orders require a stop price`;
    }

    if (draft.side === "BUY") {
      const reference = draft.limitPrice ?? quote.ask;
      const required = round2(draft.quantity * reference + commissionFor(draft.quantity));
      if (required > this.buyingPower) {
        return `Needs ${formatMoney(required)} \u2014 buying power is ${formatMoney(this.buyingPower)}`;
      }
      return null;
    }

    const held = this.quantityHeld(draft.symbol);
    if (draft.quantity > held) {
      return held === 0
        ? `No ${draft.symbol} position to sell \u2014 short selling is disabled`
        : `Only ${held} ${draft.symbol} share${held === 1 ? "" : "s"} held`;
    }

    return null;
  }

  /** IOC and FOK orders do not rest: pull them if the first pass missed. */
  private expireImmediateOrder(id: string): void {
    const order = this._orders.find((entry) => entry.id === id);
    if (!order || order.status !== "Working" || (order.timeInForce !== "IOC" && order.timeInForce !== "FOK")) {
      return;
    }

    this.setOrders(
      this._orders.map((entry) =>
        entry.id === id ? { ...entry, status: "Cancelled", note: `Not filled immediately (${order.timeInForce})` } : entry,
      ),
    );
  }

  // Matching engine

  private matchWorkingOrders(quotes: ReadonlyMap<string, StockItem>): void {
    const orders = this._orders;
    if (!orders.some((order) => order.status === "Working")) {
      return;
    }

    const fills: Order[] = [];
    let changed = false;

    const next = orders.map((order) => {
      if (order.status !== "Working") {
        return order;
      }

      const quote = quotes.get(order.symbol);
      if (!quote) {
        return order;
      }

      // `peakPrice` is internal tracking state, never rendered, so it is
      // written in place: replacing the array on every tick would make the
      // blotter grid re-measure for the whole life of a trailing order.
      trackTrailingExtreme(order, quote);

      const fillPrice = resolveFillPrice(order, quote);
      if (fillPrice === null) {
        return order;
      }

      const filled: Order = {
        ...order,
        status: "Filled",
        filledAt: new Date(),
        fillPrice,
        note: `${order.type} filled at ${formatMoney(fillPrice)}`,
      };
      fills.push(filled);
      changed = true;
      return filled;
    });

    if (!changed) {
      return;
    }

    this.setOrders(next);
    fills.forEach((order) => this.settle(order));
  }

  private settle(order: Order): void {
    const price = order.fillPrice ?? 0;
    const commission = commissionFor(order.quantity);
    const notional = round2(order.quantity * price);

    if (order.side === "BUY") {
      this._cash = round2(this._cash - notional - commission);
      this._lots = addToLot(this._lots, order.symbol, order.quantity, price);
    } else {
      const avgCost = this._lots.find((lot) => lot.symbol === order.symbol)?.avgCost ?? price;
      this._cash = round2(this._cash + notional - commission);
      this._realizedPl = round2(this._realizedPl + (price - avgCost) * order.quantity - commission);
      this._lots = reduceLot(this._lots, order.symbol, order.quantity);
    }
    this.emit("book", "account");

    this.notifications.push({
      title: `${order.side} ${order.quantity} ${order.symbol} filled`,
      detail: `${order.type} at ${formatMoney(price)} \u00b7 commission ${formatMoney(commission)}`,
      icon: "receipt_long",
      tone: "success",
    });
  }

  private setOrders(orders: Order[]): void {
    this._orders = orders;
    this.emit("orders");
  }
}

// Pure engine helpers

/** An unmarked row for a lot; {@link markPositions} fills in the live figures. */
function blankPosition(lot: PositionLot): Position {
  return {
    ...lot,
    name: lot.symbol,
    last: lot.avgCost,
    previousClose: lot.avgCost,
    marketValue: 0,
    dayChange: 0,
    dayChangePct: 0,
    openPl: 0,
    openPlPct: 0,
    weight: 0,
  };
}

/**
 * Marks rows to the live market **in place**. Mutation is deliberate: it is what
 * lets the positions grid hold one `data` array for the whole session.
 */
function markPositions(rows: readonly Position[], quotes: ReadonlyMap<string, StockItem>): void {
  let gross = 0;

  for (const row of rows) {
    const quote = quotes.get(row.symbol);
    const last = quote?.lastPrice ?? row.avgCost;
    const previousClose = quote?.previousClose ?? row.avgCost;

    row.name = quote?.name ?? row.symbol;
    row.last = last;
    row.previousClose = previousClose;
    row.marketValue = round2(last * row.quantity);
    row.dayChange = round2((last - previousClose) * row.quantity);
    row.dayChangePct = round2(percentChange(last, previousClose));
    row.openPl = round2((last - row.avgCost) * row.quantity);
    row.openPlPct = round2(percentChange(last, row.avgCost));

    gross += Math.abs(row.marketValue);
  }

  for (const row of rows) {
    row.weight = gross === 0 ? 0 : round2((Math.abs(row.marketValue) / gross) * 100);
  }
}

function addToLot(lots: readonly PositionLot[], symbol: string, quantity: number, price: number): PositionLot[] {
  const existing = lots.find((lot) => lot.symbol === symbol);
  if (!existing) {
    return [...lots, { symbol, quantity, avgCost: round2(price) }];
  }

  const total = existing.quantity + quantity;
  const avgCost = round2((existing.avgCost * existing.quantity + price * quantity) / total);
  return lots.map((lot) => (lot.symbol === symbol ? { ...lot, quantity: total, avgCost } : lot));
}

function reduceLot(lots: readonly PositionLot[], symbol: string, quantity: number): PositionLot[] {
  return lots
    .map((lot) => (lot.symbol === symbol ? { ...lot, quantity: lot.quantity - quantity } : lot))
    .filter((lot) => lot.quantity > 0);
}

/** Advances the high-water (or low-water) mark a trailing stop is measured from. */
function trackTrailingExtreme(order: Order, quote: StockItem): void {
  if (order.type !== "Trailing Stop") {
    return;
  }

  const current = order.peakPrice ?? quote.lastPrice;
  order.peakPrice = order.side === "SELL" ? Math.max(current, quote.lastPrice) : Math.min(current, quote.lastPrice);
}

/** The price this order would fill at right now, or `null` if it stays working. */
function resolveFillPrice(order: Order, quote: StockItem): number | null {
  const buying = order.side === "BUY";
  const aggressive = buying ? quote.ask : quote.bid;

  switch (order.type) {
    case "Market":
      return aggressive;

    case "Limit":
      return crossesLimit(order.limitPrice, aggressive, buying);

    case "Stop":
      return isTriggered(order.stopPrice, quote.lastPrice, buying) ? aggressive : null;

    case "Stop Limit":
      return isTriggered(order.stopPrice, quote.lastPrice, buying) ? crossesLimit(order.limitPrice, aggressive, buying) : null;

    case "Trailing Stop": {
      if (order.stopPrice === null || order.peakPrice === null) {
        return null;
      }
      const trigger = buying ? order.peakPrice + order.stopPrice : order.peakPrice - order.stopPrice;
      return isTriggered(trigger, quote.lastPrice, buying) ? aggressive : null;
    }
  }
}

function crossesLimit(limit: number | null, aggressive: number, buying: boolean): number | null {
  if (limit === null) {
    return null;
  }

  if (buying) {
    return aggressive <= limit ? Math.min(aggressive, limit) : null;
  }
  return aggressive >= limit ? Math.max(aggressive, limit) : null;
}

/** A stop is hit when the market trades up through it (buy) or down through it (sell). */
function isTriggered(stop: number | null, last: number, buying: boolean): boolean {
  if (stop === null) {
    return false;
  }

  return buying ? last >= stop : last <= stop;
}
