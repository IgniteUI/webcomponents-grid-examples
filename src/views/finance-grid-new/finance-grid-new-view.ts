import { LitElement, html, unsafeCSS } from "lit";
import { customElement } from "lit/decorators.js";
import namedStyles from "./finance-grid-new-view.scss?inline";
import sharedStyles from "../../shared/styles.scss?inline";

@customElement("finance-grid-new-view")
export default class FinanceGridNewView extends LitElement {
  private onLoad = (event: Event) => {
    (event.target as HTMLIFrameElement).parentElement?.classList.remove("loading");
  };

  render() {
    const iframeSrc = `${import.meta.env.BASE_URL}finance-grid-new`;
    return html` <div class="iframe-wrapper loading" data-app="finance-grid-new">
      <iframe src=${iframeSrc} title="New Financial Portfolio" @load=${this.onLoad}></iframe>
    </div>`;
  }

  static styles = [unsafeCSS(namedStyles), unsafeCSS(sharedStyles)];
}
