import type { FleetVehicle } from "./fleet-service.js";

interface FleetTripRow {
  date: string;
  from: string;
  to: string;
  startMeter: string;
  endMeter: string;
  distance: string;
  duration: string;
  driver: string;
}

interface FleetMaintenanceRow {
  date: string;
  service: string;
  odometer: string;
  cost: string;
  status: "Completed" | "Scheduled";
}

export type FleetCostTone = "fuel" | "maintenance" | "insurance" | "tolls";

interface FleetCostItem {
  label: string;
  value: number;
  tone: FleetCostTone;
}

export interface FleetCostDistributionPoint {
  label: string;
  displayLabel: string;
  percentage: string;
  value: number;
  tone: FleetCostTone;
}

interface FleetMonthlySpendPoint {
  month: string;
  spend: number;
}

interface FleetUtilizationComparisonPoint {
  month: string;
  priorYear: number;
  currentYear: number;
}

/** Everything an expanded row renders. */
export interface FleetDetail {
  tripSummary: { trips: number; totalDistance: string; avgTrip: string };
  tripRows: FleetTripRow[];
  maintenanceNotice: string;
  maintenanceRows: FleetMaintenanceRow[];
  totalCost: string;
  topCostCategory: string;
  peakSpendMonth: string;
  costDistribution: FleetCostDistributionPoint[];
  monthlySpend: FleetMonthlySpendPoint[];
  utilization: { rate: string; activeHours: string; idleHours: string; trips: number };
  utilizationSeries: FleetUtilizationComparisonPoint[];
  utilizationYoY: string;
}

const detailCache = new Map<string, FleetDetail>();

/**
 * Everything an expanded row renders, built once per vehicle.
 *
 * The charts compare their `dataSource` by identity, so rebuilding the arrays on every
 * render would make them repaint continuously. Status is the only mutable input, so
 * keying on it lets an entry invalidate itself when a vehicle changes.
 */
export function fleetDetail(vehicle: FleetVehicle): FleetDetail {
  const key = `${vehicle.id}:${vehicle.status}`;
  let detail = detailCache.get(key);

  if (!detail) {
    const costDistribution = fleetCostDistribution(vehicle);
    const monthlySpend = fleetMonthlyOperatingSpend(vehicle);

    detail = {
      tripSummary: fleetTripSummary(vehicle),
      tripRows: fleetTripHistory(vehicle),
      maintenanceNotice: fleetMaintenanceNotice(vehicle),
      maintenanceRows: fleetMaintenanceRows(vehicle),
      totalCost: fleetTotalCost(vehicle),
      topCostCategory: fleetTopCostCategory(costDistribution),
      peakSpendMonth: fleetPeakSpendMonth(monthlySpend),
      costDistribution,
      monthlySpend,
      utilization: fleetUtilizationSummary(vehicle),
      utilizationSeries: fleetUtilizationSeries(vehicle),
      utilizationYoY: fleetUtilizationYoY(vehicle),
    };
    detailCache.set(key, detail);
  }

  return detail;
}

export function fleetMaintenanceStatusClass(status: FleetMaintenanceRow["status"]): string {
  return status === "Completed" ? "fleet-detail-pill-success" : "fleet-detail-pill-warn";
}

export function fleetCostToneClass(tone: FleetCostTone): string {
  return `fleet-cost-tone-${tone}`;
}

export const fleetCurrencyAxisLabel = (value: unknown): string => `$${Number(value).toLocaleString("en-US")}`;

function fleetTripSummary(vehicle: FleetVehicle): FleetDetail["tripSummary"] {
  const seed = fleetSeed(vehicle);
  const trips = 18 + (seed % 8);
  const totalMiles = 248 + (seed % 9) * 16;
  return { trips, totalDistance: `${formatWholeNumber(totalMiles)} mi`, avgTrip: `${(totalMiles / trips).toFixed(1)} mi` };
}

