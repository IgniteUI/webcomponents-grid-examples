import type { ReactiveController, ReactiveControllerHost } from "lit";
import { TREND_POINTS, type FinanceRow, type PriceTrendPoint } from "./finance-data.js";

/** Direction of a row's most recent re-pricing, or `null` while it is idle. */
export type TickDirection = "up" | "down" | null;

/** A holding that the simulator re-prices in place. */
export interface LivePortfolioRow extends FinanceRow {
  direction: TickDirection;
}

/** Milliseconds between re-pricing passes. */
const TICK_MS = 1200;

/** Share of the portfolio that re-prices on any given tick. */
const TICK_COVERAGE = 0.35;

/** Largest single-tick move, as a percentage of the last price. */
const VOLATILITY = 0.45;

/** How hard a price is pulled back toward its previous close each tick. */
const MEAN_REVERSION = 0.04;

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * The portfolio's simulated market feed.
 *
 * ## Why the rows are mutable
 *
 * Replacing the grid's `data` array on every tick would make it rebuild its row cache and
 * re-measure the virtualised viewport once a second, and the scrollbar visibly flickers as it
 * does. So {@link rows} is a **stable array of mutable holdings**: fields are written in place
 * and `onTick` is called, and the host answers with the grid's `markForCheck()`.
 *
 * `priceTrend` is the exception. It is handed to `igc-sparkline` as a data source, and the chart
 * only redraws when the reference changes, so each re-priced row gets a freshly built series
 * rather than a mutated one.
 *
 * The feed starts when the host connects and stops when it disconnects. A host that was paused
 * stays paused when it is moved or returns to the page.
 */
export class LivePortfolio implements ReactiveController {
  /**
   * The holdings. The array and its objects are reused for the whole session: never reassign
   * either, write fields and let `onTick` tell the host.
   */
  readonly rows: LivePortfolioRow[];

  /**
   * Each row's reference price: the close the day's change is measured against. Derived once
   * from the seed so `changePct` keeps its opening value, and fixed thereafter so the figure
   * cannot drift away from what it means.
   */
  private readonly previousClose: ReadonlyMap<string, number>;

  private timer: ReturnType<typeof setInterval> | undefined;
  private live = false;

  /** Whether the feed runs when the host connects: always at first, then as it was when the host left. */
  private resumeOnConnect = true;

  constructor(
    private readonly host: ReactiveControllerHost,
    seed: readonly FinanceRow[],
    private readonly onTick: () => void
  ) {
    this.rows = seed.map((row) => ({ ...row, priceTrend: [...row.priceTrend], direction: null }));
    this.previousClose = new Map(this.rows.map((row) => [row.ticker, row.lastPrice / (1 + row.changePct / 100)]));
    host.addController(this);
  }

  /** Whether the feed is running. */
  get isLive(): boolean {
    return this.live;
  }

  hostConnected(): void {
    if (this.resumeOnConnect) {
      this.start();
    }
  }

  hostDisconnected(): void {
    this.resumeOnConnect = this.live;
    this.stop();
  }

  start(): void {
    if (this.timer !== undefined) {
      return;
    }

    this.timer = setInterval(() => this.repriceBatch(), TICK_MS);
    this.setLive(true);
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    this.setLive(false);
  }

  toggle(): void {
    if (this.live) {
      this.stop();
    } else {
      this.start();
    }
  }

  private setLive(live: boolean): void {
    if (this.live !== live) {
      this.live = live;
      this.host.requestUpdate();
    }
  }

  /**
   * Re-prices a random slice of the portfolio.
   *
   * Rows left out of the batch have their flash cleared, so a highlight lasts exactly as long as
   * the tick that caused it.
   */
  private repriceBatch(): void {
    const batchSize = Math.max(1, Math.round(this.rows.length * TICK_COVERAGE));
    const moved = new Set<number>();

    while (moved.size < batchSize) {
      moved.add(Math.floor(Math.random() * this.rows.length));
    }

    this.rows.forEach((row, index) => {
      if (moved.has(index)) {
        this.reprice(row);
      } else {
        row.direction = null;
      }
    });

    this.onTick();
  }

  /** Marks one holding to a new market price and recomputes everything off it. */
  private reprice(row: LivePortfolioRow): void {
    const reference = this.previousClose.get(row.ticker) ?? row.lastPrice;

    // A random walk with a light pull back toward the reference price, so a long session wanders
    // without ever running away from its opening change.
    const drift = (Math.random() - 0.5) * 2 * VOLATILITY;
    const pull = ((reference - row.lastPrice) / row.lastPrice) * 100 * MEAN_REVERSION;
    const nextPrice = round2(Math.max(0.01, row.lastPrice * (1 + (drift + pull) / 100)));

    if (nextPrice === row.lastPrice) {
      row.direction = null;
      return;
    }

    row.direction = nextPrice > row.lastPrice ? "up" : "down";
    row.lastPrice = nextPrice;

    // The same identities the seed data satisfies, so a live row stays arithmetically consistent
    // with the ones that have not moved yet.
    row.changePct = round2((nextPrice / reference - 1) * 100);
    row.marketValue = round2(nextPrice * row.position);

    const costBasis = row.averageCost * row.position;
    row.netProfit = round2((nextPrice - row.averageCost) * row.position);
    row.netProfitPct = costBasis === 0 ? 0 : round2((row.netProfit / costBasis) * 100);

    row.priceTrend = appendTrendPoint(row.priceTrend, row.changePct);
  }
}

/**
 * The trend series, advanced by one point.
 *
 * A new array rather than a push/shift pair: `igc-sparkline` redraws off a changed `dataSource`
 * reference, not off the contents of the one it holds.
 */
function appendTrendPoint(series: readonly PriceTrendPoint[], value: number): PriceTrendPoint[] {
  const next = [...series, { value }];
  return next.length > TREND_POINTS ? next.slice(next.length - TREND_POINTS) : next;
}
