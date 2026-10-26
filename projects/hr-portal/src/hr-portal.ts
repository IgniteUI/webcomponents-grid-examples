import { LitElement, html, unsafeCSS } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import "igniteui-webcomponents-grids/grids/combined.js";
import { configureTheme, defineComponents, IgcAvatarComponent, IgcButtonComponent, IgcIconButtonComponent, IgcIconComponent, registerIcon } from "igniteui-webcomponents";
import { IgcTreeGridComponent, IgcCellTemplateContext } from "igniteui-webcomponents-grids/grids";
import { icons } from "./assets/icons/Icons";
import { DataService } from "./services/data.service";
import { prepareGridShadowRoot } from "./grid-shadow-root";
import styles from "./hr-portal.scss?inline";

defineComponents(IgcAvatarComponent, IgcIconComponent, IgcTreeGridComponent, IgcIconButtonComponent, IgcButtonComponent);

@customElement("app-hr-portal")
export default class HrPortal extends LitElement {
  @property({ type: Array })
  data: Array<any> = [];

  @property({ type: Boolean })
  isSorted: boolean = false;

  private dataService: DataService;

  constructor() {
    super();
    this.data = [];
    this.dataService = new DataService();
    icons.forEach((icon: { name: string; path: string; category: string }) => {
      registerIcon(icon.name, icon.path, icon.category);
    });
  }

  connectedCallback() {
    super.connectedCallback();
    this.dataService.fetchData().then((data) => {
      this.data = data;
    });
  }

  firstUpdated() {
    prepareGridShadowRoot(this.renderRoot as ShadowRoot);
  }

  @query("igc-tree-grid")
  private treeGrid!: IgcTreeGridComponent;

  clearSorting() {
    if (this.treeGrid) {
      this.treeGrid.sortingExpressions = [];
    }
    this.isSorted = false;
  }

  handleSortingChanged() {
    if (this.treeGrid) {
      this.isSorted = this.treeGrid.sortingExpressions.length > 0;
    }
  }

  public avatarTemplate = (ctx: IgcCellTemplateContext) => {
    let row = ctx.cell.row;
    return html`
      <div class="employeeDiv">
        <igc-avatar shape="rounded" .src="${row.data.Picture}"></igc-avatar>
        <span>${row.data.Name}</span>
      </div>
    `;
  };

  public countryIconTemplate = (ctx: IgcCellTemplateContext) => {
    let row = ctx.cell.row;
    return html` <div class="flagDiv">
      <igc-icon collection="country-icons" name="${row.data.Country}"></igc-icon>
      <span>${row.data.Location}, ${row.data.Country}</span>
    </div>`;
  };

  public contactsTemplate = (ctx: IgcCellTemplateContext) => {
    let row = ctx.cell.row;
    return html`
      <div class="center-content small">
        <a href="mailto:${row.data.Email}">
          <igc-icon-button collection="hr-icons" name="mail" variant="flat"></igc-icon-button>
        </a>
        <a href="tel:${row.data.Phone}">
          <igc-icon-button collection="hr-icons" name="tel" variant="flat"></igc-icon-button>
        </a>
        <a href="https://www.linkedin.com" target="_blank">
          <igc-icon-button collection="hr-icons" name="linkedIn" variant="flat"></igc-icon-button>
        </a>
      </div>
    `;
  };

  public dateTemplate = (ctx: IgcCellTemplateContext) => {
    let row = ctx.cell.row;
    const date = new Date(row.data.HireDate);
    const formattedDate = date.toISOString().split("T")[0];
    return html` ${formattedDate} `;
  };

  render() {
    configureTheme("fluent");

    return html`
      <link rel="stylesheet" href="${import.meta.env.BASE_URL}themes/fluent.css" />
      <div class="ig-typography rootDiv">
        <igc-tree-grid
          id="treeGrid"
          .data="${this.data}"
          .isLoading="${!this.data.length}"
          primary-key="ID"
          child-data-key="Employees"
          row-selection="multipleCascade"
          allow-filtering="true"
          filter-mode="excelStyleFilter"
          class="gridStyle"
          @sortingExpressionsChange="${this.handleSortingChanged}"
        >
          <igc-paginator per-page="20"></igc-paginator>

          <igc-grid-toolbar>
            <igc-grid-toolbar-title>HR Portal</igc-grid-toolbar-title>
            <igc-grid-toolbar-actions>
            ${
              this.isSorted
                ? html`
                    <div class="icon-button-group">
                      <igc-button variant="flat" @click="${this.clearSorting}">
                        <igc-icon name="close" collection="hr-icons" class="medium"></igc-icon>
                        Clear Sort</igc-button
                      >
                    </div>
                  `
                : ""
            }
              <igc-grid-toolbar-hiding></igc-grid-toolbar-hiding>
              <igc-grid-toolbar-pinning></igc-grid-toolbar-pinning>
              <igc-grid-toolbar-exporter>
                <span slot="excelText">Export</span>
              </igc-grid-toolbar-exporter>
              <igc-grid-toolbar-advanced-filtering></igc-grid-toolbar-advanced-filtering>
            </igc-grid-toolbar-actions>
          </igc-grid-toolbar>

          <igc-column field="Name" width="300px" ?sortable="true" pinned="true" .bodyTemplate="${this.avatarTemplate}"></igc-column>
          <igc-column field="JobTitle" header="Job Title" data-type="string" min-width="200px" sortable="true"></igc-column>
          <igc-column field="Department" data-type="string" min-width="200px" sortable="true"></igc-column>

          <igc-column field="Location" data-type="string" ?sortable="true" .bodyTemplate="${this.countryIconTemplate}"></igc-column>
          <igc-column field="Contacts" data-type="string" min-width="200px" filterable="false" .bodyTemplate="${this.contactsTemplate}"></igc-column> 

          <igc-column field="HireDate" header="Hire Date" data-type="date" min-width="100px" sortable="true" .bodyTemplate="${this.dateTemplate}"></igc-column>

          <igc-column field="GrossSalary" header="Gross Salary" data-type="currency" min-width="100px" sortable="true"></igc-column></igc-column>
        </igc-tree-grid>
      </div>
    `;
  }

  static styles = unsafeCSS(styles);
}
