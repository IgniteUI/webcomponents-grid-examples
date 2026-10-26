import { LitElement, html, unsafeCSS } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { defineComponents, IgcChipComponent, IgcIconButtonComponent, IgcRippleComponent, registerIconFromText } from "igniteui-webcomponents";
import { EXIT_FULL_SCREEN, FILE_DOWNLOAD, FULL_SCREEN, VIEW_MORE } from "../../assets/icons";
import styles from "./home-view.scss?inline";

import "../finance/finance-view";
import "../hr-portal/hr-portal-view";
import "../erp-hgrid/erp-hgrid-view";
import "../fleet-management/fleet-management-view";
import "../sales/sales-view";
import "../finance-grid-new/finance-grid-new-view";
import "../grid-fintech-100k/grid-fintech-100k-view";
import "../sales-dashboard/sales-dashboard-view";
import "../fleet-management-new/fleet-management-new-view";
import "../grid-fintech-dock-manager/grid-fintech-dock-manager-view";
import "../excel/excel-view";

import "../charts/bar-chart/bar-chart-view";
import "../charts/column-chart/column-chart-view";
import "../charts/line-chart/line-chart-view";
import "../charts/pie-chart/pie-chart-view";
import "../charts/polar-chart/polar-chart-view";
import "../charts/step-chart/step-chart-view";

import { classMap } from "lit/directives/class-map.js";

defineComponents(IgcIconButtonComponent, IgcChipComponent, IgcRippleComponent);

interface TabInfo {
  title: string;
  content: string;
  theme: string;
  themeMode: string;
  moreLink: string;
  downloadLink: string;
}

@customElement("home-view")
export default class HomeView extends LitElement {
  @query('#fullscreenElement') fullscreenElement!: HTMLElement;
  @property({ type: Boolean }) isFullscreen = false;
  @property({ type: Boolean }) isChartsSection = false;
  @property({ type: Array }) tabsGrids = [
    { key: 'inventory' },
    { key: 'hr-portal' },
    { key: 'finance' },
    { key: 'finance-grid-new' },
    { key: 'grid-fintech-100k' },
    { key: 'sales' },
    { key: 'sales-dashboard' },
    { key: 'fleet' },
    { key: 'fleet-management-new' },
    { key: 'grid-fintech-dock-manager' },
    { key: 'excel' },
  ];
  @property({ type: Array }) tabsCharts = [
    { key: 'column-chart' },
    { key: 'bar-chart' },
    { key: 'line-chart' },
    { key: 'pie-chart' },
    { key: 'step-chart' },
    { key: 'polar-chart' }
  ];
  @state() private routeName: string = "inventory";

