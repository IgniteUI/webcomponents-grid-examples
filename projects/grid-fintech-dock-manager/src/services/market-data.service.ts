import { HubConnectionBuilder, HubConnectionState, LogLevel, type HubConnection } from "@microsoft/signalr";
import { SEED_INDICES, SEED_STOCKS } from "../data/market-seed.js";
import type { MarketIndex, StockItem } from "../models/stock.model.js";
import { formatClock, percentChange, round2 } from "../util/finance.js";
import { Store } from "../util/store.js";

/**
 * `live`: the Infragistics stream hub is connected and driving the clock.
 * `simulated`: the hub is unreachable, so the local simulator drives ticks.
 */
export type FeedStatus = "connecting" | "live" | "simulated" | "paused";

/** `tick` after every re-pricing pass; `status` when the state or the speed changes. */
export type MarketTopic = "tick" | "status";

const HUB_URL = "https://www.infragistics.com/angular-apis/webapi/streamHub";
const DEFAULT_FREQUENCY = 1000;

/** Feed speeds offered in the command bar, in milliseconds per tick. */
export const FEED_SPEEDS: readonly { label: string; value: number }[] = [
  { label: "0.5\u00d7", value: 2000 },
  { label: "1\u00d7", value: DEFAULT_FREQUENCY },
  { label: "2\u00d7", value: 500 },
  { label: "5\u00d7", value: 200 },
];

/** Percentage move applied to a stock on a single tick, at most. */
const STOCK_VOLATILITY = 0.4;
const INDEX_VOLATILITY = 0.06;
/** Share of the universe that re-prices on any given tick. */
const TICK_COVERAGE = 0.35;
const SPREAD_BPS = 2;

/** Opening quote per symbol, used to put the tape back after a reset. */
const SEED_QUOTES: ReadonlyMap<string, StockItem> = new Map(SEED_STOCKS.map((stock) => [stock.symbol, stock]));

/**
 * The market feed: one source of truth for prices.
 *
 * ## Why the quote objects are mutable
 *
 * Replacing the quote array on every tick is wrong for a grid. A new `data`
 * array makes `igc-grid` rebuild its row cache and re-measure the virtualised
 * viewport once a second, and the scrollbar visibly flickers as it does. So the
 * universe is a **stable array of mutable quotes**: prices are written in place
 * and {@link tick} is bumped, and each live grid responds by calling
 * `markForCheck()` (see `util/live-grid.ts`).
 *
 * Consumers outside a grid read the quote they care about when `tick` fires,
 * through {@link snapshotOf}.
 */
export class MarketDataService extends Store<MarketTopic> {
  /**
   * The tradable universe. The array and its objects are reused for the whole
   * session: never reassign either; write fields and bump {@link tick}.
   */
  readonly stocks: readonly StockItem[] = SEED_STOCKS.map((stock) => ({ ...stock }));

  /** Symbol to quote. Built once; the universe is fixed. */
  readonly quotes: ReadonlyMap<string, StockItem> = new Map(this.stocks.map((stock) => [stock.symbol, stock]));

  private _tick = 0;
  private _indices: MarketIndex[] = SEED_INDICES.map((index) => ({ ...index }));
  private _status: FeedStatus = "connecting";
  private _frequency = DEFAULT_FREQUENCY;

  private connection: HubConnection | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  /** Incremented after every re-pricing pass. This, not the array, is what dependants watch. */
  get tick(): number {
    return this._tick;
  }

  /** Indices feed the command bar, not a grid, so each pass replaces them. */
  get indices(): readonly MarketIndex[] {
    return this._indices;
  }

  get status(): FeedStatus {
    return this._status;
  }

  get frequency(): number {
    return this._frequency;
  }

  get isPaused(): boolean {
    return this._status === "paused";
  }

  /** The live quote object. Read it, never keep it as a rendered value. */
  quoteOf(symbol: string): StockItem | undefined {
    return this.quotes.get(symbol);
  }

  /** A detached copy of a quote, for a pane that renders it outside a grid. */
  snapshotOf(symbol: string): StockItem | undefined {
    const quote = this.quotes.get(symbol);
    return quote ? { ...quote } : undefined;
  }

  /** Opens the hub connection (best effort) and starts the tick loop. */
  start(): void {
    if (this.timer !== undefined) {
      return;
    }

    this.connect();
    this.restartTimer();
  }

