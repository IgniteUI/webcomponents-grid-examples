import { LitElement, html, unsafeCSS } from "lit";
import { customElement } from "lit/decorators.js";
import namedStyles from "./grid-fintech-100k-view.scss?inline";
import sharedStyles from "../../shared/styles.scss?inline";

@customElement("grid-fintech-100k-view")
export default class GridFintech100kView extends LitElement {
  private onLoad = (event: Event) => {
    (event.target as HTMLIFrameElement).parentElement?.classList.remove("loading");
  };

  render() {
    const iframeSrc = `${import.meta.env.BASE_URL}grid-fintech-100k`;
    return html` <div class="iframe-wrapper loading" data-app="grid-fintech-100k">
      <iframe src=${iframeSrc} title="FinTech 100K" @load=${this.onLoad}></iframe>
    </div>`;
  }

  static styles = [unsafeCSS(namedStyles), unsafeCSS(sharedStyles)];
}
