import { configureTheme, defineComponents, IgcAvatarComponent, IgcBadgeComponent } from "igniteui-webcomponents";
import { IgcCellTemplateContext } from "igniteui-webcomponents-grids/grids";
import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { dataService } from "../services/data.service";
import 'igniteui-webcomponents-grids/grids/combined.js';
import { Trip } from "../models/trip-history.model";
import { prepareGridShadowRoot } from "./grid-shadow-root";

defineComponents(IgcAvatarComponent, IgcBadgeComponent)
configureTheme('material');

@customElement('trip-history-grid')
export class TripHistoryGrid extends LitElement {

    constructor() {
        super();
    }

    firstUpdated() {
        prepareGridShadowRoot(this.renderRoot as ShadowRoot);
    }

    @property({ type: Array }) tripHistoryData: Trip[] | undefined = []

    private rightAlignedCellStyles = {
        'justify-content': 'flex-end',
        'display': 'flex'
    };

    private rightAlignedHeaderStyles = {
        'text-align': 'right'
    };

    private driverCellTemplate = (ctx: IgcCellTemplateContext) => {
        const isVisible = ctx.cell.row.index === 0 && ctx.cell.row.data.end === "N/A";
        return html`
            <igc-avatar class="driver-avatar" shape="circle" src="${this.getPathToDriverPhoto(ctx.cell)}"></igc-avatar>
            <a class="status-value" #coordinates href="#" @click="${(e: MouseEvent) => this.handleDriverClick(e, ctx)}">${ctx.implicit}</a>
            ${isVisible
                ? html`<igc-badge class="driver-badge" variant="success">
                    <span class="current-badge-text">Current</span>
                </igc-badge>`
                : ""
            }            
        `
    }

    private handleDriverClick(event: MouseEvent, ctx: IgcCellTemplateContext) {
        event.preventDefault();

        const driverName = ctx.cell.row?.cells?.find((c: any) => c.column.field === 'driverName')?.value;

        if (!driverName) {
        console.error('Driver not found in data');
        return;
        }

        const driverDetails = dataService.findDriverByName(driverName);

        if (!driverDetails) {
        console.error(`No data found for driver: ${driverName}`);
        return;
        }

        const detail = {
            driverDetails: driverDetails,
            ctx: ctx,
            originalEvent: event
        };

        this.dispatchEvent(new CustomEvent("driver-cell-click", {
            detail,
            bubbles: true,
            composed: true
        }));
    }

    private getPathToDriverPhoto(cell: any) {
        return `people/${dataService.getDriverPhoto(cell.row.data.driverName)}.jpg`;
    }


    render() {
        return html`
            <link rel="stylesheet" href="${import.meta.env.BASE_URL}themes/dark/material.css" />
            <igc-grid class="child-grid" .data="${this.tripHistoryData}" height="${null}" width="100%">
                <igc-column field="id" header="ID" width="5%" .cellStyles="${this.rightAlignedCellStyles}" .headerStyles="${this.rightAlignedHeaderStyles}"></igc-column>
                <igc-column field="driverName" header="Driver" width="18%" .bodyTemplate="${this.driverCellTemplate}"></igc-column>
                <igc-column field="start" header="Start" width="9%"></igc-column>
                <igc-column field="end" header="End" width="9%"></igc-column>
                <igc-column field="startLocation" header="Start Location" width="10%"></igc-column>
                <igc-column field="endLocation" header="End Location" width="10%"></igc-column>
                <igc-column field="startMeter" header="Start Meter" width="9.5%" .cellStyles="${this.rightAlignedCellStyles}" .headerStyles="${this.rightAlignedHeaderStyles}"></igc-column>
                <igc-column field="endMeter" header="End Meter" width="9.5%" .cellStyles="${this.rightAlignedCellStyles}" .headerStyles="${this.rightAlignedHeaderStyles}"></igc-column>
                <igc-column field="distance" header="Distance" width="9%" .cellStyles="${this.rightAlignedCellStyles}" .headerStyles="${this.rightAlignedHeaderStyles}"></igc-column>
                <igc-column field="totalTime" header="Total Time" width="9%" .cellStyles="${this.rightAlignedCellStyles}" .headerStyles="${this.rightAlignedHeaderStyles}"></igc-column>
            </igc-grid>
        `
    }

    static styles = css`       
        .driver-avatar {
            --size: 22px
        }

        .status-value {
            padding-left: 8px;
            color: var(--primary-text-color);
        }

        .driver-badge {
            margin-left: 10px;
        }

        .current-badge-text {
            margin: 0 8px;
        }

        /* Badges follow --ig-size since igniteui-webcomponents 6.4; keep their 22px size in the small grid. */
        igc-badge {
            --ig-badge-size: 1.375rem;
        }
    `;
}