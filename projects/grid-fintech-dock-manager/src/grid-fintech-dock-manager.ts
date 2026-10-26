import { LitElement, html, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import {
  configureTheme,
  defineComponents,
  IgcAvatarComponent,
  IgcBadgeComponent,
  IgcButtonComponent,
  IgcButtonGroupComponent,
  IgcDialogComponent,
  IgcIconButtonComponent,
  IgcIconComponent,
  IgcNavDrawerComponent,
  IgcSwitchComponent,
} from "igniteui-webcomponents";
import { defineComponents as defineDockManagerComponents, IgcDockManagerComponent, type IgcDockManagerEventMap } from "igniteui-dockmanager";
import "./alerts-panel/alerts-panel.js";
import "./blotter/blotter.js";
import "./chart-panel/chart-panel.js";
import "./news-panel/news-panel.js";
import "./order-ticket/order-ticket.js";
import "./positions-grid/positions-grid.js";
import "./watchlist/watchlist.js";
import { Desk } from "./services/desk.js";
import { FEED_SPEEDS, type FeedStatus } from "./services/market-data.service.js";
import { chartContentId, isFixedPaneId, type DockPaneId } from "./util/dock-layout.js";
import { money, price, signed } from "./util/format.js";
import { ICONS, registerDeskIcons } from "./util/icons.js";
import { StoreController, memoize } from "./util/store.js";
import styles from "./grid-fintech-dock-manager.scss?inline";

defineComponents(
  IgcAvatarComponent,
  IgcBadgeComponent,
  IgcButtonComponent,
  IgcButtonGroupComponent,
  IgcDialogComponent,
  IgcIconButtonComponent,
  IgcIconComponent,
  IgcNavDrawerComponent,
  IgcSwitchComponent,
);
defineDockManagerComponents(IgcDockManagerComponent);

/** The fonts the desk sets its type in. Fonts declared inside a shadow root are ignored, so they go to the document. */
const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@600;700&family=DM+Sans:wght@400;500;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap";

/**
 * How many copies of the figure ribbon the header ticker stamps.
 *
 * A CSS-only loop slides the track by one run and restarts, so it needs enough
 * copies that the ones still ahead of the frame cover the bar at that moment.
 * This is the same number as `--ticker-runs` in the stylesheet and has to move
 * with it.
 */
const TICKER_RUNS = [0, 1, 2, 3];

/**
 * The rail keeps a column of its own from this viewport width up. Narrower, it
 * floats over the desk's left edge, and the expanded drawer opens over the desk
 * with a backdrop, so the panes keep the whole width.
 */
const RAIL_PINNED_QUERY = "(min-width: 1024px)";

type BadgeVariant = "success" | "info" | "warning" | "primary";

/** Maps the feed's state onto a badge colour. */
function feedBadgeVariant(status: FeedStatus): BadgeVariant {
  switch (status) {
    case "live":
      return "success";
    case "simulated":
      return "info";
    case "connecting":
      return "warning";
    default:
      return "primary";
  }
}

/** Adds a stylesheet link to the document head once. */
function ensureDocumentStylesheet(href: string): void {
  const exists = Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).some(
    (link) => link.href === href,
  );
  if (!exists) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.append(link);
  }
}

/**
 * Signal Desk: the sample's application shell.
 *
 * The shell owns no trading state: it wires the Dock Manager to the workspace
 * service, mounts one element per pane, and renders the account and feed
 * status that the services publish.
 */
@customElement("app-grid-fintech-dock-manager")
export default class GridFintechDockManager extends LitElement {
  static styles = unsafeCSS(styles);

  private readonly desk = new Desk();

  /** The open charts and the shown panes, as last rendered. */
  private arrangement = "";

  /** Expanded state of the nav drawer. */
  @state() private navExpanded = false;

  /** Whether the rail has a column of its own (see {@link RAIL_PINNED_QUERY}). */
  @state() private railPinned = true;

  private railPinnedMedia?: MediaQueryList;

  /**
   * The feed speed as the selection of its button group. The group keeps its own
   * selection and tab stop in step, so the speed is set through it rather than on
   * its buttons, and a new array is made only when the speed changes.
   */
  private readonly speedItemsFor = memoize((frequency: number): string[] => [String(frequency)]);

  /** The unread count that the bell's label was last refreshed for. */
  private bellUnread = -1;

