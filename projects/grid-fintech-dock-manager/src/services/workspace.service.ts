import type { IgcDockManagerLayout } from "igniteui-dockmanager";
import { DEFAULT_CHART_SYMBOLS, DEFAULT_WATCHLIST } from "../data/market-seed.js";
import type { OrderSide } from "../models/stock.model.js";
import {
  DOCK_PANES,
  type DockPaneId,
  buildDefaultLayout,
  chartSymbolsOf,
  isPaneVisible,
  parsePersistedLayout,
  withChartDocument,
  withPaneVisibility,
} from "../util/dock-layout.js";
import { Store, memoize } from "../util/store.js";

export type ThemeMode = "dark" | "light";

/**
 * `layout` when a new arrangement is pushed into the Dock Manager, `revision`
 * whenever the arrangement on screen changes (pushed or dragged), `reset` after
 * the desk is put back to its opening state, and one topic per preference.
 */
export type WorkspaceTopic = "theme" | "selection" | "search" | "newsFilter" | "watchlist" | "layout" | "revision" | "reset";

/** A pane the nav rail can show or hide. */
export interface PaneToggle {
  id: DockPaneId;
  label: string;
  icon: string;
}

const STORAGE_PREFIX = "grid-fintech-dock-manager";
const LAYOUT_KEY = `${STORAGE_PREFIX}.layout`;
const THEME_KEY = `${STORAGE_PREFIX}.theme`;
const WATCHLIST_KEY = `${STORAGE_PREFIX}.watchlist`;

const FALLBACK_VIEWPORT = { width: 1440, height: 900 };
const KNOWN_PANE_IDS = Object.values(DOCK_PANES);

/**
 * Session state for the desk: the Dock Manager layout, the selected instrument
 * that every pane follows, the watchlist and the theme. Layout, watchlist and
 * theme survive a reload, so a trader's arrangement is still there tomorrow.
 */
export class WorkspaceService extends Store<WorkspaceTopic> {
  private _theme: ThemeMode = readStored(THEME_KEY, isThemeMode) ?? "dark";
  /** The instrument the order ticket, chart focus and news filter follow. */
  private _selectedSymbol: string = DEFAULT_CHART_SYMBOLS[0];
  /** Side the order ticket opens on: set by the Buy/Sell shortcuts in other panes. */
  private _ticketSide: OrderSide = "BUY";
  private _searchQuery = "";
  /** Symbol the news wire is narrowed to; empty means the whole wire. */
  private _newsFilter = "";
  private _watchlist: readonly string[] = readStored(WATCHLIST_KEY, isStringArray) ?? [...DEFAULT_WATCHLIST];

  private readonly restoredLayout = parseStoredLayout();

  /**
   * The layout pushed *into* the Dock Manager. It changes only on programmatic
   * edits (open a chart, toggle a pane, reset), never in response to a drag,
   * because re-assigning it mid-gesture would re-render the whole dock.
   */
  private _layout: IgcDockManagerLayout =
    this.restoredLayout ?? buildDefaultLayout(FALLBACK_VIEWPORT.width, FALLBACK_VIEWPORT.height, DEFAULT_CHART_SYMBOLS);

  /**
   * The arrangement actually on screen. The Dock Manager edits its layout in
   * place, so {@link revision} below is what makes the derived state re-read it.
   */
  private live: IgcDockManagerLayout = this._layout;

  /** Bumped on every layout change, so `chartSymbols` and `visiblePanes` refresh. */
  private revision = 0;

  /** The default arrangement is sized once, against the real viewport. */
  private sized = this.restoredLayout !== null;

  readonly paneToggles: readonly PaneToggle[] = [
    { id: DOCK_PANES.watchlist, label: "Watchlist", icon: "visibility" },
    { id: DOCK_PANES.orderTicket, label: "Order Ticket", icon: "add_shopping_cart" },
    { id: DOCK_PANES.positions, label: "Positions", icon: "account_balance_wallet" },
    { id: DOCK_PANES.blotter, label: "Blotter", icon: "assignment" },
    { id: DOCK_PANES.news, label: "News", icon: "newspaper" },
  ];

  private readonly chartSymbolsAt = memoize((_revision: number) => chartSymbolsOf(this.live));

  private readonly visiblePanesAt = memoize(
    (_revision: number) =>
      new Set(this.paneToggles.filter((pane) => isPaneVisible(this.live, pane.id)).map((pane) => pane.id)) as ReadonlySet<DockPaneId>,
  );

  constructor() {
    super();
    // The stored copies always hold the current values, defaults included.
    writeStored(THEME_KEY, this._theme);
    writeStored(WATCHLIST_KEY, this._watchlist);
  }

  get theme(): ThemeMode {
    return this._theme;
  }

  get isDark(): boolean {
    return this._theme === "dark";
  }

  get selectedSymbol(): string {
    return this._selectedSymbol;
  }

  get ticketSide(): OrderSide {
    return this._ticketSide;
  }

  get searchQuery(): string {
    return this._searchQuery;
  }

  get newsFilter(): string {
    return this._newsFilter;
  }

  get watchlist(): readonly string[] {
    return this._watchlist;
  }

  get layout(): IgcDockManagerLayout {
    return this._layout;
  }

  /** Chart documents currently open, read back out of the live layout. */
  get chartSymbols(): string[] {
    return this.chartSymbolsAt(this.revision);
  }

  /** Pane visibility, recomputed from the live layout so the rail cannot drift. */
  get visiblePanes(): ReadonlySet<DockPaneId> {
    return this.visiblePanesAt(this.revision);
  }

