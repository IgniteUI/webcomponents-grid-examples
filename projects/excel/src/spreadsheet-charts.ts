import type { IgcDataChartComponent } from "igniteui-webcomponents-charts";

/** The charts the Spreadsheet draws on a sheet are data charts. */
const CHART_SELECTOR = "igc-data-chart";

/**
 * Destroys the charts of a spreadsheet when the spreadsheet is done with them.
 *
 * The Spreadsheet creates new charts whenever a sheet with charts is shown and takes them out of
 * the DOM when the sheet is left, but it never destroys them. A chart polls its size on a timer,
 * every 100 ms, until it is destroyed, so each visit to a sheet with charts would leave
 * more timers running for as long as the page lives.
 *
 * Pass the shadow root that holds the spreadsheet. Charts that the Spreadsheet removes are
 * destroyed as they go. The returned function destroys the remaining charts and stops watching;
 * it has to run when the element that holds the shadow root is removed.
 */
export function destroyRemovedCharts(root: ShadowRoot): () => void {
  const destroyRemoved = (records: MutationRecord[]) => {
    for (const record of records) {
      for (const node of record.removedNodes) {
        for (const chart of chartsIn(node)) {
          // A chart that was only moved is connected again by now.
          if (!chart.isConnected) {
            chart.destroy();
          }
        }
      }
    }
  };

  const observer = new MutationObserver(destroyRemoved);
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    destroyRemoved(observer.takeRecords());
    observer.disconnect();
    for (const chart of chartsIn(root)) {
      chart.destroy();
    }
  };
}

function chartsIn(node: Node): IgcDataChartComponent[] {
  if (!(node instanceof Element || node instanceof ShadowRoot)) {
    return [];
  }
  const charts = Array.from(node.querySelectorAll<IgcDataChartComponent>(CHART_SELECTOR));
  return node instanceof Element && node.matches(CHART_SELECTOR) ? [node as IgcDataChartComponent, ...charts] : charts;
}
