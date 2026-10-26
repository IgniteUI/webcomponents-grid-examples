import { LitElement, PropertyValues, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { createRef, ref } from "lit/directives/ref.js";
import { IgcCardComponent, IgcIconComponent, IgcTabsComponent, IgcTooltipComponent, defineComponents } from "igniteui-webcomponents";
import {
  IgcCategoryChartComponent,
  IgcCategoryChartModule,
  IgcDataChartInteractivityModule,
  IgcDoughnutChartComponent,
  IgcDoughnutChartModule,
} from "igniteui-webcomponents-charts";
import { ModuleManager } from "igniteui-webcomponents-core";
import { FLEET_CHART_THEMES, type FleetTheme } from "./chart-themes.js";
import { FLEET_ICON_COLLECTION } from "./icons.js";
import {
  type FleetCostDistributionPoint,
  fleetCostToneClass,
  fleetCurrencyAxisLabel,
  fleetDetail,
  fleetMaintenanceStatusClass,
} from "./data/fleet-detail.js";
import { FleetDataService, type FleetVehicle } from "./data/fleet-service.js";

defineComponents(IgcCardComponent, IgcIconComponent, IgcTabsComponent, IgcTooltipComponent);

ModuleManager.register(IgcCategoryChartModule, IgcDoughnutChartModule, IgcDataChartInteractivityModule);

const CHART_FONT = "500 12px 'DM Sans', sans-serif";

/** The share of the ring's outer radius that the donut's hole takes (the chart's `innerExtent`). */
const DONUT_INNER_EXTENT = 62;

/** The slice under the pointer, and where the pointer is in the donut's box. */
interface SliceHover {
  item: FleetCostDistributionPoint;
  x: number;
  y: number;
}

/**
 * Everything an expanded grid row shows: the vehicle's details, trips, maintenance, costs
 * and utilization in five tabs.
 *
 * It renders into its own light DOM, so the sample's stylesheet reaches it directly, and
 * it owns the charts: they poll their size until they are destroyed, so they are torn down
 * when the row collapses, the grid recycles the element for another vehicle, or the
 * appearance changes and they have to be created again.
 */
@customElement("fleet-management-new-detail")
export default class FleetVehicleDetail extends LitElement {
  @property({ attribute: false }) vehicle!: FleetVehicle;
  @property({ attribute: false }) theme: FleetTheme = "dark";
  /** Vehicles whose every photo failed to load; they fall back to the placeholder. */
  @property({ attribute: false }) failedPhotos: Set<string> = new Set();

  /** Charts exist only while their tab is showing, as the tabs keep no content for hidden panels. */
  @state() private selectedTab = "details";

  @state() private sliceHover?: SliceHover;

  /** Where the donut's ring is, as the chart last laid it out. */
  private donutRing?: { x: number; y: number; inner: number; outer: number };

  /** Part of the charts' key: a destroyed chart cannot be revived, so new ones are made after one. */
  private chartEpoch = 0;

  private readonly donutRef = createRef<HTMLElement>();
  private readonly tooltipAnchorRef = createRef<HTMLElement>();

  /** Relative to today so the sample does not date itself. */
  private readonly utilizationYears = ((current: number) => ({ current, prior: current - 1 }))(
    new Date().getFullYear()
  );

  private readonly fleetData = FleetDataService.shared;

  protected createRenderRoot(): HTMLElement {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    // A destroyed chart cannot be revived, so an element the grid attaches again starts afresh.
    if (this.hasUpdated) {
      this.requestUpdate();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    // The grid moves detail views while it updates a row, taking them out and putting them back
    // in one go, and a chart survives that. Only a view that is still out of the document once
    // the grid is done with it is torn down.
    queueMicrotask(() => {
      if (!this.isConnected) {
        this.destroyCharts();
      }
    });
  }

  protected willUpdate(changed: PropertyValues<this>): void {
    // The charts are re-created for a new vehicle or appearance; the old ones go first.
    if (changed.has("theme") || changed.has("vehicle")) {
      this.destroyCharts();
    }
  }

  /**
   * Tears the charts down and takes them out of the view. A destroyed chart throws when it
   * is connected again, and the grid puts a collapsed row's view back as it is when the row
   * is expanded again, so a dead chart must not be left in it for that to find.
   */
  private destroyCharts(): void {
    for (const chart of this.querySelectorAll<IgcCategoryChartComponent>("igc-category-chart")) {
      chart.destroy();
      chart.remove();
    }
    for (const chart of this.querySelectorAll<IgcDoughnutChartComponent>("igc-doughnut-chart")) {
      chart.ngOnDestroy();
      chart.remove();
    }
    this.chartEpoch++;
    this.donutRing = undefined;
    this.sliceHover = undefined;
  }

  private onTabChange(event: CustomEvent<HTMLElement>): void {
    const key = event.detail.dataset.tab;
    if (key && key !== this.selectedTab) {
      // The charts of the tab being left go before their elements do.
      this.destroyCharts();
      this.selectedTab = key;
    }
  }

  /**
   * The photo and the colour both come from `vehicle.photoKey`, so they cannot contradict
   * each other. An empty string means "no photo to show": the catalog has not loaded, does
   * not carry the folder, or every shot in it failed.
   */
  private photoUrl(vehicle: FleetVehicle): string {
    if (this.failedPhotos.has(vehicle.id)) return "";
    return this.fleetData.vehiclePhotoUrls(vehicle)[0] ?? "";
  }

  /**
   * Steps to the next shot in the pinned folder. Every file there is the same car, so a
   * fallback changes the angle and never the colour.
   */
  private onPhotoError(event: Event, vehicle: FleetVehicle): void {
    const target = event.target;
    if (!(target instanceof HTMLImageElement)) return;

    const photoUrls = this.fleetData.vehiclePhotoUrls(vehicle);
    const nextIndex = Number(target.dataset["photoIndex"] ?? "0") + 1;

    if (nextIndex >= photoUrls.length) {
      this.failedPhotos.add(vehicle.id);
      this.requestUpdate();
      return;
    }

    target.dataset["photoIndex"] = String(nextIndex);
    target.src = photoUrls[nextIndex];
  }

  protected render() {
    const vehicle = this.vehicle;
    if (!vehicle) return nothing;
    const detail = fleetDetail(vehicle);
    const color = this.fleetData.vehicleColor(vehicle);
    const photoUrl = this.photoUrl(vehicle);
    const [doors, seats] = vehicle.specs.doorsSeats.split(" / ");

    return html`
      <div class="fleet-detail-wrap">
        <igc-tabs class="fleet-detail-tabs" @igcChange=${this.onTabChange}>
          <igc-tab selected label="Details" data-tab="details">
            <div class="fleet-detail-content">
              <igc-card class="fleet-vehicle-card">
                <igc-card-content>
                  <div class="fleet-vehicle-illustration">
                    ${photoUrl
                      ? html`<img
                          class="fleet-vehicle-photo"
                          src=${photoUrl}
                          alt="${color.name} ${vehicle.make} ${vehicle.model}"
                          loading="lazy"
                          decoding="async"
                          @error=${(event: Event) => this.onPhotoError(event, vehicle)}
                        />`
                      : html`<div class="fleet-vehicle-photo fleet-vehicle-photo-empty">
                          <igc-icon name="directions_car" collection=${FLEET_ICON_COLLECTION} aria-hidden="true"></igc-icon>
                          <span>Photo unavailable</span>
                        </div>`}
                  </div>
                </igc-card-content>
              </igc-card>

              <div class="fleet-spec-grid">
                <div class="fleet-spec-item"><span>Make</span><strong>${vehicle.make}</strong></div>
                <div class="fleet-spec-item"><span>Engine</span><strong>${vehicle.specs.engine}</strong></div>
                <div class="fleet-spec-item"><span>Generation</span><strong>${vehicle.specs.generation}</strong></div>
                <div class="fleet-spec-item"><span>Year</span><strong>${vehicle.specs.year}</strong></div>
                <div class="fleet-spec-item"><span>Fuel Type</span><strong>${vehicle.specs.fuelType}</strong></div>
                <div class="fleet-spec-item"><span>Power</span><strong>${vehicle.specs.power}</strong></div>
                <div class="fleet-spec-item"><span>Mileage</span><strong>${vehicle.specs.mileage}</strong></div>
                <div class="fleet-spec-item"><span>Doors</span><strong>${doors}</strong></div>
                <div class="fleet-spec-item"><span>Seats</span><strong>${seats}</strong></div>
                <div class="fleet-spec-item"><span>Engine Displacement</span><strong>${vehicle.specs.cubature}</strong></div>
                <!-- The swatch is decorative: the colour name beside it carries the meaning. -->
                <div class="fleet-spec-item">
                  <span>Color</span>
                  <strong class="fleet-spec-color"
                    ><span class="fleet-color-swatch" style="background-color: ${color.hex}" aria-hidden="true"></span
                    >${color.name}</strong
                  >
                </div>
                <div class="fleet-spec-item"><span>Transmission</span><strong>${vehicle.specs.transmission}</strong></div>
                <div class="fleet-spec-item"><span>MSRP</span><strong>${vehicle.specs.msrp}</strong></div>
                <div class="fleet-spec-item"><span>Toll Pass ID</span><strong>${vehicle.specs.tollPassId}</strong></div>
                <div class="fleet-spec-item"><span>Body Type</span><strong>${vehicle.type}</strong></div>
              </div>
            </div>
          </igc-tab>

          <igc-tab label="Trip History" data-tab="trips">
            <div class="fleet-tab-panel">
              <div class="fleet-tab-kpis fleet-tab-kpis-3up">
                <div class="fleet-tab-kpi"><span>Trips \u2014 Last 30 Days</span><strong>${detail.tripSummary.trips}</strong></div>
                <div class="fleet-tab-kpi"><span>Total distance</span><strong>${detail.tripSummary.totalDistance}</strong></div>
                <div class="fleet-tab-kpi"><span>Avg trip</span><strong>${detail.tripSummary.avgTrip}</strong></div>
              </div>

              <table class="fleet-detail-table fleet-trip-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Driver</th>
                    <th>Start Odometer</th>
                    <th>End Odometer</th>
                    <th>Distance</th>
                    <th class="status-cell">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  ${detail.tripRows.map(
                    (trip) => html`
                      <tr>
                        <td>${trip.date}</td>
                        <td>${trip.from}</td>
                        <td>${trip.to}</td>
                        <td>${trip.driver}</td>
                        <td>${trip.startMeter}</td>
                        <td>${trip.endMeter}</td>
                        <td>${trip.distance}</td>
                        <td class="status-cell">${trip.duration}</td>
                      </tr>
                    `
                  )}
                </tbody>
              </table>
            </div>
          </igc-tab>

          <igc-tab label="Maintenance" data-tab="maintenance">
            <div class="fleet-tab-panel">
              <div class="fleet-maintenance-alert">
                <igc-icon name="build" collection=${FLEET_ICON_COLLECTION} aria-hidden="true"></igc-icon>
                <span>${detail.maintenanceNotice}</span>
              </div>

              <table class="fleet-detail-table fleet-maintenance-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Service</th>
                    <th>Odometer</th>
                    <th>Cost</th>
                    <th class="status-cell">Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${detail.maintenanceRows.map(
                    (entry) => html`
                      <tr>
                        <td>${entry.date}</td>
                        <td>${entry.service}</td>
                        <td>${entry.odometer}</td>
                        <td>${entry.cost}</td>
                        <td class="status-cell">
                          <span class="fleet-detail-pill ${fleetMaintenanceStatusClass(entry.status)}">${entry.status}</span>
                        </td>
                      </tr>
                    `
                  )}
                </tbody>
              </table>
            </div>
          </igc-tab>

          <igc-tab label="Cost" data-tab="cost">
            <div class="fleet-tab-panel">
              <div class="fleet-tab-kpis fleet-tab-kpis-3up">
                <div class="fleet-tab-kpi"><span>Total cost \u2014 YTD</span><strong class="fleet-accent-value">${detail.totalCost}</strong></div>
                <div class="fleet-tab-kpi"><span>Largest category</span><strong>${detail.topCostCategory}</strong></div>
                <div class="fleet-tab-kpi"><span>Peak month</span><strong>${detail.peakSpendMonth}</strong></div>
              </div>

              <div class="fleet-cost-charts">
                <section class="fleet-cost-panel">
                  <div class="fleet-cost-donut-layout">
                    <div class="fleet-cost-donut-legend" aria-label="Cost distribution legend">
                      <div class="fleet-cost-panel-title">Cost Breakdown \u2014 YTD</div>
                      ${detail.costDistribution.map(
                        (item) => html`
                          <div class="fleet-cost-donut-legend-item">
                            <span class="fleet-cost-donut-legend-main">
                              <span class="fleet-cost-dot ${fleetCostToneClass(item.tone)}"></span>
                              <span>${item.label}</span>
                            </span>
                            <strong>${item.percentage}</strong>
                          </div>
                        `
                      )}
                    </div>
                    ${this.selectedTab === "cost" ? this.renderDonut() : nothing}
                  </div>
                </section>

                <section class="fleet-cost-panel">
                  <div class="fleet-cost-panel-title">Monthly Operating Cost</div>
                  ${this.selectedTab === "cost" ? this.renderSpendChart() : nothing}
                </section>
              </div>
            </div>
          </igc-tab>

          <igc-tab label="Utilization" data-tab="utilization">
            <div class="fleet-tab-panel">
              <div class="fleet-tab-kpis fleet-tab-kpis-4up">
                <div class="fleet-tab-kpi"><span>Utilization rate</span><strong class="fleet-accent-value">${detail.utilization.rate}</strong></div>
                <div class="fleet-tab-kpi"><span>Active hours</span><strong>${detail.utilization.activeHours}</strong></div>
                <div class="fleet-tab-kpi"><span>Idle hours</span><strong>${detail.utilization.idleHours}</strong></div>
                <div class="fleet-tab-kpi"><span>Trips this month</span><strong>${detail.utilization.trips}</strong></div>
              </div>

              <div class="fleet-utilization-wrap">
                <div class="fleet-utilization-title">
                  Monthly Active Hours \u2014 ${this.utilizationYears.current} vs ${this.utilizationYears.prior} ${detail.utilizationYoY}
                </div>
                <div class="fleet-utilization-legend" aria-label="Utilization comparison legend">
                  <span class="fleet-utilization-legend-item"
                    ><span class="fleet-utilization-legend-swatch fleet-utilization-legend-swatch-current"></span
                    ><span>${this.utilizationYears.current}</span></span
                  >
                  <span class="fleet-utilization-legend-item"
                    ><span class="fleet-utilization-legend-swatch fleet-utilization-legend-swatch-prior"></span
                    ><span>${this.utilizationYears.prior}</span></span
                  >
                </div>
                ${this.selectedTab === "utilization" ? this.renderUtilizationChart() : nothing}
              </div>
            </div>
          </igc-tab>
        </igc-tabs>
      </div>
    `;
  }

  /** Charts are re-created when the vehicle or the appearance changes, so the colours reach the canvas. */
  private chartKey(): string {
    return `${this.vehicle.id}:${this.theme}:${this.chartEpoch}`;
  }

  private readonly onHoleDimensionsChanged = (_chart: unknown, args: { center: { x: number; y: number }; radius: number }): void => {
    this.donutRing = {
      x: args.center.x,
      y: args.center.y,
      inner: args.radius,
      outer: args.radius / (DONUT_INNER_EXTENT / 100),
    };
  };

  /**
   * The donut's own tooltip. The chart's slice tooltip cannot take a template (it throws as
   * soon as the pointer enters a slice), so the slice under the pointer is worked out from
   * the ring's geometry and described in an Ignite UI tooltip anchored at the pointer. The
   * package default would read "value : 812" off the member paths; the slice already carries
   * its share as a label, so the tooltip is the one place the money itself can be named.
   */
  private onDonutPointerMove(event: PointerEvent): void {
    const ring = this.donutRing;
    const box = this.donutRef.value?.getBoundingClientRect();
    if (!ring || !box) return;

    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const distance = Math.hypot(x - ring.x, y - ring.y);
    if (distance < ring.inner || distance > ring.outer) {
      this.sliceHover = undefined;
      return;
    }

    // Slices run clockwise from the three o'clock position, in data order.
    const turn = ((Math.atan2(y - ring.y, x - ring.x) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI);
    const slices = fleetDetail(this.vehicle).costDistribution;
    const total = slices.reduce((sum, slice) => sum + slice.value, 0);
    let reached = 0;
    const item = slices.find((slice) => (reached += slice.value / total) > turn);
    this.sliceHover = item ? { item, x, y } : undefined;
  }

  /**
   * Only the chart is keyed. The host (whose pointer events drive the tooltip), the anchor and
   * the tooltip are one instance for as long as the Cost tab shows: keying them too would make
   * Lit drop the old instance without releasing it, and the destroyed chart and its canvases
   * would stay referenced.
   */
  private renderDonut() {
    const palette = FLEET_CHART_THEMES[this.theme];
    const detail = fleetDetail(this.vehicle);
    const hover = this.sliceHover;
    return html`
      <div
        class="fleet-cost-donut-host"
        ${ref(this.donutRef)}
        @pointermove=${this.onDonutPointerMove}
        @pointerleave=${() => (this.sliceHover = undefined)}
      >
        ${keyed(
          this.chartKey(),
          html`
            <igc-doughnut-chart
              class="fleet-cost-donut"
              width="100%"
              height="280px"
              .allowSliceSelection=${false}
              .allowSliceExplosion=${false}
              .innerExtent=${DONUT_INNER_EXTENT}
              .holeDimensionsChanged=${this.onHoleDimensionsChanged}
            >
              <igc-ring-series
                .dataSource=${detail.costDistribution}
                value-member-path="value"
                label-member-path="displayLabel"
                labels-position="Center"
                leader-line-visibility="Collapsed"
                label-inner-color=${palette.onBrush}
                .brushes=${palette.cost}
                .outlines=${palette.cost}
                text-style="600 12px 'DM Sans', sans-serif"
              ></igc-ring-series>
            </igc-doughnut-chart>
          `
        )}
        <span
          class="fleet-slice-anchor"
          ${ref(this.tooltipAnchorRef)}
          style="left: ${hover ? hover.x + 15 : 0}px; top: ${hover ? hover.y : 0}px"
        ></span>
        <igc-tooltip
          class="fleet-chart-tooltip-box"
          placement="bottom-start"
          .offset=${13}
          .showDelay=${-1}
          .hideDelay=${-1}
          show-triggers=""
          hide-triggers=""
          .anchor=${this.tooltipAnchorRef.value}
          ?open=${!!hover}
        >
          ${hover
            ? html`<div class="fleet-chart-tooltip">
                <span class="fleet-chart-tooltip-label">${hover.item.label}</span>
                <span class="fleet-chart-tooltip-value">${fleetCurrencyAxisLabel(hover.item.value)} \u00b7 ${hover.item.percentage}</span>
              </div>`
            : nothing}
        </igc-tooltip>
      </div>
    `;
  }

  private renderSpendChart() {
    const palette = FLEET_CHART_THEMES[this.theme];
    const detail = fleetDetail(this.vehicle);
    // `crosshairsAnnotation*TextColor` is set on both category charts, here and on
    // Utilization. The bubble the crosshair puts on the axis under the cursor is painted
    // in the series brush, and left alone the engine auto-contrasts its text between a
    // hardcoded #666 and white - which on the accent picks the gray and lands at 2.7:1.
    // Naming the colour outright skips that choice. The background stays the brush, so
    // the bubble is still colour-coded to the series it is reading.
    return keyed(
      this.chartKey(),
      html`
        <igc-category-chart
          class="fleet-cost-column-chart"
          width="100%"
          height="280px"
          chart-type="Column"
          x-axis-label="month"
          .dataSource=${detail.monthlySpend}
          .includedProperties=${["spend"]}
          .yAxisMinimumValue=${0}
          .yAxisFormatLabel=${fleetCurrencyAxisLabel}
          .isTransitionInEnabled=${false}
          .brushes=${palette.spend}
          .outlines=${palette.spend}
          x-axis-label-text-style=${CHART_FONT}
          y-axis-label-text-style=${CHART_FONT}
          x-axis-label-text-color=${palette.label}
          y-axis-label-text-color=${palette.label}
          x-axis-major-stroke=${palette.gridline}
          y-axis-major-stroke=${palette.gridline}
          .xAxisMajorStrokeThickness=${1}
          .yAxisMajorStrokeThickness=${1}
          crosshairs-annotation-x-axis-text-color=${palette.onBrush}
          crosshairs-annotation-y-axis-text-color=${palette.onBrush}
          .isHorizontalZoomEnabled=${false}
          .isVerticalZoomEnabled=${false}
          .thickness=${1}
        ></igc-category-chart>
      `
    );
  }

  private renderUtilizationChart() {
    const palette = FLEET_CHART_THEMES[this.theme];
    const detail = fleetDetail(this.vehicle);
    return keyed(
      this.chartKey(),
      html`
        <igc-category-chart
          class="fleet-utilization-comparison-chart"
          width="100%"
          height="320px"
          chart-type="Column"
          x-axis-label="month"
          .dataSource=${detail.utilizationSeries}
          .includedProperties=${["currentYear", "priorYear"]}
          .yAxisMinimumValue=${0}
          .isTransitionInEnabled=${false}
          .brushes=${palette.utilization}
          .outlines=${palette.utilization}
          x-axis-label-text-style=${CHART_FONT}
          y-axis-label-text-style=${CHART_FONT}
          x-axis-label-text-color=${palette.label}
          y-axis-label-text-color=${palette.label}
          x-axis-major-stroke=${palette.gridline}
          y-axis-major-stroke=${palette.gridline}
          .xAxisMajorStrokeThickness=${1}
          .yAxisMajorStrokeThickness=${1}
          crosshairs-annotation-x-axis-text-color=${palette.onBrush}
          crosshairs-annotation-y-axis-text-color=${palette.onBrush}
          .isHorizontalZoomEnabled=${false}
          .isVerticalZoomEnabled=${false}
          .thickness=${1}
        ></igc-category-chart>
      `
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "fleet-management-new-detail": FleetVehicleDetail;
  }
}
