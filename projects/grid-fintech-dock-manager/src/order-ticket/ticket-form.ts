import type { OrderType, TimeInForce } from "../models/stock.model.js";

/** Order types that rest on a limit price. */
export const LIMIT_TYPES: readonly OrderType[] = ["Limit", "Stop Limit"];
/** Order types that need a stop price or trail amount. */
export const STOP_TYPES: readonly OrderType[] = ["Stop", "Stop Limit", "Trailing Stop"];

export type TicketField = "quantity" | "type" | "limitPrice" | "stopPrice" | "timeInForce";

export interface TicketValue {
  quantity: number | null;
  type: OrderType;
  limitPrice: number | null;
  stopPrice: number | null;
  timeInForce: TimeInForce;
}

export type TicketStatus = "VALID" | "INVALID";

/**
 * The order ticket's form model.
 *
 * It keeps the two views of the form a ticket needs apart:
 *
 * - the **current** values, which is what an order is placed with and what the
 *   fields show;
 * - the **announced** value and status, which change only when a field is
 *   edited or set, and which the ticket's derived figures (the estimate, the
 *   quick sizes, whether it can submit) follow.
 *
 * Re-seeding the price fields for a new symbol, and switching a price field on
 * or off for a new order type, are deliberately silent: they change the
 * current values without announcing them. The announced value leaves out the
 * fields that are switched off, and nothing announces until a field changes.
 */
export class TicketForm {
  private readonly current: TicketValue = {
    quantity: 100,
    type: "Limit",
    limitPrice: null,
    stopPrice: null,
    timeInForce: "Day",
  };

  private readonly enabled: Record<"limitPrice" | "stopPrice", boolean> = { limitPrice: true, stopPrice: true };

  private _value: Partial<TicketValue> = { ...this.current };
  private _status: TicketStatus = this.validate();

  /** The value as last announced. Fields that were switched off at that moment are absent. */
  get value(): Partial<TicketValue> {
    return this._value;
  }

  /** The status as last announced. */
  get status(): TicketStatus {
    return this._status;
  }

  /** Every current value, switched-off fields included. */
  rawValue(): TicketValue {
    return { ...this.current };
  }

  /** Changes one field and announces the result: an edit, or a programmatic set. */
  set<Field extends TicketField>(field: Field, value: TicketValue[Field]): void {
    this.current[field] = value;
    this.announce();
  }

  /** Changes fields without announcing them. */
  patchSilently(values: Partial<TicketValue>): void {
    Object.assign(this.current, values);
  }

  /** Switches a price field on or off without announcing it. */
  setEnabled(field: "limitPrice" | "stopPrice", enabled: boolean): void {
    this.enabled[field] = enabled;
  }

  private announce(): void {
    const value: Partial<TicketValue> = { ...this.current };
    if (!this.enabled.limitPrice) {
      delete value.limitPrice;
    }
    if (!this.enabled.stopPrice) {
      delete value.stopPrice;
    }

    this._value = value;
    this._status = this.validate();
  }

  /**
   * The quantity is required and at least one share; a price, while its field
   * is on, is at least a cent. An empty price passes here and is left to the
   * engine, which names what is missing.
   */
  private validate(): TicketStatus {
    const { quantity, limitPrice, stopPrice } = this.current;
    const valid =
      quantity !== null &&
      !(quantity < 1) &&
      !(this.enabled.limitPrice && limitPrice !== null && limitPrice < 0.01) &&
      !(this.enabled.stopPrice && stopPrice !== null && stopPrice < 0.01);
    return valid ? "VALID" : "INVALID";
  }
}
