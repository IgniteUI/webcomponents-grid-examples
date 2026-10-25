/** Where the ring of a doughnut chart is, in the chart's own pixels. */
export interface DonutRing {
  /** The centre of the ring. */
  cx: number;
  cy: number;
  /** The radius of the hole. */
  holeRadius: number;
  /** The radius of the outer edge: the hole is `innerExtent` percent of it. */
  outerRadius: number;
}

/** Builds the ring from the hole the chart reports and the `innerExtent` it was given, in percent. */
export function ringFromHole(cx: number, cy: number, holeRadius: number, innerExtent: number): DonutRing {
  return { cx, cy, holeRadius, outerRadius: holeRadius / (innerExtent / 100) };
}

/**
 * The slices run clockwise from the 3 o'clock position, each as wide as its share of the total.
 * This is the chart's own layout, and it is what the slice click event reports.
 */
function sliceSpans(values: readonly number[]): { start: number; end: number }[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  let start = 0;
  return values.map((value) => {
    const span = { start, end: start + (value / total) * 360 };
    start = span.end;
    return span;
  });
}

/** The index of the slice under a point, or -1 when the point is in the hole or outside the ring. */
export function sliceAtPoint(values: readonly number[], ring: DonutRing, x: number, y: number): number {
  const dx = x - ring.cx;
  const dy = y - ring.cy;
  const distance = Math.hypot(dx, dy);
  if (distance < ring.holeRadius || distance > ring.outerRadius) {
    return -1;
  }
  // Screen y points down, so the angle already grows clockwise.
  const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
  const index = sliceSpans(values).findIndex((span) => angle < span.end);
  return index === -1 ? values.length - 1 : index;
}

/** The middle of a slice's band of the ring. */
export function sliceCentre(values: readonly number[], ring: DonutRing, index: number): { x: number; y: number } {
  const { start, end } = sliceSpans(values)[index];
  const angle = (((start + end) / 2) * Math.PI) / 180;
  const radius = (ring.holeRadius + ring.outerRadius) / 2;
  return { x: ring.cx + radius * Math.cos(angle), y: ring.cy + radius * Math.sin(angle) };
}
