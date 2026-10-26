import type { ReactiveController, ReactiveControllerHost } from "lit";

/**
 * Base class for the desk's services. State lives in plain fields, and every
 * change is announced as a named topic, so a pane re-renders on the topics it
 * reads and on nothing else.
 */
export class Store<Topic extends string> extends EventTarget {
  /** Subscribes to a topic and returns the function that unsubscribes. */
  subscribe(topic: Topic, listener: () => void): () => void {
    this.addEventListener(topic, listener);
    return () => this.removeEventListener(topic, listener);
  }

  protected emit(...topics: Topic[]): void {
    for (const topic of topics) {
      this.dispatchEvent(new Event(topic));
    }
  }
}

/**
 * Wraps a service reaction so it runs once, after the current task, however
 * many times it was triggered during it.
 *
 * That is the timing a reaction to shared state needs: a reset writes to four
 * services in a row, and each reaction has to see all four writes, not the
 * first of them.
 */
export function afterTask(reaction: () => void): () => void {
  let queued = false;
  return () => {
    if (queued) {
      return;
    }

    queued = true;
    queueMicrotask(() => {
      queued = false;
      reaction();
    });
  };
}

/**
 * Connects a Lit element to store topics for as long as it is in the document.
 *
 * `watch` re-renders the host when a topic fires; `on` runs a callback instead,
 * for the reactions that are not a render, such as refreshing a live grid.
 * Stores are resolved when the host connects, so they can arrive as properties.
 */
export class StoreController implements ReactiveController {
  private readonly host: ReactiveControllerHost;
  private readonly bindings: (() => () => void)[] = [];
  private readonly active: (() => void)[] = [];

  constructor(host: ReactiveControllerHost) {
    this.host = host;
    host.addController(this);
  }

  watch<Topic extends string>(store: () => Store<Topic>, ...topics: Topic[]): this {
    for (const topic of topics) {
      this.bindings.push(() => store().subscribe(topic, () => this.host.requestUpdate()));
    }
    return this;
  }

  on<Topic extends string>(store: () => Store<Topic>, topic: Topic, callback: () => void): this {
    this.bindings.push(() => store().subscribe(topic, callback));
    return this;
  }

  hostConnected(): void {
    for (const bind of this.bindings) {
      this.active.push(bind());
    }
  }

  hostDisconnected(): void {
    for (const unsubscribe of this.active.splice(0)) {
      unsubscribe();
    }
  }
}

/**
 * Caches a derivation on the identity of its inputs, the way a computed value
 * does: the same inputs hand back the same object. Grids depend on this, since a
 * new `data` array makes them re-measure their virtualised body.
 */
export function memoize<Args extends readonly unknown[], Result>(derive: (...args: Args) => Result): (...args: Args) => Result {
  let inputs: Args | undefined;
  let result: Result;

  return (...args: Args): Result => {
    const changed = !inputs || inputs.length !== args.length || args.some((arg, index) => !Object.is(arg, inputs![index]));
    if (changed) {
      inputs = args;
      result = derive(...args);
    }
    return result;
  };
}
