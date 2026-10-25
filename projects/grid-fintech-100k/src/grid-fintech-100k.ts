import { LitElement, html, nothing, unsafeCSS, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { ref } from "lit/directives/ref.js";
import {
  configureTheme,
  defineComponents,
  IgcButtonGroupComponent,
  IgcIconButtonComponent,
  IgcIconComponent,
  IgcSelectComponent,
  IgcSelectItemComponent,
  IgcToggleButtonComponent,
} from "igniteui-webcomponents";
import "igniteui-webcomponents-grids/grids/combined.js";
import type { IgcCellTemplateContext, IgcColumnExportingEventArgs, IgcColumnPipeArgs, IgcExporterEventArgs, IgcGridComponent } from "igniteui-webcomponents-grids/grids";
import { CONTRACT_TYPES, REGIONS, getFinjsRows, type FinjsRow } from "./finjs-data.js";
import { ICON_COLLECTION, registerFinjsIcons } from "./icons.js";
import { prepareGridShadowRoot } from "./grid-shadow-root.js";
import styles from "./grid-fintech-100k.scss?inline";

type FinjsSize = "small" | "medium" | "large";
type FinjsTheme = "light" | "dark";

const FINJS_SIZES: readonly FinjsSize[] = ["small", "medium", "large"];

/**
 * How long a returning element waits before it builds its new grid. The old grid's teardown, 10 ms
 * after it left the document, removes component styles that a grid created in the same shadow root
 * in the meantime already relies on, leaving it unstyled.
 */
const GRID_REBUILD_DELAY_MS = 50;

/**
 * The height the Hiding and Pinning panels give their column list. It is stated, rather than left to the
 * toolbar's own default, because the panel is measured before that default is applied: the first
 * measurement is then of all 41 columns at full height, and the panel is placed out of position.
 */
const COLUMNS_AREA_MAX_HEIGHT = "clamp(200px, 40vh, 420px)";

defineComponents(IgcButtonGroupComponent, IgcToggleButtonComponent, IgcIconButtonComponent, IgcIconComponent, IgcSelectComponent, IgcSelectItemComponent);

/** `1000000` -> `1M rows`, `100000` -> `100K rows`. Whole units only; the counts are round. */
function formatRowCount(count: number): string {
  if (count >= 1_000_000) return `${count / 1_000_000}M rows`;
  if (count >= 1_000) return `${count / 1_000}K rows`;
  return `${count} rows`;
}

/** The price as US dollars with four decimals: `$462.1300`. */
const priceFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 4 });

/** Grid cell classes reflecting the magnitude and direction of the daily percent change. */
const trends = {
  positive: (rowData: FinjsRow): boolean => rowData.changeP > 0,
  negative: (rowData: FinjsRow): boolean => rowData.changeP < 0,
  changePos: (rowData: FinjsRow): boolean => rowData.changeP > 0 && rowData.changeP < 1,
  changeNeg: (rowData: FinjsRow): boolean => rowData.changeP < 0 && rowData.changeP > -1,
  strongPositive: (rowData: FinjsRow): boolean => rowData.changeP >= 1,
  strongNegative: (rowData: FinjsRow): boolean => rowData.changeP <= -1,
};

/** The columns the PDF export keeps; every other column is cancelled while the PDF is written. */
const PDF_FIELDS = new Set([
  "id", "category", "type", "contract", "settlement", "country", "region",
  "lastUpdated", "openPrice", "price", "change", "changeP", "buy", "sell",
]);

/**
 * What the grid's export service looks like at run time. The typings describe an element with a
 * `columnExporting` DOM event; the object the toolbar hands over is the grid's own service, which emits
 * it through `subscribe`.
 */
interface ColumnExportingSource {
  columnExporting: { subscribe(listener: (args: IgcColumnExportingEventArgs) => void): unknown };
}

/** The options of the PDF exporter; the Excel and CSV options have no page size. */
interface PdfExportOptions {
  pageSize: string;
}

/** FinTech Trading: a 100,000-row, 41-column instrument grid with filtering, editing, sizing and export. */
@customElement("app-grid-fintech-100k")
export default class GridFintech100k extends LitElement {
  /** The sample-wide density; it drives the grid's row height and every control around it. */
  @property({ reflect: true }) size: FinjsSize = "medium";

  /** The appearance. The light Fluent grid theme stays loaded in both; the dark palette is re-emitted on top of it. */
  @property({ reflect: true }) theme: FinjsTheme = "light";

  /** False while a returning element waits to build a new grid; see `GRID_REBUILD_DELAY_MS`. */
  @state()
  private showGrid = true;

  /**
   * Whether the grid's own stylesheet has arrived (or failed to). The grid is created only then: it
   * measures itself when it is created, and without its stylesheet its rows have no layout of their own.
   */
  @state()
  private themeSettled = false;

