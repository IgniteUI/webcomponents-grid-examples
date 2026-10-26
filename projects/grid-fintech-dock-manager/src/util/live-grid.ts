/** The part of `IgcGridComponent` a live grid needs. */
export interface RefreshableGrid {
  markForCheck(): void;
}

/**
 * Keeps a grid's rendered cells in step with row objects that are mutated in
 * place, without touching its `data` binding.
 *
 * Replacing the data array on every price tick makes `igc-grid` rebuild its row
 * cache and re-measure the virtualised viewport, which shows up as a flickering
 * scrollbar. `markForCheck()` is the grid's own answer to this: mutate the
 * records, then ask it to re-render the rows currently on screen. Pass the
 * result to a store subscription for the topic that announces the mutation.
 */
export function refreshOnTick(grid: () => RefreshableGrid | null | undefined): () => void {
  return () => grid()?.markForCheck();
}
