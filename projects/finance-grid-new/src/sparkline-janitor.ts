import type { IgcSparklineComponent } from "igniteui-webcomponents-charts";

/**
 * Stops the size polling of sparklines that have left the page.
 *
 * An `igc-sparkline` re-measures itself every 100 ms until `destroy()` is called, and removing the
 * element does not stop that: every sparkline a column or a page drops would keep a timer running
 * for good. The grid creates and drops its cell content itself, so there is no template callback
 * to hook; the janitor watches the grid's subtree instead.
 */
export class SparklineJanitor {
  private readonly destroyed = new WeakSet<IgcSparklineComponent>();
  private readonly observer = new MutationObserver((records) => this.sweep(records));

  /** Whether `releaseAll` has destroyed sparklines that a later render may still show. */
  released = false;

  /** Starts watching `root`, the element the sparklines live under, and stops watching the previous one. */
  observe(root: Element): void {
    this.observer.disconnect();
    this.observer.observe(root, { childList: true, subtree: true });
  }

  /** Destroys every sparkline under `root`, for when the whole page goes. */
  releaseAll(root: ParentNode | null): void {
    this.observer.disconnect();
    for (const sparkline of root?.querySelectorAll<IgcSparklineComponent>("igc-sparkline") ?? []) {
      this.destroy(sparkline);
    }
    this.released = true;
  }

  /** Forgets that sparklines were released: the next render builds new ones. */
  reset(): void {
    this.released = false;
  }

  /**
   * Destroys the sparklines among the removed nodes. A node that is back in the document by the
   * time the batch is delivered was only moved, which is how the grid recycles rows, and stays.
   */
  private sweep(records: MutationRecord[]): void {
    for (const record of records) {
      for (const node of record.removedNodes) {
        if (!(node instanceof Element)) {
          continue;
        }
        const sparklines = node.matches("igc-sparkline") ? [node] : Array.from(node.querySelectorAll("igc-sparkline"));
        for (const sparkline of sparklines as IgcSparklineComponent[]) {
          if (!sparkline.isConnected) {
            this.destroy(sparkline);
          }
        }
      }
    }
  }

  private destroy(sparkline: IgcSparklineComponent): void {
    if (!this.destroyed.has(sparkline)) {
      this.destroyed.add(sparkline);
      sparkline.destroy();
    }
  }
}