  @query(".reset-dialog") private resetDialog!: IgcDialogComponent;
  @query(".notifications-dialog") private notificationsDialog!: IgcDialogComponent;
  @query(".alert-bell") private alertBell?: IgcIconButtonComponent;

  constructor() {
    super();
    const { market, trading, notifications, workspace } = this.desk;
    new StoreController(this)
      .watch(() => market, "tick", "status")
      .watch(() => trading, "book", "orders", "account", "marks")
      .watch(() => notifications, "notifications")
      .watch(() => workspace, "theme", "layout")
      .on(() => workspace, "revision", () => this.onArrangementChange());
  }

  connectedCallback(): void {
    // Theme, fonts and the tape start when the sample is shown, not on import.
    configureTheme("fluent", "light");
    ensureDocumentStylesheet(FONTS_HREF);
    registerDeskIcons();
    super.connectedCallback();

    this.railPinnedMedia = window.matchMedia(RAIL_PINNED_QUERY);
    this.railPinned = this.railPinnedMedia.matches;
    this.railPinnedMedia.addEventListener("change", this.onRailPinnedChange);

    this.desk.start();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.railPinnedMedia?.removeEventListener("change", this.onRailPinnedChange);
    this.desk.stop();
  }

  private readonly onRailPinnedChange = (event: MediaQueryListEvent): void => {
    this.railPinned = event.matches;
  };

  protected willUpdate(): void {
    if (!this.hasUpdated) {
      // The shipped arrangement is sized to the space the desk actually has,
      // once, before the Dock Manager first lays it out.
      const rect = this.getBoundingClientRect();
      this.desk.workspace.initialiseViewport(rect.width, rect.height);
    }

    // The palette is declared on the host, so the appearance is a host attribute.
    this.setAttribute("theme", this.desk.workspace.theme);
    this.arrangement = this.arrangementOf();
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);