  public tabInfoGrids = new Map<string, TabInfo>([
    [
      "inventory",
      {
        title: "ERP/ Inventory",
        theme: "Material",
        themeMode: 'Light',
        content: "Tracking and managing quantity, location and details of products in stock.",
        moreLink: "https://www.infragistics.com/products/ignite-ui-web-components/web-components/components/grids/hierarchical-grid/overview",
        downloadLink: "https://www.infragistics.com/resources/sample-applications/erp-inventory-sample-app-web-components",
      },
    ],
    [
      "hr-portal",
      {
        title: "Org Chart/HR Portal",
        theme: "Fluent",
        themeMode: 'Light',
        content: "Displaying company's hierarchical structure and showing employees data.",
        moreLink: "https://www.infragistics.com/products/ignite-ui-web-components/web-components/components/grids/tree-grid/overview",
        downloadLink: "https://www.infragistics.com/resources/sample-applications/org-charthr-portal-sample-app-web-components",
      },
    ],
    [
      "finance",
      {
        title: "Financial Portfolio",
        theme: "Bootstrap",
        themeMode: 'Light',
        content: "Asset tracking, profit and loss analysis, featuring interactive dynamic charts.",
        moreLink: "https://www.infragistics.com/products/ignite-ui-web-components/web-components/components/grids/data-grid",
        downloadLink: "https://www.infragistics.com/resources/sample-applications/financial-portfolio-sample-app-web-components",
      },
    ],
    [
      "finance-grid-new",
      {
        title: "New Financial Portfolio",
        theme: "Fluent",
        themeMode: 'Light',
        content: "Asset tracking, profit and loss analysis, featuring interactive dynamic charts.",
        moreLink: "https://www.infragistics.com/products/ignite-ui-web-components/web-components/components/grids/data-grid",
        downloadLink: "https://www.infragistics.com/resources/sample-applications",
      },
    ],
    [
      "grid-fintech-100k",
      {
        title: "FinTech 100K",
        theme: "Fluent",
        themeMode: 'Light',
        content: "A 100,000-row, 41-column instrument grid with Excel-style filtering, editing, sizing and export.",
        moreLink: "https://www.infragistics.com/products/ignite-ui-web-components/web-components/components/grids/data-grid",
        downloadLink: "https://www.infragistics.com/resources/sample-applications",
      },
    ],
    [
      "sales",
      {
        title: "Sales Dashboard",
        theme: "Indigo",
        themeMode: 'Light',
        content: "For trend analysis, KPIs and viewing sales summaries by region, product, etc.",
        moreLink: "https://www.infragistics.com/products/ignite-ui-web-components/web-components/components/grids/pivot-grid/overview",
        downloadLink: "https://www.infragistics.com/resources/sample-applications/sales-grid-sample-app-web-components",
      },
    ],
    [
      "sales-dashboard",
      {
        title: "Sales KPI Dashboard",
        theme: "Fluent",
        themeMode: 'Light',
        content: "KPI cards, revenue and deals charts, revenue by region, recent activity and a leaderboard.",
        moreLink: "https://www.infragistics.com/products/ignite-ui-web-components/web-components/components/grids/data-grid",
        downloadLink: "https://www.infragistics.com/resources/sample-applications",
      },
    ],
    [
      "fleet",
      {
        title: "Fleet Management",
        theme: "Material",
        themeMode: 'Dark',
        content: "A master-detail grid for managing vehicle acquisition, operations, and maintenance.",
        moreLink: "https://www.infragistics.com/products/ignite-ui-web-components/web-components/components/grids/grid/master-detail",
        downloadLink: "https://www.infragistics.com/resources/sample-applications/fleet-management-sample-app-web-components",
      },
    ],
    [
      "fleet-management-new",
      {
        title: "New Fleet Management",
        theme: "Fluent",
        themeMode: 'Dark',
        content: "A master-detail grid for managing vehicle acquisition, operations, and maintenance.",
        moreLink: "https://www.infragistics.com/products/ignite-ui-web-components/web-components/components/grids/grid/master-detail",
        downloadLink: "https://www.infragistics.com/resources/sample-applications",
      },
    ],
    [
      "grid-fintech-dock-manager",
      {
        title: "FinTech Dock Manager",
        theme: "Fluent",
        themeMode: 'Dark',
        content: "A trading desk in a Dock Manager: watchlist, positions and order grids, financial charts and a live market feed.",
        moreLink: "https://www.infragistics.com/products/ignite-ui-web-components/web-components/components/layouts/dock-manager",
        downloadLink: "https://www.infragistics.com/resources/sample-applications",
      },
    ],
    [
      "excel",
      {
        title: "Budget Planning Workbook",
        theme: "Fluent",
        themeMode: 'Light',
        content: "A retail budget planning workbook in the Spreadsheet, with formulas, filterable tables and charts.",
        moreLink: "https://www.infragistics.com/products/ignite-ui-web-components/web-components/components/spreadsheet-overview",
        downloadLink: "https://www.infragistics.com/resources/sample-applications",
      },
    ],
  ]);