  @query("igc-grid")
  private grid?: IgcGridComponent;

  private rows: FinjsRow[] = [];

  private rowCountObserver?: MutationObserver;

  private rebuildTimer?: ReturnType<typeof setTimeout>;

  /** The PDF exporters whose column filter is already in place. */
  private readonly filteredPdfExporters = new WeakSet<object>();

  private readonly columnFormat: IgcColumnPipeArgs = { digitsInfo: "1.3-3" };
  private readonly columnFormatChangeP: IgcColumnPipeArgs = { digitsInfo: "3.3-3" };

  connectedCallback() {
    // Theme, icons and data are set up when the sample is shown, not on import: the shell bundle
    // loads every sample's module into every page.
    configureTheme("fluent", "light");
    registerFinjsIcons();
    this.rows = getFinjsRows();
    super.connectedCallback();
    if (this.hasUpdated) {
      this.restoreGrid();
    }
  }

  disconnectedCallback() {
    clearTimeout(this.rebuildTimer);
    this.rowCountObserver?.disconnect();
    super.disconnectedCallback();
  }

  /**
   * A grid tears itself down, and takes its element out of the document, 10 ms after it has left
   * it. An element that comes back sooner still has its grid; after that it builds a new one.
   */
  private restoreGrid() {
    if (this.grid) {
      this.keepRowCount();
      return;
    }
    this.showGrid = false;
    this.rebuildTimer = setTimeout(() => {
      this.showGrid = true;
    }, GRID_REBUILD_DELAY_MS);
  }

  /**
   * The grid counts its rows once, when it is created, and reports one: assistive technology would
   * announce a one-row grid. The real count, the header plus the data, is put back whenever the grid
   * writes its own.
   */
  private keepRowCount() {
    const grid = this.grid;
    if (!grid) {
      return;
    }
    const expected = String(this.rows.length + 1);
    const apply = () => {
      if (grid.getAttribute("aria-rowcount") !== expected) {
        grid.setAttribute("aria-rowcount", expected);
      }
    };
    this.rowCountObserver?.disconnect();
    this.rowCountObserver = new MutationObserver(apply);
    this.rowCountObserver.observe(grid, { attributes: true, attributeFilter: ["aria-rowcount"] });
    apply();
  }

  protected updated(changed: PropertyValues) {
    // Row height derives from --ig-size, and at this row count the grid is fully virtualized: it
    // caches the height it measured and keeps scrolling against the old one until told otherwise.
    // The first render is skipped because the grid measures itself on init.
    if (changed.has("size") && changed.get("size") !== undefined) {
      this.grid?.reflow();
    }
    // The grid has just been created, by the first render after its stylesheet arrived or by a rebuild.
    if (changed.get("themeSettled") === false || changed.get("showGrid") === false) {
      prepareGridShadowRoot(this.renderRoot as ShadowRoot);
      this.keepRowCount();
    }
  }

  private onThemeSettled() {
    this.themeSettled = true;
  }

  private onSizeSelected(event: CustomEvent<string | undefined>) {
    const size = FINJS_SIZES.find((candidate) => candidate === event.detail);
    if (size) {
      this.size = size;
    }
  }

  private toggleTheme() {
    this.theme = this.theme === "dark" ? "light" : "dark";
  }

  private rowSelectionChanging() {
    this.grid?.clearCellSelection();
  }

  /** Sets the PDF page size and, once per exporter, keeps the columns outside `PDF_FIELDS` out of the PDF. */
  private onExportStarted(event: CustomEvent<IgcExporterEventArgs>) {
    const { exporter, options } = event.detail;
    if (!("pageSize" in options)) {
      return;
    }
    (options as PdfExportOptions).pageSize = "A3";

    if (this.filteredPdfExporters.has(exporter)) {
      return;
    }
    this.filteredPdfExporters.add(exporter);
    (exporter as unknown as ColumnExportingSource).columnExporting.subscribe((args) => {
      if (!PDF_FIELDS.has(args.field)) {
        args.cancel = true;
      }
    });
  }

  private priceTemplate = (ctx: IgcCellTemplateContext) => {
    const row = ctx.cell.row.data as FinjsRow;
    return html`
      <div class="finjs-icons">
        ${trends.positive(row) ? html`<igc-icon name="arrow_upward" collection=${ICON_COLLECTION} aria-hidden="true"></igc-icon>` : nothing}
        ${trends.negative(row) ? html`<igc-icon name="arrow_downward" collection=${ICON_COLLECTION} aria-hidden="true"></igc-icon>` : nothing}
        <span>${priceFormat.format(ctx.cell.value)}</span>
      </div>
    `;
  };

