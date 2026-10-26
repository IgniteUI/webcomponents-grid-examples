import { LitElement, PropertyValues, html, unsafeCSS } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { SalesDataService } from "./services/data.service";
import {
    configureTheme,
    defineComponents,
    registerIcon,
    IgcButtonComponent,
    IgcDropdownComponent,
    IgcDropdownItemComponent,
    IgcIconComponent
} from "igniteui-webcomponents";
import {
    IgcPivotGridComponent,
    IgcFilteringExpressionsTree,
    IgcStringFilteringOperand,
    FilteringLogic,
    IgcPivotValue,
    IgcPivotConfiguration,
    IgcPivotDateDimension,
    IgcColumnComponent,
} from "igniteui-webcomponents-grids/grids";

import 'igniteui-webcomponents-grids/grids/combined.js';
import { prepareGridShadowRoot } from './grid-shadow-root';
import salesGridStyles from './sales-grid.scss?inline';

import ARROW_DOWN_SVG from "./assets/images/icons/arrow_drop_down.svg";
import ARROW_UP_SVG from "./assets/images/icons/arrow_drop_up.svg";
import VISIBILITY_SVG from "./assets/images/icons/visibility.svg";
import FILE_DOWNLOAD_SVG from "./assets/images/icons/file_download.svg";
import FLAGS from "./assets/data/flags.json";

defineComponents(IgcButtonComponent, IgcIconComponent, IgcDropdownComponent);

enum PivotViews {
    BrandsSeparate = 'brandsOr',
    BrandsCombined = 'jeansAnd',
    Stores = 'stores'
}

export class IgcSaleProfitAggregate {
    public static totalProfit = (_: any, data: any[] | undefined) =>
        data?.reduce((accumulator, value) => accumulator + (value.Sale - value.Cost), 0) || 0;

    public static averageProfit = (_: any, data: any[] | undefined) => {
        let average = 0;
        if (data?.length === 1) {
            average = data[0].Sale - data[0].Cost;
        } else if (data && data.length > 1) {
            const mappedData = data.map(x => x.Sale - x.Cost);
            average = mappedData.reduce((a, b) => a + b) / mappedData.length;
        }
        return average;
    }

    public static minProfit = (_: any, data: any[] | undefined) => {
        let min = 0;
        if (data?.length === 1) {
            min = data[0].Sale - data[0].Cost;
        } else if (data && data.length > 1) {
            const mappedData = data.map(x => x.Sale - x.Cost);
            min = mappedData.reduce((a, b) => Math.min(a, b));
        }
        return min;
    };

    public static maxProfit = (_: any, data: any[] | undefined) => {
        let max = 0;
        if (data?.length === 1) {
            max = data[0].Sale - data[0].Cost;
        } else if (data && data.length > 1) {
            const mappedData = data.map(x => x.Sale - x.Cost);
            max = mappedData.reduce((a, b) => Math.max(a, b));
        }
        return max;
    };
}

@customElement("app-sales-grid")
export class SalesGrid extends LitElement {
    @query('#viewDropdown')
    private viewDropdown!: IgcDropdownComponent;

    @query('#salesGrid')
    private pivotGrid!: IgcPivotGridComponent;

    @state()
    public salesData = [];

    @state()
    public viewDropdownOpen = false;

    public flagsData = FLAGS;
    public brandFilter: IgcFilteringExpressionsTree = {
        operator: FilteringLogic.Or,
        fieldName: 'Brand',
        filteringOperands: [
            {
                operator: FilteringLogic.Or,
                fieldName: 'Brand',
                filteringOperands: [
                    {
                        condition: IgcStringFilteringOperand.instance().condition('equals'),
                        fieldName: 'Brand',
                        searchVal: 'HM'
                    },
                    {
                        condition: IgcStringFilteringOperand.instance().condition('equals'),
                        fieldName: 'Brand',
                        searchVal: 'HM Home'
                    }
                ]
            } 
        ]
    };
    public bulgariaCountryFilter: IgcFilteringExpressionsTree = {
        operator: FilteringLogic.And,
        filteringOperands: [
            {
                condition: IgcStringFilteringOperand.instance().condition('equals'),
                fieldName: 'Country',
                searchVal: 'Bulgaria'
            },
        ]
    };
    // public excelExporter = new IgcExcelExporterService();
    // public csvExporter = new IgcCsvExporterService();