  public tabInfoCharts = new Map<string, TabInfo>([
    ['charts/column-chart', {
      title: "Column Chart",
      theme: "Material",
      themeMode: 'Light',
      content: "Render a collection of data points connected by a straight line to emphasize the amount of change over a period of time",
      moreLink: "https://www.infragistics.com/products/ignite-ui-web-components/web-components/components/charts/types/column-chart",
      downloadLink: "https://www.infragistics.com/resources/sample-applications/column-chart-sample-app-web-components"
    }],
    ['charts/bar-chart', {
      title: "Bar Chart",
      theme: "Material",
      themeMode: 'Light',
      content: "Quickly compare frequency, count, total, or average of data in different categories",
      moreLink: "https://www.infragistics.com/products/ignite-ui-web-components/web-components/components/charts/types/bar-chart",
      downloadLink: "https://www.infragistics.com/resources/sample-applications/bar-chart-sample-app-web-components"
    }],
    ['charts/line-chart', {
      title: "Line Chart",
      theme: "Material",
      themeMode: 'Light',
      content: "Show trends and perform comparative analysis of one or more quantities over a period of time",
      moreLink: "https://www.infragistics.com/products/ignite-ui-web-components/web-components/components/charts/types/line-chart",
      downloadLink: "https://www.infragistics.com/resources/sample-applications/line-chart-sample-app-web-components"
    }],
    ['charts/pie-chart', {
      title: "Pie Chart",
      theme: "Material",
      themeMode: 'Light',
      content: "Part-to-whole chart that shows how categories (parts) of a data set add up to a total (whole) value.",
      moreLink: "https://www.infragistics.com/products/ignite-ui-web-components/web-components/components/charts/types/pie-chart",
      downloadLink: "https://www.infragistics.com/resources/sample-applications/pie-chart-sample-app-web-components"
    }],
    ['charts/step-chart', {
      title: "Step Chart",
      theme: "Material",
      themeMode: 'Light',
      content: "Emphasizes the amount of change over a period of time or compares multiple items at once.",
      moreLink: "https://www.infragistics.com/products/ignite-ui-web-components/web-components/components/charts/types/step-chart",
      downloadLink: "https://www.infragistics.com/resources/sample-applications/step-chart-sample-app-web-components"
    }],
    ['charts/polar-chart', {
      title: "Polar Chart",
      theme: "Material",
      themeMode: 'Light',
      content: "Emphasizes the amount of change over a period of time or compares multiple items at once.",
      moreLink: "https://www.infragistics.com/products/ignite-ui-web-components/web-components/components/charts/types/polar-chart",
      downloadLink: "https://www.infragistics.com/resources/sample-applications/polar-chart-sample-app-web-components"
    }],
  ]);

  public tabInfo = this.tabInfoGrids;
  public activeTabs = this.tabsGrids;

  constructor() {
    super();
    registerIconFromText("file_download", FILE_DOWNLOAD, "indigo_internal");
    registerIconFromText("view_more", VIEW_MORE, "indigo_internal");
    registerIconFromText("full_screen", FULL_SCREEN, "indigo_internal");
    registerIconFromText("exit_full_screen", EXIT_FULL_SCREEN, "indigo_internal");
  }