  /**
   * Puts the keyboard focus in a dropdown editor as soon as the grid shows it. The `autofocus`
   * attribute would do the same, but the browser logs that it ignores the attribute whenever the
   * document already has a focused element, which a cell being edited always is.
   */
  private focusEditor = (editor?: Element) => {
    const select = editor as IgcSelectComponent | undefined;
    select?.updateComplete.then(() => select.focus());
  };

  /**
   * Enter and Escape pressed on an item belong to the open list: the select has already used the key to
   * pick the item or close the list, and the key must not also reach the grid cell, which would commit
   * or cancel the edit. Only an item has the focus while the list is open, so the target is what tells
   * the two cases apart; the same keys on the closed select still reach the cell.
   */
  private keepListKeys = (event: KeyboardEvent) => {
    if ((event.key === "Enter" || event.key === "Escape") && (event.target as Element).closest("igc-select-item")) {
      event.stopPropagation();
    }
  };

  /** The in-cell dropdown editor of the Contract and Region columns. */
  private selectEditor(options: readonly string[]) {
    return (ctx: IgcCellTemplateContext) => html`
      <igc-select
        class="finjs-select-editor"
        ${ref(this.focusEditor)}
        .value=${ctx.cell.editValue}
        placeholder=${ctx.implicit}
        @igcChange=${(event: CustomEvent<IgcSelectItemComponent>) => {
          ctx.cell.editValue = event.detail.value;
        }}
        @keydown=${this.keepListKeys}
      >
        ${options.map((option) => html`<igc-select-item value=${option}>${option}</igc-select-item>`)}
      </igc-select>
    `;
  }

  private contractEditor = this.selectEditor(CONTRACT_TYPES);
  private regionEditor = this.selectEditor(REGIONS.map((region) => region.name));

  render() {
    return html`
      <link rel="stylesheet" href="${import.meta.env.BASE_URL}themes/fluent.css" @load=${this.onThemeSettled} @error=${this.onThemeSettled} />
      <div class="grid-fintech-100k finjs-grid-wrapper ig-typography ig-scrollbar" data-app="grid-fintech-100k">
        ${this.themeSettled && this.showGrid ? this.renderGrid() : nothing}
      </div>
    `;
  }

