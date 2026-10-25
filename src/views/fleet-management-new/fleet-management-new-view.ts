import { LitElement, html, unsafeCSS } from "lit";
import { customElement } from "lit/decorators.js";
import namedStyles from "./fleet-management-new-view.scss?inline";
import sharedStyles from "../../shared/styles.scss?inline";

@customElement("fleet-management-new-view")
export default class FleetManagementNewView extends LitElement {
  private onLoad = (event: Event) => {
    (event.target as HTMLIFrameElement).parentElement?.classList.remove("loading");
  };

  render() {
    const iframeSrc = `${import.meta.env.BASE_URL}fleet-management-new`;
    return html` <div class="iframe-wrapper loading" data-app="fleet-management-new">
      <iframe src=${iframeSrc} title="New Fleet Management" @load=${this.onLoad}></iframe>
    </div>`;
  }

  static styles = [unsafeCSS(namedStyles), unsafeCSS(sharedStyles)];
}
