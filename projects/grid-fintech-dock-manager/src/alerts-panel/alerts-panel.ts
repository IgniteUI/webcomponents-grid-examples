import { LitElement, html, nothing, unsafeCSS, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { defineComponents, IgcButtonComponent, IgcIconComponent, IgcListComponent } from "igniteui-webcomponents";
import type { Desk } from "../services/desk.js";
import { since } from "../util/format.js";
import { ICONS } from "../util/icons.js";
import { StoreController } from "../util/store.js";
import styles from "./alerts-panel.scss?inline";

defineComponents(IgcButtonComponent, IgcIconComponent, IgcListComponent);

/**
 * Desk alerts: fills, rejections and unusual moves.
 *
 * The body of the command bar's alerts dialog rather than a docked pane: alerts
 * are glanced at when the bell says there is something new, not kept on
 * screen. Marking them read belongs to whoever opens the dialog; this element
 * is created once, so doing it here would only ever mark once.
 */
@customElement("grid-fintech-dock-manager-alerts")
export default class AlertsPane extends LitElement {
  static styles = unsafeCSS(styles);

  @property({ attribute: false }) desk!: Desk;

  constructor() {
    super();
    new StoreController(this).watch(() => this.desk.notifications, "notifications", "clock");
  }

  private clearAlerts(): void {
    this.desk.notifications.clear();
  }

  protected render(): TemplateResult {
    const { notifications } = this.desk;
    const alerts = notifications.notifications;
    const now = notifications.now;

    return html`
      <igc-button class="clear-btn" variant="outlined" ?disabled=${alerts.length === 0} title="Clear alerts" @click=${this.clearAlerts}>
        <igc-icon slot="prefix" name="clear_all" collection=${ICONS} aria-hidden="true"></igc-icon>
        Clear
      </igc-button>

      <igc-list class="item-list">
        ${alerts.map(
          (alert) => html`
            <igc-list-item class="tone-${alert.tone}">
              <igc-icon slot="start" class="alert-icon" name=${alert.icon} collection=${ICONS} aria-hidden="true"></igc-icon>
              <span slot="title">${alert.title}</span>
              <span slot="subtitle">${alert.detail}</span>
              <small slot="end"><time class="alert-time">${since(alert.at, now)}</time></small>
            </igc-list-item>
          `,
        )}
        ${alerts.length === 0 ? html`<p class="list-empty">No alerts. Fills and unusual moves will land here.</p>` : nothing}
      </igc-list>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "grid-fintech-dock-manager-alerts": AlertsPane;
  }
}
