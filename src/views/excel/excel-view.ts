import { LitElement, html, unsafeCSS } from "lit";
import { customElement } from "lit/decorators.js";
import namedStyles from "./excel-view.scss?inline";
import sharedStyles from "../../shared/styles.scss?inline";

@customElement("excel-view")
export default class ExcelView extends LitElement {
  private onLoad = (event: Event) => {
    (event.target as HTMLIFrameElement).parentElement?.classList.remove("loading");
  };

  render() {
    const iframeSrc = `${import.meta.env.BASE_URL}excel`;
    return html` <div class="iframe-wrapper loading" data-app="excel">
      <iframe src=${iframeSrc} title="Budget Planning Workbook" @load=${this.onLoad}></iframe>
    </div>`;
  }

  static styles = [unsafeCSS(namedStyles), unsafeCSS(sharedStyles)];
}
