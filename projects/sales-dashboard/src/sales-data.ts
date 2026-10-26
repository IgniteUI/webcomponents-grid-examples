/** A KPI tile: the figure, its change and the avatar glyph beside the label. */
export interface MetricCard {
  label: string;
  value: string;
  delta: string;
  positive: boolean;
  icon: string;
  iconClass: string;
}

/** One month of the revenue trend, in thousands of dollars. */
export interface RevenueTrendPoint {
  month: string;
  revenue: number;
  targetLine: number;
}

/** A region's share of revenue, in percent. */
export interface RegionShare {
  region: string;
  value: number;
}

/** Deals closed on one day of the week. */
export interface WeeklyDeals {
  day: string;
  deals: number;
}

/** A row of the Recent Activity grid. */
export interface ActivityRow {
  company: string;
  region: string;
  stage: string;
  value: string;
  rep: string;
  source: string;
  when: string;
}

/** A row of the Leaderboard. */
export interface LeaderboardItem {
  rank: number;
  name: string;
  quota: string;
  amount: string;
  delta: string;
  positive: boolean;
}

export const METRICS: MetricCard[] = [
  { label: "Revenue MTD", value: "$842.3K", delta: "12.4% vs target", positive: true, icon: "attach_money", iconClass: "rank-badge rank-1" },
  { label: "Quota Attainment", value: "94%", delta: "1.3 pts vs last month", positive: true, icon: "percent", iconClass: "rank-badge rank-2" },
  { label: "Deals Closed (Mtd)", value: "37", delta: "6 vs last month", positive: true, icon: "tag", iconClass: "rank-badge rank-3" },
  { label: "Avg Deal Size", value: "$22.8K", delta: "1.9% vs last month", positive: false, icon: "diamond", iconClass: "icon-avg" },
];

export const REVENUE_TREND: RevenueTrendPoint[] = [
  { month: "Jan", revenue: 648, targetLine: 635 },
  { month: "Feb", revenue: 662, targetLine: 646 },
  { month: "Mar", revenue: 684, targetLine: 658 },
  { month: "Apr", revenue: 702, targetLine: 672 },
  { month: "May", revenue: 728, targetLine: 696 },
  { month: "Jun", revenue: 760, targetLine: 724 },
  { month: "Jul", revenue: 790, targetLine: 752 },
];

export const REVENUE_BY_REGION: RegionShare[] = [
  { region: "West", value: 37 },
  { region: "East", value: 32 },
  { region: "Central", value: 22 },
  { region: "International", value: 9 },
];

export const WEEKLY_DEALS: WeeklyDeals[] = [
  { day: "Mon", deals: 18 },
  { day: "Tue", deals: 23 },
  { day: "Wed", deals: 16 },
  { day: "Thu", deals: 29 },
  { day: "Fri", deals: 35 },
  { day: "Sat", deals: 42 },
  { day: "Sun", deals: 25 },
];

export const LEADERBOARD: LeaderboardItem[] = [
  { rank: 1, name: "Dana Voss", quota: "128% of quota", amount: "$312,400", delta: "18%", positive: true },
  { rank: 2, name: "Marcus Ibe", quota: "116% of quota", amount: "$284,900", delta: "8%", positive: true },
  { rank: 3, name: "Priya Shah", quota: "104% of quota", amount: "$256,100", delta: "14%", positive: true },
  { rank: 4, name: "Tom Reyes", quota: "98% of quota", amount: "$231,700", delta: "-2%", positive: false },
  { rank: 5, name: "Elena Cruz", quota: "91% of quota", amount: "$198,300", delta: "-5%", positive: false },
];

export const ACTIVITY_ROWS: ActivityRow[] = [
  { company: "Vantage Corp", region: "West", stage: "Closed Won", value: "$48,200", rep: "Dana Voss", source: "Referral", when: "2h ago" },
  { company: "Northfield Retail", region: "Central", stage: "Proposal Sent", value: "$22,000", rep: "Priya Shah", source: "Inbound", when: "5h ago" },
  { company: "Callisto Systems", region: "East", stage: "Negotiation", value: "$67,500", rep: "Marcus Ibe", source: "Outbound", when: "1d ago" },
  { company: "Bright Path LLC", region: "West", stage: "Closed Won", value: "$15,300", rep: "Tom Reyes", source: "Partner", when: "1d ago" },
  { company: "Ferro Industrial", region: "International", stage: "Qualified", value: "$91,000", rep: "Elena Cruz", source: "Conference", when: "2d ago" },
];

/** The semantic pill class of a deal stage; an unknown stage gets no pill colour. */
export function stageClassFor(stage: string): string {
  if (stage === "Closed Won") return "stage-win";
  if (stage === "Proposal Sent") return "stage-proposal";
  if (stage === "Negotiation") return "stage-negotiation";
  if (stage === "Qualified") return "stage-qualified";
  return "";
}