  toggleTheme(): void {
    this.setTheme(this._theme === "dark" ? "light" : "dark");
  }

  updateSearchQuery(value: string): void {
    if (this._searchQuery !== value) {
      this._searchQuery = value;
      this.emit("search");
    }
  }

  selectSymbol(symbol: string): void {
    if (this._selectedSymbol !== symbol) {
      this._selectedSymbol = symbol;
      this.emit("selection");
    }
  }

  setTicketSide(side: OrderSide): void {
    if (this._ticketSide !== side) {
      this._ticketSide = side;
      this.emit("selection");
    }
  }

  setNewsFilter(symbol: string): void {
    if (this._newsFilter !== symbol) {
      this._newsFilter = symbol;
      this.emit("newsFilter");
    }
  }

  /**
   * Points the whole desk at one instrument: it becomes the selection every
   * pane follows, its chart comes up, and the wire narrows to it.
   *
   * This is what clicking a watchlist row does: one gesture, and the panes
   * that can say something about that symbol all do.
   */
  focusSymbol(symbol: string): void {
    this.setNewsFilter(symbol);
    this.openChart(symbol);
  }

  /** Points the order ticket at an instrument and side in one gesture. */
  prepareOrder(symbol: string, side: OrderSide): void {
    this.selectSymbol(symbol);
    this.setTicketSide(side);
  }

  /** Selects the symbol and brings its chart document up, opening it if needed. */
  openChart(symbol: string): void {
    this.selectSymbol(symbol);
    this.pushLayout(withChartDocument(this.live, symbol));
  }

  togglePane(id: DockPaneId): void {
    this.setPaneVisible(id, !this.visiblePanes.has(id));
  }

  /**
   * Idempotent counterpart to {@link togglePane}, for controls that report a
   * state rather than an intent: re-applying the state the layout is already in
   * must not churn it.
   */
  setPaneVisible(id: DockPaneId, visible: boolean): void {
    if (this.visiblePanes.has(id) === visible) {
      return;
    }

    this.pushLayout(withPaneVisibility(this.live, id, visible));
  }

  /**
   * Adopts the arrangement the Dock Manager reports after a drag, dock or close.
   * The pushed layout is deliberately left untouched: only the derived state and
   * the saved copy move.
   */
  applyLayout(layout: IgcDockManagerLayout): void {
    this.live = layout;
    this.revision++;
    writeStored(LAYOUT_KEY, layout);
    this.emit("revision");
  }

  /**
   * Sizes the shipped default against the real viewport, once. Later resizes are
   * the Dock Manager's own business: rebuilding here would throw away whatever
   * arrangement the trader has since dragged into place.
   */
  initialiseViewport(width: number, height: number): void {
    if (this.sized) {
      return;
    }

    this.sized = true;
    this.pushLayout(buildDefaultLayout(width, height, this.chartSymbols));
  }

  /**
   * Returns the whole workspace to its opening state: the arrangement plus the
   * watchlist, theme, selected instrument, ticket side and search box.
   */
  reset(width: number, height: number): void {
    this.setTheme("dark");
    this.setWatchlist([...DEFAULT_WATCHLIST]);
    this.selectSymbol(DEFAULT_CHART_SYMBOLS[0]);
    this.setTicketSide("BUY");
    this.updateSearchQuery("");
    this.setNewsFilter("");
    this.resetLayout(width, height);
    this.emit("reset");
  }

  /** Drops the saved arrangement and rebuilds the shipped default. */
  resetLayout(width: number, height: number): void {
    clearStored(LAYOUT_KEY);
    this.sized = true;
    this.pushLayout(buildDefaultLayout(width, height, DEFAULT_CHART_SYMBOLS));
  }

  isWatched(symbol: string): boolean {
    return this._watchlist.includes(symbol);
  }

  addToWatchlist(symbol: string): void {
    if (!this._watchlist.includes(symbol)) {
      this.setWatchlist([symbol, ...this._watchlist]);
    }
  }

  removeFromWatchlist(symbol: string): void {
    if (this._watchlist.includes(symbol)) {
      this.setWatchlist(this._watchlist.filter((entry) => entry !== symbol));
    }
  }

  /** Pushes a new arrangement into the Dock Manager and saves it. */
  private pushLayout(next: IgcDockManagerLayout): void {
    this.live = next;
    this.revision++;
    this._layout = next;
    writeStored(LAYOUT_KEY, next);
    this.emit("layout", "revision");
  }

  private setTheme(theme: ThemeMode): void {
    if (this._theme !== theme) {
      this._theme = theme;
      writeStored(THEME_KEY, theme);
      this.emit("theme");
    }
  }

  private setWatchlist(watchlist: readonly string[]): void {
    this._watchlist = watchlist;
    writeStored(WATCHLIST_KEY, watchlist);
    this.emit("watchlist");
  }
}

// Persistence. Storage is best effort: a private-mode browser must not break
// the desk, so every access is guarded and falls back to the defaults.

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readStored<T>(key: string, guard: (value: unknown) => value is T): T | null {
  const raw = storage()?.getItem(key);
  if (!raw) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or private mode: the desk keeps working in memory.
  }
}

function clearStored(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

function parseStoredLayout(): IgcDockManagerLayout | null {
  const raw = storage()?.getItem(LAYOUT_KEY);
  return raw ? parsePersistedLayout(raw, KNOWN_PANE_IDS) : null;
}

const isThemeMode = (value: unknown): value is ThemeMode => value === "dark" || value === "light";
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === "string");
