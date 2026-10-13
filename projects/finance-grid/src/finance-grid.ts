import { LitElement, html, unsafeCSS } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { dataService } from "./services/data.service";
import { TRENDING_DOWN, TRENDING_UP } from "./assets/icons/icons";
import { configureTheme, defineComponents, IgcAvatarComponent, IgcIconComponent, IgcInputComponent, IgcLinearProgressComponent, registerIconFromText } from "igniteui-webcomponents";
import { FilteringLogic, IgcCellTemplateContext, IgcColumnPipeArgs, IgcFilteringExpressionsTree, IgcGridComponent, IgcStringFilteringOperand } from "igniteui-webcomponents-grids/grids";
import "igniteui-webcomponents-grids/grids/combined.js";
import financeStyles from "./finance-grid.scss?inline";

defineComponents(IgcAvatarComponent, IgcIconComponent, IgcLinearProgressComponent, IgcInputComponent);
@customElement("app-finance-grid")
export default class FinanceGrid extends LitElement {
  constructor() {
    super();
    registerIconFromText("trending_up", TRENDING_UP, "material");
    registerIconFromText("trending_down", TRENDING_DOWN, "material");
    dataService.getFinanceData().then((data) => {
      this.financeData = data;
      // this.isLoading = false;
    });
    this._timer = setInterval(() => {
      dataService.updateAllPrices(this.grid.data);
      this.grid.markForCheck();
    }, this.updateTimerInMs);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this._timer);
  }
  @query("igc-grid")
  private grid!: IgcGridComponent;

  @state()
  private financeData = [];

  // @state()
  // private isLoading = true;

  private currencyDigitsFormat: IgcColumnPipeArgs = {
    digitsInfo: '1.2-2'
  };

  private profitConditionHandler = (rowData: any, columnKey: string) => {
    return rowData[columnKey] >= 0;
  };

  private lossConditionHandler = (rowData: any, columnKey: string) => {
    return rowData[columnKey] < 0;
  };

  private profitLossValueClasses = {
    profitCondition: this.profitConditionHandler,
    lossCondition: this.lossConditionHandler,
  };
  private _timer!: ReturnType<typeof setInterval>;
  private readonly updateTimerInMs = 3000;

  private getPathToImage(val: string): string {
    return `${import.meta.env.BASE_URL}companies/${val.split(" ")[0]}.png`;
  }

  private assetTemplate = (ctx: IgcCellTemplateContext) => {
    return html`
      <div class="assets-container">
        <igc-avatar .src=${this.getPathToImage(ctx.cell.value)} shape="rounded"></igc-avatar>
        <span>${ctx.cell.value}</span>
      </div>
    `;
  };

  private renderIcon = (val: number) => {
    return val >= 0 ? html`<igc-icon name="trending_up" collection="material"></igc-icon>` : html`<igc-icon name="trending_down" collection="material"></igc-icon>`;
  };

  private dailyChangePercentageTemplate = (ctx: IgcCellTemplateContext) => {
    const percentageValue = (ctx.cell.value * 100).toFixed(2);
    return html`
      <div class="assets-container">
        <div>${percentageValue}%</div>
        ${this.renderIcon(ctx.cell.value)}
      </div>
    `;
  };

  private profitLossValueTemplate = (ctx: IgcCellTemplateContext) => {
    const formattedValue = `${ctx.cell.value < 0 ? "-" : ""}$${Math.abs(ctx.cell.value).toFixed(2)}`;
    return html`
      <div class="assets-container">
        <div>${formattedValue}</div>
        ${this.renderIcon(ctx.cell.value)}
      </div>
    `;
  };

  private allocationTemplate = (ctx: IgcCellTemplateContext) => {
    const percentageValue = (ctx.cell.value * 100).toFixed(2);

    return html`
      <div class="progress-container">
        <div>${percentageValue}%</div>
        <igc-linear-progress .value="${percentageValue}" animation-duration=${0} hide-label="${true}"></igc-linear-progress>
      </div>
    `;
  };

  private holdingPeriodTemplate = (ctx: IgcCellTemplateContext) => {
    return html` <span>${ctx.cell.value} days</span> `;
  };

  private filter = (e: any) => {
    const value = e.target.value;
    const expressionTree = new IgcFilteringExpressionsTree();
    expressionTree.operator = FilteringLogic.Or;
    const tickerExpression = {
      condition: IgcStringFilteringOperand.instance().condition("contains"),
      fieldName: "id",
      searchVal: value,
      ignoreCase: true,
    };
    const assetExpression = {
      condition: IgcStringFilteringOperand.instance().condition("contains"),
      fieldName: "holdingName",
      searchVal: value,
      ignoreCase: true,
    };
    expressionTree.filteringOperands.push(tickerExpression, assetExpression);
    if (value) {
      this.grid.filteringExpressionsTree = expressionTree;
    } else {
      this.grid.clearFilter();
    }
  };

  render() {
    configureTheme("bootstrap");

    return html`
      <link rel="stylesheet" href="${import.meta.env.BASE_URL}themes/bootstrap.css" />
      <igc-grid .data="${this.financeData}" .isLoading="${!this.financeData.length}" primary-key="id" class="grid-sizing">
        <igc-grid-toolbar>
          <igc-grid-toolbar-title>Financial Portfolio</igc-grid-toolbar-title>
          <igc-input type="search" placeholder="Filter by Asset" @igcInput="${this.filter}"></igc-input>
          <igc-grid-toolbar-actions>
            <igc-grid-toolbar-hiding></igc-grid-toolbar-hiding>
            <igc-grid-toolbar-pinning></igc-grid-toolbar-pinning>
            <igc-grid-toolbar-exporter></igc-grid-toolbar-exporter>
          </igc-grid-toolbar-actions>
        </igc-grid-toolbar>
        <igc-column field="id" header="Symbol" ?sortable="${true}" width="7%" minWidth="68px"></igc-column>
        <igc-column field="holdingName" header="Asset" ?sortable="${true}" width="15%" minWidth="100px" .bodyTemplate="${this.assetTemplate}"></igc-column>
        <igc-column field="positions" header="Position" ?sortable="${true}" data-type="number" width="6%" minWidth="68px"></igc-column>
        <igc-column field="value.boughtPrice" header="Average Cost/Share" data-type="currency" ?sortable="${true}" width="10%" minWidth="80px" .pipeArgs="${this.currencyDigitsFormat}"></igc-column>
        <igc-column field="value.currentPrice" header="Last Price" data-type="currency" ?sortable="${true}" width="7%" minWidth="80px" .pipeArgs="${this.currencyDigitsFormat}"></igc-column>
        <igc-column field="dailyPercentageChange" header="Daily Change %" .cellClasses="${this.profitLossValueClasses}" data-type="percent" .bodyTemplate=${this.dailyChangePercentageTemplate} ?sortable="${true}" width="7%" minWidth="110px"> </igc-column>
        <igc-column field="marketValue" header="Market Value" data-type="currency" ?sortable="${true}" width="8%" minWidth="110px" .pipeArgs="${this.currencyDigitsFormat}"></igc-column>
        <igc-column field="profitLossValue" header="NET Profit/Loss" .bodyTemplate="${this.profitLossValueTemplate}" ?sortable="${true}" data-type="currency" width="10%" .cellClasses="${this.profitLossValueClasses}" minWidth="90px" .pipeArgs="${this.currencyDigitsFormat}"></igc-column>
        <igc-column field="profitLossPercentage" header="NET Profit/Loss %" ?sortable="${true}" data-type="percent" width="10%" .cellClasses="${this.profitLossValueClasses}" .bodyTemplate=${this.dailyChangePercentageTemplate} minWidth="98px"></igc-column>
        <igc-column field="allocation" header="Allocation" ?sortable="${true}" data-type="percent" width="10%" .bodyTemplate="${this.allocationTemplate}" minWidth="80px"></igc-column>
        <igc-column field="holdingPeriod" header="Holding Period" ?sortable="${true}" .bodyTemplate="${this.holdingPeriodTemplate}" minWidth="50px"></igc-column>
      </igc-grid>
    `;
  }

  static styles = unsafeCSS(financeStyles);
}