    public fileName = 'SalesGridApp';
    public saleValue: IgcPivotValue = {
        enabled: true,
        member: 'Sale',
        displayName: 'Sales',
        aggregate: {
            key: 'SUM',
            aggregatorName: 'SUM',
            label: 'Sum'
        },
        aggregateList: [
            {
                key: 'AVG',
                aggregatorName: 'AVG',
                label: 'Average'
            },
            {
                key: 'COUNT',
                aggregatorName: 'COUNT',
                label: 'Count'
            },
            {
                key: 'MAX',
                aggregatorName: 'MAX',
                label: 'Maximum'
            },
            {
                key: 'MIN',
                aggregatorName: 'MIN',
                label: 'Minimum'
            },
            {
                key: 'SUM',
                aggregatorName: 'SUM',
                label: 'Sum'
            },
        ],
        formatter: (value: any, _: any, __: any) => {
            return this.currencyFormatter(value, 'Sale');
        }
    };
    public profitValue: IgcPivotValue = {
        enabled: true,
        member: 'Cost',
        displayName: 'Profit',
        aggregate: {
            key: 'SUM',
            aggregator: IgcSaleProfitAggregate.totalProfit,
            label: 'Sum'
        },
        aggregateList: [
            {
                key: 'AVG',
                aggregator: IgcSaleProfitAggregate.averageProfit,
                label: 'Average'
            },
            {
                key: 'COUNT',
                aggregatorName: 'COUNT',
                label: 'Count'
            },
            {
                key: 'MAX',
                aggregator: IgcSaleProfitAggregate.maxProfit,
                label: 'Maximum'
            },
            {
                key: 'MIN',
                aggregator: IgcSaleProfitAggregate.minProfit,
                label: 'Minimum'
            },
            {
                key: 'SUM',
                aggregator: IgcSaleProfitAggregate.totalProfit,
                label: 'Sum'
            },
        ],
        formatter: (value: any, _: any, __: any) => {
            return this.currencyFormatter(value, 'Cost');
        }
    };
    public pivotConfigBrands: IgcPivotConfiguration = {
        columns: [
            {
                enabled: true,
                memberName: 'Country',
                displayName: 'Country'
            },
            {
                enabled: true,
                memberName: 'Brand',
                displayName: 'Brand'
            },
            {
                enabled: false,
                memberName: 'Store',
                displayName: 'Store'
            },
        ],
        rows: [
            new IgcPivotDateDimension({
                memberName: 'Date',
                displayName: 'All Periods',
                enabled: true,
                // Show the leaf dates as the data has them (M/D/YYYY), not in the grid's short date style
                headerFormatter: (value: unknown) => value
            },
                {
                    fullDate: true,
                    quarters: true,
                    months: false,
                })
        ],
        values: [
            this.saleValue,
            this.profitValue
        ],
        filters: [
            {
                enabled: true,
                memberName: 'Brand',
                displayName: 'Brand',
                filter: this.brandFilter
            },
        ]
    };
    public pivotConfigBrandsCombined: IgcPivotConfiguration = {
        columns: [
            {
                enabled: true,
                memberName: 'Country',
                displayName: 'Country'
            },
            {
                enabled: false,
                memberName: 'Store',
                displayName: 'Store'
            },
        ],
        rows: [
            new IgcPivotDateDimension({
                memberName: 'Date',
                displayName: 'All Periods',
                enabled: true,
                // Show the leaf dates as the data has them (M/D/YYYY), not in the grid's short date style
                headerFormatter: (value: unknown) => value
            },
                {
                    fullDate: true,
                    quarters: true,
                    months: false,
                })
        ],
        values: [
            this.saleValue,
            this.profitValue
        ],
        filters: [
            {
                enabled: true,
                memberName: 'Brand',
                displayName: 'Brand',
                filter: this.brandFilter
            },
        ]
    };
    public pivotConfigStores: IgcPivotConfiguration = {
        columns: [
            new IgcPivotDateDimension({
                memberName: 'Date',
                displayName: 'All Periods',
                enabled: true
            },
                {
                    months: false,
                    fullDate: false,
                    quarters: true
                })
        ],
        rows: [
            {
                memberName: 'Store',
                displayName: 'Store',
                enabled: true,
                width: "140px"
            },
            {
                memberName: 'Brand',
                displayName: 'Brand',
                enabled: true,
                width: "140px"
            }
        ],
        values: [
            this.saleValue,
            this.profitValue
        ],
        filters: [
            {
                memberName: "Country",
                displayName: 'Country',
                filter: this.bulgariaCountryFilter,
                enabled: true
            }
        ]
    };

    public PivotViews = PivotViews;
    public selectedConfig = PivotViews.BrandsSeparate;
    public availableConfigs = new Map<PivotViews, { title: string, config: IgcPivotConfiguration }>([
        [PivotViews.BrandsSeparate, { title: 'Brands: HM and HM Home', config: this.pivotConfigBrands }],
        [PivotViews.BrandsCombined, { title: 'Brands: HM + HM Home', config: this.pivotConfigBrandsCombined }],
        [PivotViews.Stores, { title: 'Stores: Bulgaria', config: this.pivotConfigStores }]
    ]);

    constructor() {
        super();

        // Fetch data
        SalesDataService.getSalesData().then(data => this.salesData = data);

        registerIcon("arrow_down", ARROW_DOWN_SVG, "material");
        registerIcon("arrow_up", ARROW_UP_SVG, "material");
        registerIcon("visibility", VISIBILITY_SVG, "material");
        registerIcon("file_download", FILE_DOWNLOAD_SVG, "custom");
    }

