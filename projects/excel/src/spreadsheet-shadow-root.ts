/**
 * Prepares a shadow root that renders an Ignite UI Spreadsheet.
 *
 * The Spreadsheet is written for a page without shadow roots, and three things break inside one:
 * - It adds its styles, and those of the charts it draws, to the document head, once per
 *   document: the formula bar, name box, sheet tabs, scrollbars and splitters, the legends and
 *   the tooltips of its charts. None of them reaches a shadow root. The cells paint on canvases
 *   and look right, but the chrome around them is unstyled and chart legends fall back to the
 *   page's font. The styles are copied into the shadow root, including those the packages add
 *   later, such as the legend styles that arrive when the first chart appears.
 * - It finds out which of its own elements has the focus by reading `document.activeElement`,
 *   which is the outermost shadow host while the focus is inside a shadow root. Typing in a cell
 *   does not reach the formula bar, F2 does not start editing and typing a reference into the
 *   name box does not navigate. While the shadow root is prepared, `document.activeElement`
 *   answers with the element that really has the focus.
 * - When a context menu or a filter menu closes, it gives the focus back to the element that had
 *   it before the menu opened, but only if `document.body.contains()` finds that element, which
 *   it never does for an element inside a shadow root. The keyboard then stops working after
 *   every menu, until a cell is clicked. While the shadow root is prepared,
 *   `document.body.contains()` also finds the nodes inside it.
 *
 * Call it once the spreadsheet element exists (for example in `updated`) with the shadow root
 * that holds it. The returned function undoes all three changes, and has to run when the element
 * that holds the shadow root is removed. The last two changes are made to the document, so
 * they are shared: they are made for the first prepared shadow root and undone with the last.
 */
export function prepareSpreadsheetShadowRoot(root: ShadowRoot): () => void {
  const stopAdoptingStyles = adoptDataVisualizationStyles(root);
  if (preparedRoots.length === 0) {
    restoreDocument = changeDocument(preparedRoots);
  }
  preparedRoots.push(root);

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    stopAdoptingStyles();
    preparedRoots.splice(preparedRoots.indexOf(root), 1);
    if (preparedRoots.length === 0) {
      restoreDocument?.();
      restoreDocument = undefined;
    }
  };
}

/** The shadow roots that are prepared at the moment. */
const preparedRoots: ShadowRoot[] = [];
let restoreDocument: (() => void) | undefined;

/** Makes the changes to the document that serve all the given shadow roots, now and as they come and go. */
function changeDocument(roots: readonly ShadowRoot[]): () => void {
  const restoreActiveElement = exposeDeepActiveElement();
  const restoreBodyContains = includeShadowRootsInBody(roots);
  return () => {
    restoreActiveElement();
    restoreBodyContains();
  };
}

/**
 * Copies the document's data visualization styles into the shadow root and keeps copying new
 * ones. The returned function stops that and takes the copies out of the shadow root again.
 */
function adoptDataVisualizationStyles(root: ShadowRoot): () => void {
  const seen = new Set<HTMLStyleElement>();
  const adopted = new Set<CSSStyleSheet>();

  const adoptNewStyles = () => {
    const sheets: CSSStyleSheet[] = [];
    for (const style of document.head.querySelectorAll("style")) {
      // The packages mark the style elements they add with a `data-ig-...` attribute.
      if (!seen.has(style) && style.getAttributeNames().some((name) => name.startsWith("data-ig-"))) {
        seen.add(style);
        sheets.push(toStyleSheet(style.textContent ?? ""));
      }
    }
    if (sheets.length) {
      sheets.forEach((sheet) => adopted.add(sheet));
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, ...sheets];
    }
  };

  adoptNewStyles();
  const observer = new MutationObserver(adoptNewStyles);
  observer.observe(document.head, { childList: true });
  return () => {
    observer.disconnect();
    root.adoptedStyleSheets = root.adoptedStyleSheets.filter((sheet) => !adopted.has(sheet));
  };
}

function toStyleSheet(css: string): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
    const rule = sheet.cssRules[i];
    if (!(rule instanceof CSSStyleRule)) {
      continue;
    }
    // The legend styles carry a `:host` rule meant for a legend that has its own shadow root;
    // here it would restyle the app element.
    if (rule.selectorText.startsWith(":host")) {
      sheet.deleteRule(i);
      continue;
    }
    // The legend styles also list a bare `canvas` among the selectors of the legend badge. It is
    // meant for the badge's canvas but would restyle every canvas the Spreadsheet draws on.
    const selectors = rule.selectorText.split(",").map((selector) => selector.trim());
    const kept = selectors.filter((selector) => selector !== "canvas");
    if (kept.length === 0) {
      sheet.deleteRule(i);
    } else if (kept.length < selectors.length) {
      rule.selectorText = kept.join(", ");
    }
  }
  return sheet;
}

/** Makes `document.activeElement` answer with the focused element inside nested shadow roots. */
function exposeDeepActiveElement(): () => void {
  const getActiveElement = Object.getOwnPropertyDescriptor(Document.prototype, "activeElement")?.get;
  if (!getActiveElement) {
    return () => {};
  }

  Object.defineProperty(document, "activeElement", {
    configurable: true,
    get() {
      let active = getActiveElement.call(document) as Element | null;
      while (active?.shadowRoot?.activeElement) {
        active = active.shadowRoot.activeElement;
      }
      return active;
    },
  });
  return () => {
    Reflect.deleteProperty(document, "activeElement");
  };
}

/** Makes `document.body.contains()` find the nodes inside the shadow roots, which it does not search. */
function includeShadowRootsInBody(roots: readonly ShadowRoot[]): () => void {
  const body = document.body;
  const bodyContains = body.contains;

  Object.defineProperty(body, "contains", {
    configurable: true,
    writable: true,
    value(this: Node, node: Node | null): boolean {
      return bodyContains.call(this, node) || (node !== null && roots.some((root) => root.contains(node)));
    },
  });
  return () => {
    Reflect.deleteProperty(body, "contains");
  };
}