  private renderGrid() {
    return html`
      <igc-grid
        class="finjs-grid"
        width="100%"
        height="100%"
        primary-key="id"
        .autoGenerate=${false}
        .data=${this.rows}
        row-selection="multiple"
        .allowFiltering=${true}
        .moving=${true}
        filter-mode="excelStyleFilter"
        @rowSelectionChanging=${this.rowSelectionChanging}
      >
        <igc-grid-toolbar>
          <igc-grid-toolbar-title>
            <span class="finjs-title">
              <h1>FinTech Trading</h1>
              <span class="finjs-row-count">${formatRowCount(this.rows.length)}</span>
            </span>
          </igc-grid-toolbar-title>
          <igc-grid-toolbar-actions>
            <igc-button-group class="finjs-size-group" selection="single-required" aria-label="Component size" .selectedItems=${[this.size]} @igcSelect=${this.onSizeSelected}>
              ${FINJS_SIZES.map(
                (size) => html`<igc-toggle-button value=${size} title="Render the sample at ${size} size"><span>${size}</span></igc-toggle-button>`
              )}
            </igc-button-group>

            <igc-icon-button
              variant="outlined"
              class="finjs-theme-toggle"
              name=${this.theme === "dark" ? "light_mode" : "dark_mode"}
              collection=${ICON_COLLECTION}
              title=${this.theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-label=${this.theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              @click=${this.toggleTheme}
            ></igc-icon-button>

            <igc-grid-toolbar-hiding title="Indicators" columns-area-max-height=${COLUMNS_AREA_MAX_HEIGHT}></igc-grid-toolbar-hiding>
            <igc-grid-toolbar-pinning columns-area-max-height=${COLUMNS_AREA_MAX_HEIGHT}></igc-grid-toolbar-pinning>
            <igc-grid-toolbar-exporter .exportCSV=${false} @exportStarted=${this.onExportStarted}>
              <span excelText>Export to Excel</span>
              <span pdfText>Export to PDF</span>
            </igc-grid-toolbar-exporter>
          </igc-grid-toolbar-actions>
        </igc-grid-toolbar>

        <igc-column field="id" header="Id" .sortable=${true} .hidden=${true}></igc-column>
        <igc-column field="category" header="Category" width="fit-content" .sortable=${true}></igc-column>
        <igc-column field="type" header="Type" width="fit-content" .sortable=${true} .filterable=${false}></igc-column>
        <igc-column field="contract" header="Contract" width="fit-content" .sortable=${true} .editable=${true} .inlineEditorTemplate=${this.contractEditor}></igc-column>
        <igc-column field="settlement" header="Settlement" width="fit-content" .sortable=${true}></igc-column>
        <igc-column field="country" header="Country" width="fit-content" .sortable=${true} .editable=${true}></igc-column>
        <igc-column field="region" header="Region" width="fit-content" .sortable=${true} .editable=${true} .inlineEditorTemplate=${this.regionEditor}></igc-column>
        <igc-column field="lastUpdated" header="Last Update" width="fit-content" data-type="date" .editable=${true}></igc-column>
        <igc-column field="openPrice" header="Open Price" width="fit-content" data-type="currency" .pipeArgs=${this.columnFormat} .sortable=${true}></igc-column>
        <igc-column field="price" header="Price" width="fit-content" .cellClasses=${trends} .sortable=${true} .bodyTemplate=${this.priceTemplate}></igc-column>
        <igc-column field="change" header="Change" width="fit-content" .sortable=${true} .cellClasses=${trends}></igc-column>
        <igc-column field="changeP" header="Change %" width="fit-content" data-type="percent" .pipeArgs=${this.columnFormatChangeP} .sortable=${true} .cellClasses=${trends}></igc-column>
        <igc-column field="buy" header="Buy" width="fit-content" data-type="currency" .pipeArgs=${this.columnFormat} .sortable=${true}></igc-column>
        <igc-column field="sell" header="Sell" width="fit-content" data-type="currency" .pipeArgs=${this.columnFormat} .sortable=${true}></igc-column>
        <igc-column field="spread" header="Spread" width="fit-content" .pipeArgs=${this.columnFormat}></igc-column>
        <igc-column field="volume" header="Volume" width="fit-content" .pipeArgs=${this.columnFormat} .sortable=${true}></igc-column>
        <igc-column field="highD" header="High (Day)" width="fit-content" data-type="currency" .pipeArgs=${this.columnFormat} .sortable=${true}></igc-column>
        <igc-column field="lowD" header="Low (Day)" width="fit-content" data-type="currency" .pipeArgs=${this.columnFormat} .sortable=${true}></igc-column>
        <igc-column field="highY" header="High (Year)" width="fit-content" data-type="currency" .pipeArgs=${this.columnFormat} .sortable=${true}></igc-column>
        <igc-column field="lowY" header="Low (Year)" width="fit-content" data-type="currency" .pipeArgs=${this.columnFormat} .sortable=${true}></igc-column>
        <igc-column field="startY" header="Start (Year)" width="fit-content" data-type="currency" .pipeArgs=${this.columnFormat} .sortable=${true}></igc-column>

        <igc-column field="indGroup" header="Industry Group" width="fit-content" .filterable=${false}></igc-column>
        <igc-column field="indSector" header="Industry Sector" width="fit-content" .filterable=${false} .resizable=${true}></igc-column>
        <igc-column field="indSubgroup" header="Industry Subgroup" width="fit-content" .filterable=${false}></igc-column>
        <igc-column field="secType" header="Security Type" width="fit-content" .filterable=${false}></igc-column>
        <igc-column field="issuerName" header="Issuer" width="fit-content" .filterable=${false} .resizable=${true}></igc-column>
        <igc-column field="moodys" header="Moody's" width="fit-content" .filterable=${false}></igc-column>
        <igc-column field="fitch" header="Fitch" width="fit-content" .filterable=${false}></igc-column>
        <igc-column field="dbrs" header="DBRS" width="fit-content" .filterable=${false}></igc-column>
        <igc-column field="collateralType" header="Collateral Type" width="fit-content" .filterable=${false}></igc-column>
        <igc-column field="currency" header="Currency" width="fit-content" .filterable=${false}></igc-column>
        <igc-column field="security" header="Security" width="fit-content" .filterable=${false}></igc-column>
        <igc-column field="sector" header="Sector" width="fit-content" .filterable=${false}></igc-column>
        <igc-column field="cusip" header="CUSIP" width="fit-content" .filterable=${false}></igc-column>
        <igc-column field="ticker" header="Ticker" width="fit-content" .filterable=${false}></igc-column>
        <igc-column field="coupon" header="Coupon" width="fit-content" .filterable=${false}></igc-column>
        <igc-column field="maturity" header="Maturity" width="fit-content" .filterable=${false}></igc-column>
        <igc-column field="krd3Yr" header="KRD 3YR" width="fit-content" .filterable=${false}></igc-column>
        <igc-column field="zSpread" header="Z-Spread" width="fit-content" .filterable=${false}></igc-column>
        <igc-column field="krd5Yr" header="KRD 5YR" width="fit-content" .filterable=${false}></igc-column>
        <igc-column field="krd1Yr" header="KRD 1YR" width="fit-content" .filterable=${false}></igc-column>
      </igc-grid>
    `;
  }

  static styles = unsafeCSS(styles);
}

declare global {
  interface HTMLElementTagNameMap {
    "app-grid-fintech-100k": GridFintech100k;
  }
}

