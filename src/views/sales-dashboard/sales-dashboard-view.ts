import { LitElement, html, unsafeCSS } from "lit";
import { customElement } from "lit/decorators.js";
import namedStyles from "./sales-dashboard-view.scss?inline";
import sharedStyles from "../../shared/styles.scss?inline";

@customElement("sales-dashboard-view")
export default class SalesDashboardView extends LitElement {
  private onLoad = (event: Event) => {
    (event.target as HTMLIFrameElement).parentElement?.classList.remove("loading");
  };

  render() {
    const iframeSrc = `${import.meta.env.BASE_URL}sales-dashboard`;
    return html` <div class="iframe-wrapper loading" data-app="sales-dashboard">
      <iframe src=${iframeSrc} title="Sales KPI Dashboard" @load=${this.onLoad}></iframe>
    </div>`;
  }

  static styles = [unsafeCSS(namedStyles), unsafeCSS(sharedStyles)];
}
