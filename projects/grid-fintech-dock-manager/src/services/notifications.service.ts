import { NEWS_WIRE_POOL, SEED_NEWS } from "../data/market-seed.js";
import type { DeskNotification, MarketIndex, NewsArticle, NotificationTone, StockItem } from "../models/stock.model.js";
import { formatSignedPct } from "../util/finance.js";
import { Store, afterTask } from "../util/store.js";
import type { MarketDataService } from "./market-data.service.js";

/** `notifications` and `news` when either list changes; `clock` when relative times move on. */
export type NotificationsTopic = "notifications" | "news" | "clock";

/** Intraday move that raises an "unusual move" alert, in percent. */
const UNUSUAL_MOVE_PCT = 2.5;
/** VIX level above which the desk gets a risk warning. */
const VIX_RISK_LEVEL = 20;
/** Minimum gap between two alerts about the same subject. */
const ALERT_COOLDOWN_MS = 45_000;
const NEWS_INTERVAL_MS = 18_000;
const CLOCK_INTERVAL_MS = 15_000;
const MAX_NOTIFICATIONS = 40;
const MAX_NEWS = 40;

/**
 * The desk's alert and news feed. Fills are pushed in by the trading engine;
 * price alerts are derived here by watching the market feed.
 */
export class NotificationsService extends Store<NotificationsTopic> {
  private readonly market: MarketDataService;

  private _notifications: DeskNotification[] = [];
  private _news: NewsArticle[] = seedNews();
  private _now = Date.now();

  private readonly lastAlertAt = new Map<string, number>();
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private sequence = 0;
  private newsCursor = 0;

  constructor(market: MarketDataService) {
    super();
    this.market = market;

    // Every price tick is scanned once, after the writes of the task that
    // produced it have landed; the opening tape is scanned straight away.
    const scan = afterTask(() => this.scanForAlerts(this.market.stocks, this.market.indices));
    market.subscribe("tick", scan);
    scan();
  }

  /** Newest first. */
  get notifications(): readonly DeskNotification[] {
    return this._notifications;
  }

  /** Newest first. */
  get news(): readonly NewsArticle[] {
    return this._news;
  }

  get unreadCount(): number {
    return this._notifications.filter((item) => !item.read).length;
  }

  /** Coarse clock driving relative timestamps: `since(item.at, now)`. */
  get now(): number {
    return this._now;
  }

  start(): void {
    if (this.timers.length > 0) {
      return;
    }

    this.timers.push(
      setInterval(() => this.publishWireItem(), NEWS_INTERVAL_MS),
      setInterval(() => this.setNow(Date.now()), CLOCK_INTERVAL_MS),
    );
  }

  stop(): void {
    this.timers.splice(0).forEach(clearInterval);
  }

  push(notification: Omit<DeskNotification, "id" | "at" | "read">): void {
    const entry: DeskNotification = {
      ...notification,
      id: `n${++this.sequence}`,
      at: new Date(),
      read: false,
    };

    this._notifications = [entry, ...this._notifications].slice(0, MAX_NOTIFICATIONS);
    this.emit("notifications");
    this.setNow(Date.now());
  }

  markAllRead(): void {
    if (this._notifications.some((item) => !item.read)) {
      this._notifications = this._notifications.map((item) => (item.read ? item : { ...item, read: true }));
      this.emit("notifications");
    }
  }

  /** Drops every alert and puts the wire back to the seeded stories. */
  reset(): void {
    this._notifications = [];
    this._news = seedNews();
    // Cooldowns are per-session state too, or the first post-reset alert for a
    // subject the desk had already warned about would be swallowed.
    this.lastAlertAt.clear();
    this.sequence = 0;
    this.newsCursor = 0;
    this.emit("notifications", "news");
    this.setNow(Date.now());
  }

  clear(): void {
    this._notifications = [];
    this.emit("notifications");
  }

  /** News for one instrument plus the untagged macro wire. */
  newsFor(symbol: string): NewsArticle[] {
    return this._news.filter((article) => article.symbol === null || article.symbol === symbol);
  }

  // Derived alerts

  private scanForAlerts(quotes: readonly StockItem[], indices: readonly MarketIndex[]): void {
    for (const quote of quotes) {
      if (Math.abs(quote.changePct) < UNUSUAL_MOVE_PCT) {
        continue;
      }

      const gaining = quote.changePct > 0;
      this.pushThrottled(`move:${quote.symbol}`, {
        title: `${quote.symbol} unusual move`,
        detail: `Trading ${formatSignedPct(quote.changePct)} against yesterday's close`,
        icon: gaining ? "trending_up" : "trending_down",
        tone: gaining ? "success" : "error",
      });
    }

    const vix = indices.find((index) => index.name === "VIX");
    if (vix && vix.value >= VIX_RISK_LEVEL) {
      this.pushThrottled("risk:vix", {
        title: "Volatility warning",
        detail: `VIX at ${vix.value.toFixed(2)} \u2014 review position sizing`,
        icon: "warning",
        tone: "warn",
      });
    }
  }

  private pushThrottled(key: string, notification: { title: string; detail: string; icon: string; tone: NotificationTone }): void {
    const now = Date.now();
    if (now - (this.lastAlertAt.get(key) ?? 0) < ALERT_COOLDOWN_MS) {
      return;
    }

    this.lastAlertAt.set(key, now);
    this.push(notification);
  }

  private publishWireItem(): void {
    const [headline, source, symbol] = NEWS_WIRE_POOL[this.newsCursor % NEWS_WIRE_POOL.length];
    this.newsCursor++;

    const article: NewsArticle = {
      id: `w${this.newsCursor}`,
      headline,
      source,
      symbol,
      at: new Date(),
    };

    this._news = [article, ...this._news].slice(0, MAX_NEWS);
    this.emit("news");
    this.setNow(Date.now());
  }

  private setNow(now: number): void {
    if (this._now !== now) {
      this._now = now;
      this.emit("clock");
    }
  }
}

function seedNews(): NewsArticle[] {
  const now = Date.now();
  return SEED_NEWS.map(([headline, source, symbol, minutesAgo], index) => ({
    id: `s${index}`,
    headline,
    source,
    symbol,
    at: new Date(now - minutesAgo * 60_000),
  }));
}
