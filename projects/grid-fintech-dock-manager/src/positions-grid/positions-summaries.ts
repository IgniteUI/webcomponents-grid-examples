import { IgcNumberSummaryOperand, type IgcSummaryResult } from "igniteui-webcomponents-grids/grids";
import { formatMoney } from "../util/finance.js";

/**
 * Summary operand for the positions grid's money columns. Keeping it out of the
 * pane keeps the totals formatted like the rest of the desk.
 */
export class CurrencySumSummary extends IgcNumberSummaryOperand {
  override operate(data: number[] = []): IgcSummaryResult[] {
    const total = data.reduce((sum, value) => sum + value, 0);

    return [
      { key: "total", label: "Total", summaryResult: formatMoney(total) },
      { key: "count", label: "Positions", summaryResult: data.length },
    ];
  }
}
