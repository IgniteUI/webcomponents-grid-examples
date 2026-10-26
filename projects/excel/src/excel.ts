import { LitElement, html, nothing, unsafeCSS, type PropertyValues } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { IgcExcelModule, Workbook } from "igniteui-webcomponents-excel";
import { IgcSpreadsheetComponent, IgcSpreadsheetModule } from "igniteui-webcomponents-spreadsheet";
import { IgcSpreadsheetChartAdapterModule, SpreadsheetChartAdapter } from "igniteui-webcomponents-spreadsheet-chart-adapter";
import { ExcelUtility } from "./excel-utility.js";
import { destroyRemovedCharts } from "./spreadsheet-charts.js";
import { prepareSpreadsheetShadowRoot } from "./spreadsheet-shadow-root.js";
import styles from "./excel.scss?inline";

IgcExcelModule.register();
IgcSpreadsheetModule.register();
IgcSpreadsheetChartAdapterModule.register();

/** Bundled with the app so the sample works offline. */
const SAMPLE_WORKBOOK_URL = `${import.meta.env.BASE_URL}assets/excel/meridian-north-retail-fy2027-budget.xlsx`;

/**
 * Extra room, in 256ths of a character width, added to a table's header columns after load.
 *
 * The workbook sizes those columns to fit the header text exactly, so the AutoFilter dropdown
 * icon the Spreadsheet draws over the header cell covers part of the label: true to how Excel
 * itself renders an exactly-fit filtered column, just easy to miss there.
 */
const FILTER_ICON_PADDING = 3 * 256;

/** Budget Planning Workbook: a retail budget workbook with formulas, filterable tables and charts. */
@customElement("app-excel")
export default class Excel extends LitElement {
  @query("igc-spreadsheet")
  private spreadsheet!: IgcSpreadsheetComponent;

  @state()
  private statusMessage = "";

  /**
   * Identifies the Spreadsheet that is rendered. A Spreadsheet is destroyed when the element is
   * removed and cannot be used again, so a reconnected element renders, and sets up, a new one.
   */
  @state()
  private spreadsheetKey = 0;

  /** Counts disconnections, so that work started for an earlier connection can tell it is outdated. */
  private disconnections = 0;
  /** Undoes what `setUpSpreadsheet` set up; the last step added runs first. */
  private readonly teardown: Array<() => void> = [];

  connectedCallback() {
    super.connectedCallback();
    if (this.disconnections > 0) {
      this.statusMessage = "";
      this.spreadsheetKey++;
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.disconnections++;
    while (this.teardown.length) {
      this.teardown.pop()?.();
    }
  }

  /** A Spreadsheet starts a timer as soon as it is created, so one is only rendered for a connected element. */
  protected shouldUpdate() {
    return this.isConnected;
  }

  protected updated(changedProperties: PropertyValues) {
    // After the first render, and after each reconnection, the Spreadsheet in the template is a new one.
    if (changedProperties.has("spreadsheetKey")) {
      void this.setUpSpreadsheet();
    }
  }

  render() {
    return html`
      <section class="excel-sample" aria-label="Meridian North Retail Co. \u2014 FY2027 Budget Planning Workbook">
        ${this.statusMessage ? html`<p class="excel-status" role="status">${this.statusMessage}</p>` : nothing}
        <div class="excel-spreadsheet-container">
          ${keyed(this.spreadsheetKey, html`<igc-spreadsheet height="100%" width="100%"></igc-spreadsheet>`)}
        </div>
      </section>
    `;
  }

  private async setUpSpreadsheet() {
    const connection = this.disconnections;
    const isCurrent = () => connection === this.disconnections;

    // The Spreadsheet defines its element on a timer after its module registers, so the element
    // in the template is upgraded (and adds its styles to the document) only once that has run.
    await customElements.whenDefined("igc-spreadsheet");
    if (!isCurrent()) {
      return;
    }

    const root = this.renderRoot as ShadowRoot;
    const spreadsheet = this.spreadsheet;
    this.teardown.push(
      () => {
        // The Spreadsheet polls its size on a timer until it is destroyed; removing it does not
        // stop that. A destroyed Spreadsheet keeps its DOM and its listeners, which throw on every
        // click and resize, so it is also taken out of the shadow root, where its DOM would
        // otherwise stay in memory for as long as anything refers to this element.
        spreadsheet.destroy();
        spreadsheet.remove();
      },
      prepareSpreadsheetShadowRoot(root),
      destroyRemovedCharts(root)
    );
    // The Spreadsheet laid itself out before it could see its styles in this shadow root.
    spreadsheet.styleUpdated();
    spreadsheet.chartAdapter = new SpreadsheetChartAdapter();

    ExcelUtility.loadFromUrl(SAMPLE_WORKBOOK_URL).then(
      (workbook) => {
        if (isCurrent()) {
          this.setWorkbook(workbook);
        }
      },
      (error: unknown) => {
        console.error("Could not load the sample workbook.", error);
        if (isCurrent()) {
          this.statusMessage = "Could not load the sample workbook.";
        }
      }
    );
  }

  /**
   * The spreadsheet sizes its cell area from the container's measured pixels at load time and
   * does not re-measure on its own: `containerResized()` is its documented hook for "the size
   * changed, look again", which is exactly what setting a freshly loaded workbook amounts to here.
   */
  private setWorkbook(workbook: Workbook) {
    this.widenFilterableColumns(workbook);

    this.spreadsheet.workbook = workbook;
    this.spreadsheet.containerResized();
  }

  private widenFilterableColumns(workbook: Workbook) {
    for (const worksheet of workbook.worksheets()) {
      for (const table of worksheet.tables()) {
        const header = table.headerRowRegion;
        for (let col = header.firstColumn; col <= header.lastColumn; col++) {
          const column = worksheet.columns(col);
          column.autoFitWidth();
          column.width = column.width + FILTER_ICON_PADDING;
        }
      }
    }
  }

  static styles = unsafeCSS(styles);
}

declare global {
  interface HTMLElementTagNameMap {
    "app-excel": Excel;
  }
}
