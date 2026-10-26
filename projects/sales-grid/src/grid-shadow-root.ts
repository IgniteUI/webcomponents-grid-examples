/**
 * Prepares a shadow root that renders an igniteui-webcomponents-grids 7.3 grid.
 *
 * Two problems of the grids appear only when a grid renders inside a shadow root:
 * - the grid adopts its structural stylesheet on the document only, so the grid stays unstyled;
 * - the grid handles some scroll and input events after their dispatch has ended and reads
 *   `event.target` then, when the browser no longer exposes the original target of an event
 *   from a shadow tree: mouse-wheel scrolling throws and stops moving the rows, and typing in
 *   the filter row throws.
 *
 * Call it once the grid element exists (for example in `firstUpdated`), with the shadow root
 * that holds the grid.
 *
 * Limits: it copies the sheets the document has adopted at the time of the call. Today that is
 * only the grid's structural sheet; a sheet another library adopts on the document would be
 * copied too, and a sheet adopted later is not picked up.
 */
export function prepareGridShadowRoot(root: ShadowRoot): void {
    const missing = document.adoptedStyleSheets.filter((sheet) => !root.adoptedStyleSheets.includes(sheet));
    if (missing.length) {
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, ...missing];
    }
    for (const type of ["scroll", "input"]) {
        root.addEventListener(type, keepEventTarget, { capture: true });
    }
}

/** The browser's own getter of `Event.prototype.target`. */
const nativeTargetGetter = Object.getOwnPropertyDescriptor(Event.prototype, "target")?.get;

/**
 * Keeps the target of an event that starts in this tree readable after the dispatch. While the
 * event is dispatched, the browser's own getter answers, so listeners outside the shadow root
 * still see the retargeted host. Events from nested shadow roots are left alone: their target
 * here is a host.
 */
function keepEventTarget(event: Event): void {
    const target = event.target;
    const getTarget = nativeTargetGetter;
    if (!getTarget || event.composedPath()[0] !== target) {
        return;
    }
    Object.defineProperty(event, "target", {
        configurable: true,
        get(this: Event) {
            return this.eventPhase === Event.NONE ? target : getTarget.call(this);
        },
    });
}
