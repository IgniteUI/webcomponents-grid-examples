import { configureTheme, defineComponents, IgcBadgeComponent, IgcIconComponent, registerIconFromText } from "igniteui-webcomponents";
import { IgcCellTemplateContext } from "igniteui-webcomponents-grids/grids";
import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import 'igniteui-webcomponents-grids/grids/combined.js';
import { check, gitIssue } from "@igniteui/material-icons-extended";
import { Maintenance } from "../models/maintenance-history.model";
import { prepareGridShadowRoot } from "./grid-shadow-root";


defineComponents(IgcBadgeComponent, IgcIconComponent)
configureTheme("material")

@customElement("maintenance-grid")
export class TripHistoryGrid extends LitElement {
    constructor() {
        super();

        registerIconFromText(check.name, check.value, "imx-icons");
        registerIconFromText(gitIssue.name, gitIssue.value, 'imx-icons');
    }

    firstUpdated() {
        prepareGridShadowRoot(this.renderRoot as ShadowRoot);
    }

    @property({ type: Array }) maintenanceData: Maintenance[] | undefined = [];

    private typeCellTemplate = (ctx: IgcCellTemplateContext) => {
        const value = ctx.implicit;
        const variant = value === "Regular" ? "success" : "warning";
        const iconName = value === "Regular" ? "check" : "git-issue";
        return html`
            <igc-badge .variant="${variant}">
                <igc-icon class="icon-style" collection="imx-icons" .name="${iconName}"></igc-icon>
            </igc-badge>
            <span class="status-value">${value}</span>
        `;        
    }

    private rightAlignedCellStyles = {
        'justify-content': 'flex-end',
        'display': 'flex'
    };

    private rightAlignedHeaderStyles = {
        'text-align': 'right'
    };

    render() {
        return html`
            <link rel="stylesheet" href="${import.meta.env.BASE_URL}themes/dark/material.css" />
            <igc-grid class="child-grid" .data="${ this.maintenanceData }" height="100%" width="100%">
                <igc-column id="id-column" field="id" header="ID" width="5%" .cellStyles="${this.rightAlignedCellStyles}" .headerStyles="${this.rightAlignedHeaderStyles}"></igc-column>
                <igc-column field="event" header="Event" width="23%"></igc-column>
                <igc-column field="date" header="Date" width="10%"></igc-column>
                <igc-column field="location" header="Location" width="10%"></igc-column>
                <igc-column id="type-column" field="type" header="Type" width="12%" .bodyTemplate="${this.typeCellTemplate}"></igc-column>
                <igc-column field="remarks" header="Remarks" width="40%"></igc-column>
            </igc-grid>
        `
    }

    static styles = css`
        .icon-style {
            color: #000000;
        }

        .status-value {
            padding-left: 8px;
            color: var(--primary-text-color);
        }

        /* Badges follow --ig-size since igniteui-webcomponents 6.4; keep their 22px size in the small grid. */
        igc-badge {
            --ig-badge-size: 1.375rem;
        }

        /* The icons are black: keep the 500 badge tone they read well on (Material uses a darker one since 6.4). */
        igc-badge[variant="success"]::part(base) {
            background: var(--ig-success-500);
        }
    `;
}