function fleetTripHistory(vehicle: FleetVehicle): FleetTripRow[] {
  const seed = fleetSeed(vehicle);
  const city = fleetCity(vehicle);
  const baseDistance = 8.4 + (seed % 5) * 1.3;
  const currentMileage = fleetMileageValue(vehicle);
  const tripDistances = [baseDistance + 4.5, baseDistance + 0.1, baseDistance + 8.8, baseDistance + 8.1, baseDistance + 5.2, baseDistance + 6.6].map((v) => Number(v.toFixed(1)));

  let runningMeter = currentMileage + tripDistances.reduce((sum, value) => sum + value, 0);
  const buildMeters = (distance: number): { startMeter: string; endMeter: string } => {
    const endMeterValue = runningMeter;
    const startMeterValue = Math.max(0, endMeterValue - distance);
    runningMeter = startMeterValue;
    return { startMeter: `${formatOneDecimal(startMeterValue)} mi`, endMeter: `${formatOneDecimal(endMeterValue)} mi` };
  };

  return [
    { date: "Jul 22", from: `Depot - ${city}`, to: `Client Site - ${city}`, ...buildMeters(tripDistances[0]), distance: `${tripDistances[0].toFixed(1)} mi`, duration: `${24 + (seed % 9)} min`, driver: fleetDriverName(vehicle, 0) },
    { date: "Jul 21", from: `Client Site - ${city}`, to: `Depot - ${city}`, ...buildMeters(tripDistances[1]), distance: `${tripDistances[1].toFixed(1)} mi`, duration: `${19 + (seed % 6)} min`, driver: fleetDriverName(vehicle, 0) },
    { date: "Jul 19", from: `Depot - ${city}`, to: `Warehouse - ${city}`, ...buildMeters(tripDistances[2]), distance: `${tripDistances[2].toFixed(1)} mi`, duration: `${32 + (seed % 10)} min`, driver: fleetDriverName(vehicle, 1) },
    { date: "Jul 17", from: `Warehouse - ${city}`, to: `Depot - ${city}`, ...buildMeters(tripDistances[3]), distance: `${tripDistances[3].toFixed(1)} mi`, duration: `${30 + (seed % 9)} min`, driver: fleetDriverName(vehicle, 1) },
    { date: "Jul 15", from: `Depot - ${city}`, to: `Regional Office - ${city}`, ...buildMeters(tripDistances[4]), distance: `${tripDistances[4].toFixed(1)} mi`, duration: `${26 + (seed % 8)} min`, driver: fleetDriverName(vehicle, 2) },
    { date: "Jul 13", from: `Regional Office - ${city}`, to: `Service Hub - ${city}`, ...buildMeters(tripDistances[5]), distance: `${tripDistances[5].toFixed(1)} mi`, duration: `${28 + (seed % 7)} min`, driver: fleetDriverName(vehicle, 3) },
  ];
}

function fleetMaintenanceNotice(vehicle: FleetVehicle): string {
  const seed = fleetSeed(vehicle);
  const services = ["Tire rotation & balance", "Brake fluid inspection", "Air filter replacement", "Multi-point inspection"];
  const service = services[seed % services.length];
  const dueMileage = nextServiceMileage(vehicle);
  return `Next service due: ${service} \u00b7 est. ${formatWholeNumber(dueMileage)} mi`;
}

function fleetMaintenanceRows(vehicle: FleetVehicle): FleetMaintenanceRow[] {
  const mileage = fleetMileageValue(vehicle);
  const dueMileage = nextServiceMileage(vehicle);
  return [
    { date: "Jun 28, 2026", service: "Oil & filter change", odometer: `${formatWholeNumber(Math.max(0, mileage - 2700))} mi`, cost: "$85", status: "Completed" },
    { date: "Mar 14, 2026", service: "Brake pad replacement (front)", odometer: `${formatWholeNumber(Math.max(0, mileage - 6050))} mi`, cost: "$340", status: "Completed" },
    { date: "Dec 02, 2025", service: "Annual inspection", odometer: `${formatWholeNumber(Math.max(0, mileage - 11500))} mi`, cost: "$120", status: "Completed" },
    { date: "Aug 30, 2026", service: fleetMaintenanceNotice(vehicle).split(": ")[1].split(" \u00b7 ")[0], odometer: `est. ${formatWholeNumber(dueMileage)} mi`, cost: "\u2014", status: "Scheduled" },
  ];
}

function fleetCostDistribution(vehicle: FleetVehicle): FleetCostDistributionPoint[] {
  const items = fleetCostItems(vehicle);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return items.map((item) => ({
    label: item.label,
    displayLabel: `${Math.round((item.value / total) * 100)}%`,
    percentage: `${Math.round((item.value / total) * 100)}%`,
    value: item.value,
    tone: item.tone,
  }));
}

function fleetTotalCost(vehicle: FleetVehicle): string {
  const total = fleetCostItems(vehicle).reduce((sum, item) => sum + item.value, 0);
  return `$${total.toLocaleString("en-US")}`;
}

function fleetTopCostCategory(distribution: readonly FleetCostDistributionPoint[]): string {
  const top = distribution.reduce((max, point) => (point.value > max.value ? point : max));
  return `${top.label} \u00b7 ${top.percentage}`;
}

function fleetPeakSpendMonth(monthlySpend: readonly FleetMonthlySpendPoint[]): string {
  const peak = monthlySpend.reduce((max, point) => (point.spend > max.spend ? point : max));
  return `${peak.month} \u00b7 $${peak.spend.toLocaleString("en-US")}`;
}

