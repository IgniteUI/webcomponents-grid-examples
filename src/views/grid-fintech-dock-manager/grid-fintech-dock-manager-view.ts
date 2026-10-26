import { LitElement, html, unsafeCSS } from "lit";
import { customElement } from "lit/decorators.js";
import namedStyles from "./grid-fintech-dock-manager-view.scss?inline";
import sharedStyles from "../../shared/styles.scss?inline";

@customElement("grid-fintech-dock-manager-view")
export default class GridFintechDockManagerView extends LitElement {
  private onLoad = (event: Event) => {
    (event.target as HTMLIFrameElement).parentElement?.classList.remove("loading");
  };

  render() {
    const iframeSrc = `${import.meta.env.BASE_URL}grid-fintech-dock-manager`;
    return html` <div class="iframe-wrapper loading" data-app="grid-fintech-dock-manager">
      <iframe src=${iframeSrc} title="FinTech Dock Manager" @load=${this.onLoad}></iframe>
    </div>`;
  }

  static styles = [unsafeCSS(namedStyles), unsafeCSS(sharedStyles)];
}