  stop(): void {
    this.clearTimer();
    this.connection?.stop().catch(() => undefined);
    this.connection = undefined;
  }

  /** Freezes the tape without dropping the connection. */
  pause(): void {
    this.clearTimer();
    this.setStatus("paused");
  }

  resume(): void {
    this.setStatus(this.connection?.state === HubConnectionState.Connected ? "live" : "simulated");
    this.restartTimer();
  }

  togglePlayback(): void {
    if (this.isPaused) {
      this.resume();
    } else {
      this.pause();
    }
  }

  /**
   * Puts the tape back to its opening state: seed prices, seed indices, default
   * speed, running.
   *
   * Quotes are rewritten **in place**. The stable-array contract the grids rely
   * on (see the class comment) holds through a reset too: replacing the array
   * here would make every live grid re-measure.
   */
  reset(): void {
    for (const stock of this.stocks) {
      const seed = SEED_QUOTES.get(stock.symbol);
      if (seed) {
        Object.assign(stock, seed);
      }
    }

    this._indices = SEED_INDICES.map((index) => ({ ...index }));
    this._frequency = DEFAULT_FREQUENCY;
    this._tick++;
    this.emit("tick", "status");

    // A paused tape is not the opening state, so a reset always leaves it running.
    if (this.isPaused) {
      this.resume();
    } else {
      this.restartTimer();
    }
  }

  setFrequency(milliseconds: number): void {
    this._frequency = milliseconds;
    this.emit("status");
    if (!this.isPaused) {
      this.restartTimer();
    }
  }

  // Connection

  private connect(): void {
    const connection = new HubConnectionBuilder().configureLogging(LogLevel.Warning).withUrl(HUB_URL).build();
    this.connection = connection;

    connection.onclose(() => this.setStatus("simulated"));

    // A refused connection is not an error here: the simulator takes over.
    connection
      .start()
      .then(() => {
        this.setStatus("live");
        // Keeps the hub alive; its payload shape differs from this sample's
        // instruments, so the local simulator remains the price source.
        return this.connection?.invoke("updateparameters", this._frequency, 20, true, false);
      })
      .catch(() => this.setStatus("simulated"));
  }

  private setStatus(status: FeedStatus): void {
    if (this._status !== status) {
      this._status = status;
      this.emit("status");
    }
  }

  private restartTimer(): void {
    this.clearTimer();
    this.timer = setInterval(() => this.advance(), this._frequency);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  // Simulation

  /**
   * Advances the tape one step: re-prices part of the universe in place and
   * bumps {@link tick}. The interval drives this; checks call it directly.
   */
  advance(): void {
    const marketTime = formatClock(new Date());

    for (const stock of this.stocks) {
      if (Math.random() < TICK_COVERAGE) {
        repriceStock(stock, marketTime);
      }
    }

    this._indices = this._indices.map(repriceIndex);
    this._tick++;
    this.emit("tick");
  }
}

/** Writes a new price onto the quote in place. */
function repriceStock(stock: StockItem, marketTime: string): void {
  const lastPrice = drift(stock.lastPrice, STOCK_VOLATILITY);
  const spread = Math.max(0.01, round2((lastPrice * SPREAD_BPS) / 10_000));
  const changePct = round2(percentChange(lastPrice, stock.previousClose));

  stock.lastPrice = lastPrice;
  stock.bid = round2(lastPrice - spread);
  stock.ask = round2(lastPrice + spread);
  stock.change = round2(lastPrice - stock.previousClose);
  stock.changePct = changePct;
  stock.positive = changePct >= 0;
  stock.dayHigh = Math.max(stock.dayHigh, lastPrice);
  stock.dayLow = Math.min(stock.dayLow, lastPrice);
  stock.volume += Math.round(stock.avgVol3M / 5_000);
  stock.marketTime = marketTime;
}

function repriceIndex(index: MarketIndex): MarketIndex {
  const value = drift(index.value, INDEX_VOLATILITY);
  const changePct = round2(percentChange(value, index.previousClose));

  return { ...index, value, changePct, positive: changePct >= 0 };
}

/** Random walk: a symmetric move of up to `volatility` percent. */
function drift(price: number, volatility: number): number {
  const changePct = (Math.random() * 2 - 1) * volatility;
  return round2(price * (1 + changePct / 100));
}
