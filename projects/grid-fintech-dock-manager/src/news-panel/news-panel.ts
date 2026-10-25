import { LitElement, html, nothing, unsafeCSS, type TemplateResult } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import {
  defineComponents,
  IgcIconComponent,
  IgcListComponent,
  IgcSelectComponent,
  type IgcSelectItemComponent,
} from "igniteui-webcomponents";
import type { NewsArticle } from "../models/stock.model.js";
import type { Desk } from "../services/desk.js";
import { since } from "../util/format.js";
import { ICONS } from "../util/icons.js";
import { StoreController, memoize } from "../util/store.js";
import styles from "./news-panel.scss?inline";

defineComponents(IgcIconComponent, IgcListComponent, IgcSelectComponent);

/** The option for "no symbol filter": the whole wire. A select item needs a value to be selectable. */
const ALL_SYMBOLS = "all-symbols";

/**
 * The news wire, as a docked pane. Alerts are separate: they live in the
 * command bar's dialog, being read on arrival rather than browsed.
 */
@customElement("grid-fintech-dock-manager-news")
export default class NewsPane extends LitElement {
  static styles = unsafeCSS(styles);

  @property({ attribute: false }) desk!: Desk;

  @query("igc-select") private filterSelect?: IgcSelectComponent;

  /**
   * Only the symbols the wire is actually carrying, so the list can never offer
   * a filter that would empty the pane. A symbol focused from another pane may
   * have nothing on the wire yet, and without an option for it the select would
   * render an empty box, so the active filter is always offered.
   */
  private readonly wireSymbolsFor = memoize((news: readonly NewsArticle[], active: string) => {
    const symbols = new Set<string>();
    for (const article of news) {
      if (article.symbol) {
        symbols.add(article.symbol);
      }
    }
    if (active) {
      symbols.add(active);
    }

    return [...symbols].sort();
  });

  constructor() {
    super();
    new StoreController(this)
      .watch(() => this.desk.notifications, "news", "clock")
      .watch(() => this.desk.workspace, "newsFilter");
  }

  /**
   * The filter is shared rather than local: clicking a watchlist row narrows the
   * wire too, and a reset has to be able to clear it.
   */
  private onFilterChange(event: CustomEvent<IgcSelectItemComponent>): void {
    const value = event.detail?.value ?? ALL_SYMBOLS;
    this.desk.workspace.setNewsFilter(value === ALL_SYMBOLS ? "" : value);
  }

  protected updated(): void {
    // Selected after the options render: the filter can name a symbol whose
    // option was added in this same render.
    const option = this.desk.workspace.newsFilter || ALL_SYMBOLS;
    if (this.filterSelect && this.filterSelect.value !== option) {
      this.filterSelect.select(option);
    }
  }

  /** Jumps the desk to the instrument a headline is about. */
  private selectSymbol(symbol: string | null): void {
    if (symbol) {
      this.desk.workspace.selectSymbol(symbol);
    }
  }

  protected render(): TemplateResult {
    const { notifications, workspace } = this.desk;
    const filter = workspace.newsFilter;
    // The untagged macro wire stays alongside the instrument: a filtered desk
    // still wants to see the Fed headline.
    const articles = filter ? notifications.newsFor(filter) : notifications.news;
    const now = notifications.now;

    return html`
      <div class="panel-body">
        <div class="panel-actions">
          <igc-select class="news-filter" aria-label="Filter the wire by symbol" value=${ALL_SYMBOLS} @igcChange=${this.onFilterChange}>
            <igc-icon slot="prefix" name="filter_alt" collection=${ICONS} aria-hidden="true"></igc-icon>
            <igc-select-item value=${ALL_SYMBOLS}>All symbols</igc-select-item>
            ${this.wireSymbolsFor(notifications.news, filter).map(
              (symbol) => html`<igc-select-item value=${symbol}>${symbol}</igc-select-item>`,
            )}
          </igc-select>
        </div>

        <igc-list class="item-list plain-list">
          ${articles.map(
            (article) => html`
              <igc-list-item>
                <div class="news-item">
                  <button type="button" class="news-headline" ?disabled=${!article.symbol} @click=${() => this.selectSymbol(article.symbol)}>
                    ${article.headline}
                  </button>
                  <div class="news-meta">
                    ${article.symbol ? html`<span class="news-symbol">${article.symbol}</span>` : nothing}
                    <span>${article.source}</span>
                    <span aria-hidden="true">\u00b7</span>
                    <time>${since(article.at, now)}</time>
                  </div>
                </div>
              </igc-list-item>
            `,
          )}
          ${articles.length === 0
            ? html`<p class="list-empty">Nothing on the wire${filter ? ` for ${filter}` : ""} yet.</p>`
            : nothing}
        </igc-list>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "grid-fintech-dock-manager-news": NewsPane;
  }
}