    // The bell's name carries the unread count. The icon button copies its label
    // to its inner button only when it renders, and a changed label does not make
    // it render, so it is told to when the count moves.
    const unread = this.desk.notifications.unreadCount;
    if (unread !== this.bellUnread) {
      this.bellUnread = unread;
      this.alertBell?.requestUpdate();
    }
  }

  /** Which charts are open and which panes are shown: all the shell renders of the arrangement. */
  private arrangementOf(): string {
    const { chartSymbols, visiblePanes } = this.desk.workspace;
    return `${[...chartSymbols].sort().join()}|${[...visiblePanes].join()}`;
  }

  /**
   * The Dock Manager reports every change to the arrangement, including the
   * echo of a layout it has just been given and every drag. The shell only
   * re-renders when the open charts or the shown panes actually change.
   */
  private onArrangementChange(): void {
    if (this.arrangementOf() !== this.arrangement) {
      this.requestUpdate();
    }
  }

  // Command bar

  /**
   * Opens or closes the rail. The toggle that was pressed is hidden by the change,
   * and the browser would carry on from its old position, past the whole rail, so
   * focus moves to the same button of the rail that is shown now.
   */
  private async toggleNav(): Promise<void> {
    this.navExpanded = !this.navExpanded;
    await this.updateComplete;
    const toggle = this.renderRoot.querySelector<HTMLElement>(
      this.navExpanded ? ".rail-head-expanded .rail-toggle" : '.rail[slot="mini"] .rail-toggle',
    );
    toggle?.focus();
  }

  /** A floating drawer closes itself on a click on its backdrop or on Escape. */
  private onDrawerClosed(): void {
    this.navExpanded = false;
  }

  private toggleTheme(): void {
    this.desk.workspace.toggleTheme();
  }

  private togglePlayback(): void {
    this.desk.market.togglePlayback();
  }

  private onFeedSpeedSelected(event: CustomEvent<string | undefined>): void {
    const speed = FEED_SPEEDS.find((entry) => String(entry.value) === event.detail);
    if (speed) {
      this.desk.market.setFrequency(speed.value);
    }
  }

  /**
   * Alerts open in a dialog rather than a pane, and showing them is what marks
   * them read: the panel itself is created once, so it cannot own that.
   */
  private showAlerts(): void {
    this.desk.notifications.markAllRead();
    void this.notificationsDialog.show();
  }

  // Nav rail

  private togglePane(id: DockPaneId): void {
    this.desk.workspace.togglePane(id);
  }

  /** Space and Enter work the rail rows the way they work a button. */
  private activateOnKey(event: KeyboardEvent, action: () => void): void {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      action();
    }
  }

  // Dock Manager

  /**
   * The pane header's X *removes* a pane from the layout, and a pane that is no
   * longer in the layout cannot be brought back by the rail: there is nothing
   * left for the visibility switch to find.
   *
   * So for the fixed panes the close is cancelled and turned into a hide, which
   * is exactly the state the rail already drives. Chart documents keep the
   * default behaviour: they are meant to be closed for good and reopened from
   * the watchlist.
   *
   * A close never mixes the two (a tab group holds either the fixed panes or
   * the chart documents, never both), so this either claims the whole event or
   * leaves it alone.
   */
  private onPaneClose(event: IgcDockManagerEventMap["paneClose"]): void {
    const panes = event.detail?.panes ?? [];
    if (panes.length === 0 || !panes.every((pane) => isFixedPaneId(pane.contentId))) {
      return;
    }

    event.preventDefault();
    for (const pane of panes) {
      pane.hidden = true;
    }
  }

  private onLayoutChange(event: IgcDockManagerEventMap["layoutChange"]): void {
    const layout = event.detail?.layout;
    if (layout) {
      this.desk.workspace.applyLayout(layout);
    }
  }

  /**
   * Reset discards the whole session (the book and the blotter included), so
   * the rail's button asks before {@link confirmReset} does anything.
   */
  private resetDesk(): void {
    void this.resetDialog.show();
  }

  /** Puts the whole sample back to how it opened, not just the layout. */
  private confirmReset(): void {
    void this.resetDialog.hide();
    const rect = this.getBoundingClientRect();
    this.desk.reset(rect.width, rect.height);
  }

  // Rendering

  protected render(): TemplateResult {
    const { desk } = this;
    const { workspace } = desk;
    const theme = workspace.theme;

    return html`
      <div class="grid-fintech-dock-manager app-shell" data-app="grid-fintech-dock-manager">
        <igc-nav-drawer
          class="platform-rail"
          position=${this.railPinned ? "relative" : "start"}
          ?open=${this.navExpanded}
          @igcClosed=${this.onDrawerClosed}
        >
          <!-- The collapsed drawer's full rail is off screen: out of reach and out of the reading order. -->
          <div class="rail" ?inert=${!this.navExpanded} aria-hidden=${this.navExpanded ? nothing : "true"}>
            ${this.renderRail(true)}
          </div>
          <div class="rail" slot="mini">${this.renderRail(false)}</div>
        </igc-nav-drawer>

        <div class="workspace">
          ${this.renderCommandBar()}

          <div class="main-area">
            <igc-dockmanager
              class="dock-area"
              .layout=${workspace.layout}
              @layoutChange=${this.onLayoutChange}
              @paneClose=${this.onPaneClose}
            >
              <grid-fintech-dock-manager-watchlist slot="watchlist" class="dock-pane" theme=${theme} .desk=${desk}></grid-fintech-dock-manager-watchlist>
              <grid-fintech-dock-manager-order-ticket slot="orderTicket" class="dock-pane" theme=${theme} .desk=${desk}></grid-fintech-dock-manager-order-ticket>
              <grid-fintech-dock-manager-positions slot="positions" class="dock-pane" theme=${theme} .desk=${desk}></grid-fintech-dock-manager-positions>
              <grid-fintech-dock-manager-blotter slot="blotter" class="dock-pane" theme=${theme} .desk=${desk}></grid-fintech-dock-manager-blotter>
              <grid-fintech-dock-manager-news slot="news" class="dock-pane" theme=${theme} .desk=${desk}></grid-fintech-dock-manager-news>

              ${
                // One slot per open chart document; the layout is the source of
                // truth. Stamped in a stable order, so opening or closing a
                // chart never moves (and so never reconnects) the others.
                repeat(
                  [...workspace.chartSymbols].sort(),
                  (symbol) => symbol,
                  (symbol) => html`
                    <grid-fintech-dock-manager-chart
                      slot=${chartContentId(symbol)}
                      class="dock-pane"
                      theme=${theme}
                      .desk=${desk}
                      .symbol=${symbol}
                    ></grid-fintech-dock-manager-chart>
                  `,
                )
              }
            </igc-dockmanager>
          </div>
        </div>
      </div>

      <!-- Reset throws away the session, so it asks first. -->
      <igc-dialog class="reset-dialog" title="Reset the desk?" close-on-outside-click>
        <span class="dialog-message">
          The layout, watchlist, theme, book and alerts all go back to how they opened. Orders you have placed and
          positions you have opened are discarded.
        </span>
        <igc-button slot="footer" variant="flat" @click=${() => this.resetDialog.hide()}>Cancel</igc-button>
        <igc-button slot="footer" variant="contained" @click=${this.confirmReset}>Reset</igc-button>
      </igc-dialog>

      <!-- Alerts are read on arrival rather than browsed, so they are a dialog
           rather than a pane. -->
      <igc-dialog class="notifications-dialog" close-on-outside-click>
        <div slot="title" class="notifications-title">
          <igc-icon name="notifications" collection=${ICONS} aria-hidden="true"></igc-icon>
          <span>Alerts</span>
        </div>

        <div class="notifications-body">
          <grid-fintech-dock-manager-alerts class="notifications-panel" .desk=${desk}></grid-fintech-dock-manager-alerts>
        </div>

        <igc-button slot="footer" variant="flat" @click=${() => this.notificationsDialog.hide()}>Close</igc-button>
      </igc-dialog>
    `;
  }

  /** The rail's content: the mini and the expanded drawer render the same list. */
  private renderRail(expanded: boolean): TemplateResult {
    const { workspace } = this.desk;
    const visible = workspace.visiblePanes;

    return html`
      <div class="rail-head ${expanded ? "rail-head-expanded" : ""}">
        <igc-icon-button
          variant="flat"
          class="rail-toggle"
          name=${expanded ? "chevron_left" : "chevron_right"}
          collection=${ICONS}
          aria-expanded=${expanded ? "true" : "false"}
          aria-label=${expanded ? "Collapse the pane rail" : "Expand the pane rail"}
          @click=${this.toggleNav}
        ></igc-icon-button>
      </div>

      <nav class="rail-nav" aria-label="Show or hide panes">
        ${workspace.paneToggles.map((pane) => {
          const shown = visible.has(pane.id);
          const toggle = () => this.togglePane(pane.id);
          return html`
            <igc-nav-drawer-item
              class="rail-item"
              role="switch"
              tabindex="0"
              ?active=${shown}
              aria-checked=${shown ? "true" : "false"}
              aria-label=${expanded ? nothing : pane.label}
              title=${expanded ? "" : pane.label}
              @click=${toggle}
              @keydown=${(event: KeyboardEvent) => this.activateOnKey(event, toggle)}
            >
              <igc-icon slot="icon" name=${pane.icon} collection=${ICONS} aria-hidden="true"></igc-icon>
              ${expanded
                ? html`
                    <span slot="content" class="rail-content">
                      <span class="rail-label">${pane.label}</span>
                      <!-- Indicator only: the row is the control, so a click
                           anywhere on the item flips it. Inert and hidden, it is
                           neither a second tab stop nor a second state for
                           assistive tech; the row's role="switch" reports it. -->
                      <igc-switch class="rail-switch" aria-hidden="true" inert ?checked=${shown}></igc-switch>
                    </span>
                  `
                : nothing}
            </igc-nav-drawer-item>
          `;
        })}
      </nav>

      <div class="rail-footer">
        <igc-nav-drawer-item
          class="rail-item"
          role="button"
          tabindex="0"
          title="Restore the desk to its opening state"
          aria-label="Reset the desk"
          @click=${this.resetDesk}
          @keydown=${(event: KeyboardEvent) => this.activateOnKey(event, () => this.resetDesk())}
        >
          <igc-icon slot="icon" name="restart_alt" collection=${ICONS} aria-hidden="true"></igc-icon>
          ${expanded ? html`<span slot="content" class="rail-label">Reset desk</span>` : nothing}
        </igc-nav-drawer-item>
      </div>
    `;
  }

  private renderCommandBar(): TemplateResult {
    const { market, notifications, workspace } = this.desk;
    const status = market.status;
    const paused = market.isPaused;
    const unread = notifications.unreadCount;
    const playbackLabel = paused ? "Resume the market feed" : "Pause the market feed";
    const themeLabel = workspace.isDark ? "Switch to light mode" : "Switch to dark mode";

    return html`
      <header class="command-bar" role="banner">
        <!-- Three zones, hairline-separated: who we are and what the tape is
             doing, then the market, then the account and its controls. -->
        <div class="bar-zone bar-lead">
          <div class="brand">SignalDesk</div>

          <div class="feed-controls" role="group" aria-label="Market feed">
            <igc-badge class="feed-status" role="status" variant=${feedBadgeVariant(status)} aria-label="Feed status: ${status}"
              >${status}</igc-badge
            >

            <igc-icon-button
              variant="flat"
              name=${paused ? "play_arrow" : "pause"}
              collection=${ICONS}
              aria-label=${playbackLabel}
              title=${playbackLabel}
              @click=${this.togglePlayback}
            ></igc-icon-button>

            <igc-button-group
              class="speed-group"
              selection="single-required"
              .selectedItems=${this.speedItemsFor(market.frequency)}
              @igcSelect=${this.onFeedSpeedSelected}
            >
              ${FEED_SPEEDS.map(
                (speed) => html`
                  <igc-toggle-button value=${speed.value} title="Tick every ${speed.value}ms"
                    ><span>${speed.label}</span></igc-toggle-button
                  >
                `,
              )}
            </igc-button-group>
          </div>
        </div>

        <!-- The figure ribbon: indices and account summary on one endless loop.
             The copies are not redundant: the loop resets the instant copy two
             stands where copy one began, so there is never a blank stretch in
             frame. Only the first is read out. -->
        <div
          class="bar-zone bar-ticker"
          role="region"
          aria-label="Market indices and account summary \u2014 hover or focus to pause"
          tabindex="0"
        >
          <div class="ticker-track">
            ${TICKER_RUNS.map(
              (run) => html`<div class="ticker-run" aria-hidden=${run === 0 ? nothing : "true"}>${this.renderTickerFigures()}</div>`,
            )}
          </div>
        </div>

        <div class="bar-zone bar-actions">
          <igc-avatar initials="S" shape="circle" class="user-avatar"></igc-avatar>

          <div class="notification-controls" role="group" aria-label="Alerts">
            <igc-icon-button
              variant="flat"
              class="alert-bell"
              name="notifications"
              collection=${ICONS}
              aria-label="${unread} unread alerts \u2014 show alerts"
              title="Show alerts"
              @click=${this.showAlerts}
            ></igc-icon-button>
            ${unread > 0 ? html`<igc-badge class="bell-badge" variant="danger">${unread}</igc-badge>` : nothing}
          </div>

          <igc-icon-button
            variant="flat"
            name=${workspace.isDark ? "light_mode" : "dark_mode"}
            collection=${ICONS}
            title=${themeLabel}
            aria-label=${themeLabel}
            @click=${this.toggleTheme}
          ></igc-icon-button>
        </div>
      </header>
    `;
  }

  /** One run of the ticker: the four indices, then the account summary. */
  private renderTickerFigures(): TemplateResult {
    const { market, trading } = this.desk;
    const account = trading.account;

    return html`
      ${market.indices.map(
        (index) => html`
          <div class="stat">
            <span class="stat-label">${index.name}</span>
            <span class="stat-line">
              <span class="stat-value mono">${price(index.value)}</span>
              <span class="stat-delta mono ${index.positive ? "pos" : "neg"}">${signed(index.changePct, "pct")}</span>
            </span>
          </div>
        `,
      )}

      <dl class="ticker-account" aria-label="Account summary">
        <div class="stat">
          <dt class="stat-label">Net liq.</dt>
          <dd class="stat-line"><span class="stat-value mono">${money(account.netLiquidation)}</span></dd>
        </div>
        <div class="stat">
          <dt class="stat-label">Day P&amp;L</dt>
          <dd class="stat-line">
            <span class="stat-value mono ${account.dayPl >= 0 ? "pos" : "neg"}">${signed(account.dayPl, "money")}</span>
          </dd>
        </div>
        <div class="stat">
          <dt class="stat-label">Buying power</dt>
          <dd class="stat-line"><span class="stat-value mono">${money(account.buyingPower)}</span></dd>
        </div>
        <div class="stat">
          <dt class="stat-label">Working</dt>
          <dd class="stat-line"><span class="stat-value mono">${trading.workingOrders.length}</span></dd>
        </div>
      </dl>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "app-grid-fintech-dock-manager": GridFintechDockManager;
  }
}
