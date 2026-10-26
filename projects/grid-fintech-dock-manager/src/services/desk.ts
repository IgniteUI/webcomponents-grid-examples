import { MarketDataService } from "./market-data.service.js";
import { NotificationsService } from "./notifications.service.js";
import { TradingService } from "./trading.service.js";
import { WorkspaceService } from "./workspace.service.js";

/**
 * The four services one desk runs on, created together and handed to every
 * pane. Panes never talk to each other; they share state through these.
 *
 * The notifications service subscribes to the tape before the trading engine,
 * so on any tick the unusual-move scan runs ahead of the fills it may cause.
 */
export class Desk {
  readonly market = new MarketDataService();
  readonly notifications = new NotificationsService(this.market);
  readonly trading = new TradingService(this.market, this.notifications);
  readonly workspace = new WorkspaceService();

  /** Starts the tape and the news wire. */
  start(): void {
    this.market.start();
    this.notifications.start();
  }

  stop(): void {
    this.market.stop();
    this.notifications.stop();
  }

  /**
   * Puts the whole desk back to how it opened: arrangement, book, tape and
   * alerts, not just the layout.
   *
   * Each service owns its own reset; this only composes them. Order matters:
   * the book is restored before the tape, so the mark-to-market pass that the
   * reset tick triggers runs against the opening positions rather than the
   * ones being replaced.
   */
  reset(width: number, height: number): void {
    this.workspace.reset(width, height);
    this.trading.reset();
    this.market.reset();
    this.notifications.reset();
  }
}