    protected firstUpdated(_changedProperties: PropertyValues): void {
        prepareGridShadowRoot(this.renderRoot as ShadowRoot);

        // Workaround for not setting pivot data selector grid ref once available.
        this.requestUpdate();
    }

    public onViewDropdownButton(event: MouseEvent) {
        this.viewDropdown.toggle(event.currentTarget as HTMLElement);
        this.viewDropdownOpen = !this.viewDropdownOpen;
    }

    public onExportDropdownButton() {
        // TO DO
        // To uncomment once Excel and CSV exporter are available in WC
        // let options!: IgcExporterOptionsBase;
        // const newId = event.detail.id;
        // if (newId === 'csv') {
        //     options = new IgcCsvExporterOptions(this.fileName, CsvFileTypes.CSV);
        //     this.csvExporter.export(this.pivotGrid, options);
        // } else if (newId === 'excel') {
        //     options = new IgcExcelExporterOptions(this.fileName);
        //     this.excelExporter.export(this.pivotGrid, options);
        // }
    }

    public onViewDropdownVisibility(_: CustomEvent<void>) {
        this.viewDropdownOpen = !this.viewDropdownOpen;
    }

    public onViewSelection(event: CustomEvent<IgcDropdownItemComponent>) {
        this.selectedConfig = <PivotViews>event.detail.id;
    }

    public onColumnInit(event: CustomEvent<IgcColumnComponent>) {
        const col = event.detail;
        var countryKeys = Object.keys(this.flagsData);
        if (countryKeys.includes(col.field)) {
            // TO DO
            // col.headerTemplate = (_: IgcColumnTemplateContext) => html`
            //     <div class="countryHeader">
            //         <img class="countryImage" src="${(<any>this.flagsData)[col.field]}" /><span>${col.field}</span>
            //     </div>
            // `;
        }
    }

    public currencyFormatter(value: any, field: string) {
        if (value === undefined || value === null){
            return "";
        }
        const valueConfig = this.pivotGrid.pivotConfiguration.values.find(value => value.member === field);
        if (!valueConfig || valueConfig.aggregate.key === "COUNT") {
            return value;
        }
        const roundedValue = (Math.round(value * 100) / 100).toString();
        const numLength = roundedValue.split('').length;
        const separatedValue = roundedValue.split('').reverse()
            .reduce((prev, curr, index) => prev + curr + ((index + 1) % 3 === 0 && index < numLength - 1 ?  ",": ""))
            .split('').reverse().join("");
        return "$" + separatedValue;
    }

    render() {
        configureTheme("indigo");

        return html`
            <link rel="stylesheet" href="${import.meta.env.BASE_URL}themes/indigo.css" />
            <div class="ig-typography rootSample">
                <div class="pivotToolbar igx-grid__tr-pivot">
                    <span class="igx-grid-toolbar__title">Sales Dashboard</span>
                    <div>
                        <igc-button variant="contained" style="margin-right: 10px;" @click="${this.onViewDropdownButton}">
                            <igc-icon name="visibility" collection="material"></igc-icon>
                            ${this.availableConfigs.get(this.selectedConfig)?.title}
                            <igc-icon .name="${this.viewDropdownOpen ? "arrow_up" : "arrow_down" }" collection="material"></igc-icon>
                        </igc-button>
                        <igc-button variant="outlined" @click="${this.onExportDropdownButton}">
                            <igc-icon name="file_download" collection="custom"></igc-icon>
                            Export to Excel
                        </igc-button>
                        <igc-dropdown id="viewDropdown"  @igcChange="${this.onViewSelection}" @igcClosed="${this.onViewDropdownVisibility}">
                            ${repeat(this.availableConfigs, (configInfo) => configInfo[0], (configInfo, _) => html`
                                <igc-dropdown-item id="${configInfo[0]}" ?selected="${this.selectedConfig === configInfo[0]}"><span>${this.availableConfigs.get(configInfo[0])?.title}</span></igc-dropdown-item>
                            `)}
                        </igc-dropdown>
                    </div>
                </div>
                <div class="pivotRow">
                    <div class="pivotContainer">
                        <igc-pivot-grid
                            id="salesGrid"
                            .isLoading="${!this.salesData.length}"
                            .data="${this.salesData}"
                            .superCompactMode="${true}"
                            .defaultExpandState="${true}"
                            .pivotConfiguration="${this.availableConfigs.get(this.selectedConfig)?.config}"
                            @columnInit="${this.onColumnInit}">
                        </igc-pivot-grid>
                    </div>
                    <div class="selectorContainer">
                        <igc-pivot-data-selector .grid="${this.pivotGrid}"></igc-pivot-data-selector>
                    </div>
                </div>
            </div>
        `;
    }

    static styles = unsafeCSS(salesGridStyles);
}

declare global {
    interface HTMLElementTagNameMap {
        "app-sales-grid": SalesGrid;
    }
}