  connectedCallback(): void {
    super.connectedCallback();

    if (typeof window !== 'undefined') {
      window.addEventListener('vaadin-router-location-changed', this.updateCurrentPath);
      window.addEventListener('resize', this.onResize);

      // Initial setting of the correct route
      this.updateTabsBasedOnRoute(window.location.pathname);
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('fullscreenchange', this.onFullscreenChange);
      document.addEventListener('webkitfullscreenchange', this.onFullscreenChange);
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();

    if (typeof window !== 'undefined') {
      window.removeEventListener('vaadin-router-location-changed', this.updateCurrentPath);
      window.removeEventListener('resize', this.onResize);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('fullscreenchange', this.onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', this.onFullscreenChange);
    }
  }

  private extractRouteKey(path: string) {
    // Get the part after '/home/', (for example 'charts/column-chart')
    return path.split('/home/')[1] || '';
  }

  private updateCurrentPath = (_event: any) => {
    this.updateTabsBasedOnRoute(window.location.pathname);
  };

  private onDownloadClick = (event: MouseEvent, tabName: string) => {
    event.preventDefault();
    event.stopPropagation();
    const downloadLink = this.tabInfo.get(tabName)?.downloadLink;
    if (downloadLink) window.open(downloadLink, "_blank")?.focus();
  };

  private onViewMoreClick = (event: MouseEvent, tabName: string) => {
    event.preventDefault();
    event.stopPropagation();
    const viewMoreLink = this.tabInfo.get(tabName)?.moreLink;
    if (viewMoreLink) window.open(viewMoreLink, "_blank")?.focus();
  };

  private async onToggleFullscreen() {
    const el = this.fullscreenElement || this.shadowRoot?.host;

    if (!document.fullscreenElement) {
      await el?.requestFullscreen?.();
    } else {
      await document.exitFullscreen?.();
    }
  }

  private onResize = () => {
    const isFs = !!document.fullscreenElement ||
                 (window.innerHeight === screen.height && window.innerWidth === screen.width);
    if (this.isFullscreen !== isFs) {
      this.isFullscreen = isFs;
      this.requestUpdate();
    }
  };

  private onFullscreenChange = () => {
    this.isFullscreen = !!document.fullscreenElement ||
                        (window.innerHeight === screen.height && window.innerWidth === screen.width);
    this.requestUpdate();
  };

  private updateTabsBasedOnRoute(url: string) {
    const routeKey = this.extractRouteKey(url);
    this.routeName = routeKey;

    if (url.includes('charts')) {
      this.tabInfo = this.tabInfoCharts;
      this.activeTabs = this.tabsCharts;
      this.isChartsSection = true;
    } else {
      this.tabInfo = this.tabInfoGrids;
      this.activeTabs = this.tabsGrids;
      this.isChartsSection = false;
    }
  }

  private tabItemTemplate(tabName: string) {
    const currentTabName = this.isChartsSection ? this.routeName.replace(/^charts\//, '') : this.routeName;
    const isSelected = currentTabName === tabName;
    const fullTabKey = this.isChartsSection ? `charts/${tabName}` : tabName;
    const info = this.tabInfo.get(fullTabKey);

    return html`
      <div class="tab-item ${classMap({ "tab-item--selected": isSelected })}">
        <div class="tab-header">
          ${info?.title?.toUpperCase() ?? tabName}
        </div>
      </div>
    `;
  }

  private tabInfoTemplate(tabName: string, info: TabInfo | undefined) {
    return html`
      <div class="current-tab-info">
        <div class="sample-info">
          <div class="tab-header">${info?.title}</div>
          <div class="tab-description">${info?.content}</div>
        </div>

        <div class="sample-actions">
          <div class="theme-info">Theme: ${info?.theme}</div>
          <div class="theme-info">Mode: ${info?.themeMode}</div>

          <div class="action-buttons">
          <igc-button
          variant="outlined"
          class="custom-button"
          @click="${(e: MouseEvent) => this.onDownloadClick(e, tabName)}"
        >
              <igc-icon name="file_download" collection="indigo_internal"></igc-icon>
              Download
            </igc-button>
            
            <igc-button
            variant="outlined"
            class="custom-button"
            @click="${(e: MouseEvent) => this.onViewMoreClick(e, tabName)}"
          >
              <igc-icon name="view_more" collection="indigo_internal"></igc-icon>
              View More
            </igc-button>

            <igc-button
              variant="outlined"
              class="custom-button"
              @click="${this.onToggleFullscreen}"
            >
              <igc-icon
                name="${this.isFullscreen ? 'exit_full_screen' : 'full_screen'}"
                collection="indigo_internal"
              ></igc-icon>
              ${this.isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            </igc-button>
          </div>
        </div>
      </div>
    `;
  };

  render() {
    return html`
      <div class="demo-container" id="fullscreenElement">
        <div class="tabs-info-wrapper-element">
          ${!this.isFullscreen ? html`
            <div class="tab-container">
              ${this.activeTabs.map(tab => html`
                <div class="tab-item-container">
                  <a href="${import.meta.env.BASE_URL}home/${this.isChartsSection ? 'charts/' : ''}${tab.key}">
                    ${this.tabItemTemplate(tab.key)}
                  </a>
                </div>
              `)}
            </div>
          ` : ''}
          <div>
            ${this.tabInfoTemplate(this.routeName, this.tabInfo?.get(this.routeName))}
          </div>
        </div>
        <div class="router-container">
          <slot></slot>
        </div>
      </div>
    `;
  }

  static styles = unsafeCSS(styles);
}