function fleetMonthlyOperatingSpend(vehicle: FleetVehicle): FleetMonthlySpendPoint[] {
  const seed = fleetSeed(vehicle);
  const seasonalBase = [118, 148, 208, 238, 218, 258, 278, 208, 188, 228, 208, 178];
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((month, index) => {
    const variability = ((seed + index * 7) % 5) * 10;
    const maintenanceAdjustment = vehicle.status === "In Maintenance" && (index === 6 || index === 7) ? 22 : 0;
    const utilizationAdjustment = vehicle.status === "Available" && index >= 8 ? -12 : 0;
    return { month, spend: seasonalBase[index] + variability + maintenanceAdjustment + utilizationAdjustment };
  });
}

function fleetUtilizationSummary(vehicle: FleetVehicle): FleetDetail["utilization"] {
  const seed = fleetSeed(vehicle);
  const rateValue = Math.max(52, 76 - (vehicle.status === "In Maintenance" ? 9 : 0) - (vehicle.status === "Available" ? 4 : 0) + (seed % 5));
  const activeHours = 92 + (seed % 16) * 2;
  const idleHours = Math.max(18, 44 - (seed % 7) * 2 + (vehicle.status === "Available" ? 8 : 0));
  return { rate: `${rateValue}%`, activeHours: `${activeHours}h`, idleHours: `${idleHours}h`, trips: 18 + (seed % 8) };
}

function fleetUtilizationSeries(vehicle: FleetVehicle): FleetUtilizationComparisonPoint[] {
  const seed = fleetSeed(vehicle);
  const priorBase = 160 + (seed % 5) * 14;
  const uplift = 18 + (seed % 4) * 9;

  return [
    { month: "Jan", priorYear: priorBase, currentYear: priorBase + 42 },
    { month: "Feb", priorYear: priorBase + 22, currentYear: priorBase + 4 },
    { month: "Mar", priorYear: priorBase + 140, currentYear: priorBase + 118 },
    { month: "Apr", priorYear: priorBase + 316, currentYear: priorBase + 278 },
    { month: "May", priorYear: priorBase + 418, currentYear: priorBase + 472 },
    { month: "Jun", priorYear: priorBase + 502, currentYear: priorBase + 564 },
    { month: "Jul", priorYear: priorBase + 560, currentYear: priorBase + 586 + (vehicle.status === "In Maintenance" ? -24 : uplift) },
    { month: "Aug", priorYear: priorBase + 594, currentYear: priorBase + 650 + (vehicle.status === "Available" ? -22 : uplift) },
    { month: "Sep", priorYear: priorBase + 506, currentYear: priorBase + 480 + (vehicle.status === "Available" ? -38 : 0) },
    { month: "Oct", priorYear: priorBase + 442, currentYear: priorBase + 646 },
    { month: "Nov", priorYear: priorBase + 154, currentYear: priorBase + 354 },
    { month: "Dec", priorYear: priorBase + 52, currentYear: priorBase + 198 },
  ];
}

function fleetUtilizationYoY(vehicle: FleetVehicle): string {
  const series = fleetUtilizationSeries(vehicle);
  const prior = series.reduce((total, point) => total + point.priorYear, 0);
  const current = series.reduce((total, point) => total + point.currentYear, 0);
  if (prior === 0) return "";

  const change = ((current - prior) / prior) * 100;
  return `${change >= 0 ? "\u2191" : "\u2193"} ${Math.abs(change).toFixed(1)}% YoY`;
}

function fleetCostItems(vehicle: FleetVehicle): FleetCostItem[] {
  const seed = fleetSeed(vehicle);
  const maintenanceBase = vehicle.status === "In Maintenance" ? 520 : 280;

  return [
    { label: "Fuel / charging", value: 360 + (seed % 5) * 26, tone: "fuel" },
    { label: "Maintenance", value: maintenanceBase + (seed % 4) * 25, tone: "maintenance" },
    { label: "Insurance", value: 180 + (seed % 3) * 30, tone: "insurance" },
    { label: "Tolls & fees", value: 54 + (seed % 6) * 7, tone: "tolls" },
  ];
}

function fleetSeed(vehicle: FleetVehicle): number {
  return Number(vehicle.id.replace(/\D/g, "")) || 1;
}

function fleetCity(vehicle: FleetVehicle): string {
  return vehicle.locationCity.split(",")[0];
}

function fleetMileageValue(vehicle: FleetVehicle): number {
  return Number(vehicle.specs.mileage.replace(/[^\d]/g, "")) || 0;
}

function nextServiceMileage(vehicle: FleetVehicle): number {
  const mileage = fleetMileageValue(vehicle);
  return Math.ceil((mileage + 3200) / 5000) * 5000;
}

function fleetDriverName(vehicle: FleetVehicle, offset: number): string {
  const drivers = ["M. Alvarez", "R. Chen", "S. Patel", "J. Walker", "A. Brooks", "T. Nguyen"];
  return drivers[(fleetSeed(vehicle) + offset) % drivers.length];
}

function formatWholeNumber(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatOneDecimal(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
