import { LitElement, PropertyValues, html, unsafeCSS } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import {
  IgcBadgeComponent,
  IgcButtonComponent,
  IgcButtonGroupComponent,
  IgcChipComponent,
  IgcDialogComponent,
  IgcIconButtonComponent,
  IgcIconComponent,
  IgcInputComponent,
  IgcSnackbarComponent,
  IgcToggleButtonComponent,
  configureTheme,
  defineComponents,
} from "igniteui-webcomponents";
import {
  IgcActionStripComponent,
  IgcCellTemplateContext,
  IgcGridComponent,
  IgcGridMasterDetailContext,
  IgcGridStateComponent,
} from "igniteui-webcomponents-grids/grids";
import "igniteui-webcomponents-grids/grids/combined.js";
import type { FleetTheme } from "./chart-themes.js";
import { FleetDataService, type FleetStatus, type FleetVehicle } from "./data/fleet-service.js";
import "./fleet-vehicle-detail.js";
import { FLEET_ICON_COLLECTION, registerFleetIcons } from "./icons.js";
import { prepareGridShadowRoot } from "./grid-shadow-root.js";
import styles from "./fleet-management-new.scss?inline";

defineComponents(
  IgcBadgeComponent,
  IgcButtonComponent,
  IgcButtonGroupComponent,
  IgcChipComponent,
  IgcDialogComponent,
  IgcIconButtonComponent,
  IgcIconComponent,
  IgcInputComponent,
  IgcSnackbarComponent,
  IgcToggleButtonComponent
);

type FleetStatusFilter = "all" | FleetStatus;

type FleetSize = "small" | "medium" | "large";

const FONTS_HREF = "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&display=swap";

/** Adds a stylesheet link to the document head once; fonts declared in a shadow root are ignored. */
function ensureDocumentStylesheet(href: string): void {
  const exists = Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).some(
    (link) => link.href === href
  );
  if (!exists) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.append(link);
  }
}

const FLEET_SIZES: readonly FleetSize[] = ["small", "medium", "large"];

const FLEET_DEFAULT_SIZE: FleetSize = "medium";

const FLEET_DEFAULT_THEME: FleetTheme = "dark";

/** How long a notification stays on screen. */
const NOTICE_DISPLAY_MS = 3000;

/**
 * How each status presents. The badge is a bare dot - `igc-badge`'s own `dot` mode, so
 * the size tracks `--ig-size` with the rest of the sample rather than being pinned here -
 * and the status word beside it carries the meaning. The dot is `aria-hidden`, which is
 * why dropping the icons costs nothing: the cell already read as its text to a screen
 * reader, and colour was never the only channel.
 */
interface FleetStatusBadge {
  variant: "info" | "success" | "warning";
  /** Only the state that needs acting on draws attention to itself. */
  pulse: boolean;
}

const FLEET_STATUS_BADGES: Record<FleetStatus, FleetStatusBadge> = {
  Active: { variant: "info", pulse: false },
  Available: { variant: "success", pulse: false },
  "In Maintenance": { variant: "warning", pulse: true },
};

/** One action per status the row is not already in, so every status stays reachable from every other one. */
const FLEET_ROW_ACTIONS: ReadonlyArray<{ status: FleetStatus; icon: string; title: string; className: string }> = [
  { status: "Active", icon: "play_circle", title: "Put back in service", className: "fleet-row-action-active" },
  { status: "Available", icon: "check_circle", title: "Mark available", className: "fleet-row-action-available" },
  { status: "In Maintenance", icon: "build", title: "Send to maintenance", className: "fleet-row-action-maintenance" },
];

/** New Fleet Management: a master-detail vehicle grid with status filters, search and per-vehicle detail tabs. */
@customElement("app-fleet-management-new")
export default class FleetManagementNew extends LitElement {
  static styles = unsafeCSS(styles);

  private readonly fleetData = FleetDataService.shared;

  @state() private fleetTheme: FleetTheme = FLEET_DEFAULT_THEME;
  @state() private fleetSize: FleetSize = FLEET_DEFAULT_SIZE;
  @state() private statusFilter: FleetStatusFilter = "all";
  @state() private searchQuery = "";
  @state() private vehicles: FleetVehicle[] = this.fleetData.vehicles;
  @state() private notice = "";
  /** The vehicle the row-action strip currently belongs to (the row under the pointer). */
  @state() private actionVehicle?: FleetVehicle;

  @query("igc-grid") private grid!: IgcGridComponent;
  @query("igc-grid-state") private gridState!: IgcGridStateComponent;
  @query("igc-action-strip") private actionStrip!: IgcActionStripComponent;
  @query("igc-snackbar") private snackbar!: IgcSnackbarComponent;
  @query("igc-dialog") private resetDialog!: IgcDialogComponent;
  @query(".fleet-reset-confirm") private resetConfirmButton!: IgcButtonComponent;

  /** Vehicles whose every photo failed to load; they fall back to the placeholder. */
  private readonly failedPhotos = new Set<string>();

  /** The untouched grid layout, serialized so every restore parses its own copy. */
  private pristineGridState?: string;

  private noticeTimer?: ReturnType<typeof setTimeout>;
  /** The pending search of the grid, which waits for the new rows to be applied. */
  private searchTimer?: ReturnType<typeof setTimeout>;
  /** Settles when the snackbar's last hide has finished its fade-out. */
  private noticeHidden?: Promise<boolean>;
  /** The frame that works out which row the action strip belongs to, while one is pending. */
  private actionSyncFrame = 0;

  private searchedVehicles: FleetVehicle[] = [];
  private filteredVehicles: FleetVehicle[] = [];
  private appliedSize: FleetSize = FLEET_DEFAULT_SIZE;

  connectedCallback(): void {
    // Theme and icons are set up when the sample is shown, not on import: the shell
    // bundle loads every sample's module into every page.
    configureTheme("fluent", "light");
    registerFleetIcons();
    ensureDocumentStylesheet(FONTS_HREF);
    super.connectedCallback();
    void this.fleetData.loadVehicleImageCatalog().then((loaded) => {
      // Rows expanded before the catalog arrived show their photos now.
      if (loaded) this.renderRoot.querySelectorAll("fleet-management-new-detail").forEach((detail) => detail.requestUpdate());
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.noticeTimer);
    clearTimeout(this.searchTimer);
    cancelAnimationFrame(this.actionSyncFrame);
    this.actionSyncFrame = 0;
  }

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has("vehicles") || changed.has("searchQuery")) {
      const query = this.searchQuery.trim().toLowerCase();
      this.searchedVehicles = query
        ? this.vehicles.filter((vehicle) => {
            const target = [vehicle.id, vehicle.licensePlate, vehicle.vin, vehicle.make, vehicle.model, vehicle.locationCity];
            return target.join(" ").toLowerCase().includes(query);
          })
        : this.vehicles;
    }
    if (changed.has("vehicles") || changed.has("searchQuery") || changed.has("statusFilter")) {
      this.filteredVehicles =
        this.statusFilter === "all"
          ? this.searchedVehicles
          : this.searchedVehicles.filter((vehicle) => vehicle.status === this.statusFilter);
    }
    // The appearance and the density are classes on the host, which the styles key on.
    if (changed.has("fleetTheme")) {
      this.classList.toggle("light-theme", this.fleetTheme === "light");
    }
    if (changed.has("fleetSize")) {
      this.classList.toggle("fleet-size-small", this.fleetSize === "small");
      this.classList.toggle("fleet-size-large", this.fleetSize === "large");
    }
  }

  firstUpdated(): void {
    prepareGridShadowRoot(this.renderRoot as ShadowRoot);
    // Sorting, pinning, hiding, column order, filters and expanded rows live on the grid
    // rather than in the data, so reset needs a snapshot of them taken before the user
    // can touch anything.
    this.grid.addEventListener(
      "childrenResolved",
      () => {
        // The declared columns exist from here on; a snapshot taken earlier would hold none.
        this.pristineGridState = this.gridState.getStateAsString();
      },
      { once: true }
    );
    // The grid moves its action strip into the row under the pointer when that row's own
    // mouseenter has run, which is after the mouseover that gets here.
    // Mouse movement fires it constantly, so it shares one pending frame.
    this.grid.addEventListener("mouseover", () => {
      if (this.actionSyncFrame) return;
      this.actionSyncFrame = requestAnimationFrame(() => {
        this.actionSyncFrame = 0;
        this.syncActionVehicle();
      });
    });
  }

  protected updated(changed: PropertyValues): void {
    // The query filters the rows; the grid's own search marks where each row matched. The
    // grid applies the new rows after this update has committed them, and a search run before
    // that leaves its scroll position behind (a blank strip above the first hit when rows are
    // expanded), so it waits one task.
    if (changed.has("searchQuery")) {
      const query = this.searchQuery.trim();
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => {
        this.grid.clearSearch();
        if (query) this.grid.findNext(query);
      }, 0);
    }
    // Row height derives from --ig-size and virtualization caches it, so the grid has to
    // be told once a new density has been applied.
    if (changed.has("fleetSize") && this.fleetSize !== this.appliedSize) {
      this.appliedSize = this.fleetSize;
      this.grid.reflow();
    }
    if (changed.has("fleetTheme")) {
      for (const detail of this.renderRoot.querySelectorAll("fleet-management-new-detail")) {
        detail.theme = this.fleetTheme;
      }
    }
  }

  /** Counted off the search results so the chips and the rows always agree. */
  private get fleetMetrics(): { label: string; value: number }[] {
    const countOf = (status: FleetStatus): number => this.searchedVehicles.filter((vehicle) => vehicle.status === status).length;
    return [
      { label: "All vehicles", value: this.searchedVehicles.length },
      { label: "Active", value: countOf("Active") },
      { label: "Available", value: countOf("Available") },
      { label: "In Maintenance", value: countOf("In Maintenance") },
    ];
  }

  private syncActionVehicle(): void {
    const vehicle = (this.actionStrip?.context?.data ?? undefined) as FleetVehicle | undefined;
    if (vehicle?.id !== this.actionVehicle?.id || vehicle?.status !== this.actionVehicle?.status) {
      this.actionVehicle = vehicle;
    }
  }

  private onSearchInput(event: Event): void {
    this.searchQuery = (event.target as IgcInputComponent).value;
  }

  private setVehicleStatus(vehicle: FleetVehicle, status: FleetStatus): void {
    if (vehicle.status === status) return;

    this.fleetData.setVehicleStatus(vehicle.id, status);
    this.vehicles = this.fleetData.vehicles;
    // The strip stays on the row, which now offers the other two statuses.
    if (this.actionVehicle?.id === vehicle.id) {
      this.actionVehicle = this.vehicles.find((candidate) => candidate.id === vehicle.id);
    }
    this.notify(`${vehicle.id} \u2014 ${vehicle.make} ${vehicle.model} set to ${status}`);
  }

  private onRowAction(status: FleetStatus): void {
    const vehicle = this.actionStrip.context?.data as FleetVehicle | undefined;
    if (vehicle) this.setVehicleStatus(vehicle, status);
  }

  private onSizeSelected(event: CustomEvent<string>): void {
    const size = FLEET_SIZES.find((candidate) => candidate === event.detail);
    if (size) this.fleetSize = size;
  }

  private toggleTheme(): void {
    this.fleetTheme = this.fleetTheme === "dark" ? "light" : "dark";
  }

  /** Reset throws away everything the user has done to the sample, so it asks first. */
  private async askResetFleet(): Promise<void> {
    void this.resetDialog.show();
    await this.resetDialog.updateComplete;
    // The modal dialog hands the focus to its first button, Cancel. Reset is the action the
    // dialog is there for, so it takes the focus and Enter confirms.
    this.resetConfirmButton.focus();
  }

  private confirmResetFleet(): void {
    void this.resetDialog.hide();
    this.resetFleet();
  }

  private resetFleet(): void {
    this.fleetTheme = FLEET_DEFAULT_THEME;
    this.fleetData.resetVehicles();
    this.vehicles = this.fleetData.vehicles;
    this.statusFilter = "all";
    this.searchQuery = "";
    this.fleetSize = FLEET_DEFAULT_SIZE;
    this.resetGridLayout();
    this.notify("Fleet reset to its opening state");
  }

  /** Puts sorting, filters, column order, pinning, hiding and expanded rows back. */
  private resetGridLayout(): void {
    if (!this.pristineGridState) return;

    // Cell ranges are the one piece the state restores on top of rather than replacing,
    // so they are cleared first.
    this.grid.clearCellSelection();
    this.gridState.applyStateFromString(this.pristineGridState);
    this.grid.clearSearch();
  }

  private notify(message: string): void {
    this.notice = message;
    void this.updateComplete.then(() => this.showNotice());
  }

  /** A new notice replaces the one on show and starts the display time again. */
  private async showNotice(): Promise<void> {
    // The snackbar stays open until its fade-out has ended, and `show()` does nothing while it
    // is open. A notice that comes in during the fade-out therefore waits for it, and then
    // opens the snackbar again instead of being closed by the hide that is already under way.
    await this.noticeHidden;
    if (!this.snackbar.open) await this.snackbar.show();
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      this.noticeHidden = this.snackbar.hide();
    }, NOTICE_DISPLAY_MS);
  }

  private statusCellTemplate = (ctx: IgcCellTemplateContext) => {
    const status = ctx.cell.value as FleetStatus;
    const badge = FLEET_STATUS_BADGES[status];
    return html`
      <span class="status-display">
        <igc-badge class=${classMap({ "status-badge": true, "status-badge-pulse": badge.pulse })} variant=${badge.variant} dot aria-hidden="true"></igc-badge>
        <span class="badge-text">${status}</span>
      </span>
    `;
  };

  private detailTemplate = (ctx: IgcGridMasterDetailContext) => html`
    <fleet-management-new-detail
      .vehicle=${ctx.implicit as FleetVehicle}
      .theme=${this.fleetTheme}
      .failedPhotos=${this.failedPhotos}
    ></fleet-management-new-detail>
  `;

  protected render() {
    const metrics = this.fleetMetrics;
    const actionVehicle = this.actionVehicle;
    const dark = this.fleetTheme === "dark";
    const chips: Array<{ filter: FleetStatusFilter; variant?: "info" | "success" | "warning" }> = [
      { filter: "all" },
      { filter: "Active", variant: "info" },
      { filter: "Available", variant: "success" },
      { filter: "In Maintenance", variant: "warning" },
    ];

    return html`
      <link rel="stylesheet" href="${import.meta.env.BASE_URL}themes/fluent.css" />
      <section
        class="fleet-management-new fleet-shell ig-typography ig-scrollbar"
        data-app="fleet-management-new"
        aria-label="Fleet management page"
      >
        <section class="fleet-chip-row" aria-label="Fleet status filters">
          ${chips.map(
            (chip, index) => html`
              <igc-chip
                outlined
                variant=${chip.variant ?? "default"}
                class=${classMap({ "fleet-chip": true, active: this.statusFilter === chip.filter })}
                @click=${() => (this.statusFilter = chip.filter)}
              >
                ${metrics[index].label} (${metrics[index].value})
              </igc-chip>
            `
          )}

          <igc-button variant="outlined" class="fleet-reset" @click=${this.askResetFleet}>
            <igc-icon slot="prefix" name="restart_alt" collection=${FLEET_ICON_COLLECTION} aria-hidden="true"></igc-icon>
            <span>Reset</span>
          </igc-button>

          <igc-button-group
            class="fleet-size-group"
            selection="single-required"
            aria-label="Component size"
            .selectedItems=${[this.fleetSize]}
            @igcSelect=${this.onSizeSelected}
          >
            ${FLEET_SIZES.map(
              (size) => html`
                <igc-toggle-button value=${size} title="Render the sample at ${size} size"><span>${size}</span></igc-toggle-button>
              `
            )}
          </igc-button-group>

          <igc-icon-button
            variant="contained"
            type="button"
            class="fleet-theme-toggle"
            name=${dark ? "light_mode" : "dark_mode"}
            collection=${FLEET_ICON_COLLECTION}
            title=${dark ? "Switch to light mode" : "Switch to dark mode"}
            aria-label=${dark ? "Switch to light mode" : "Switch to dark mode"}
            @click=${this.toggleTheme}
          ></igc-icon-button>
        </section>

        <igc-grid
          class="fleet-master-grid"
          primary-key="id"
          auto-generate="false"
          moving="true"
          height="100%"
          .data=${this.filteredVehicles}
          .detailTemplate=${this.detailTemplate}
        >
          <igc-grid-toolbar>
            <igc-grid-toolbar-title>
              <span class="fleet-title-wrap">
                <div class="fleet-title-icon-wrap">
                  <igc-icon class="fleet-title-icon" name="directions_car" collection=${FLEET_ICON_COLLECTION} aria-hidden="true"></igc-icon>
                  <igc-icon class="fleet-title-icon" name="directions_car" collection=${FLEET_ICON_COLLECTION} aria-hidden="true"></igc-icon>
                  <igc-icon class="fleet-title-icon" name="directions_car" collection=${FLEET_ICON_COLLECTION} aria-hidden="true"></igc-icon>
                </div>
                <h1>Fleet Management</h1>
              </span>
            </igc-grid-toolbar-title>
            <igc-grid-toolbar-actions>
              <igc-input
                class="fleet-search"
                type="search"
                placeholder="Search fleet"
                aria-label="Search vehicles by ID, plate, VIN, make, model or location"
                .value=${this.searchQuery}
                @igcInput=${this.onSearchInput}
              >
                <igc-icon slot="prefix" name="search" collection=${FLEET_ICON_COLLECTION} aria-hidden="true"></igc-icon>
              </igc-input>
              <igc-grid-toolbar-hiding></igc-grid-toolbar-hiding>
              <igc-grid-toolbar-pinning></igc-grid-toolbar-pinning>
              <igc-grid-toolbar-advanced-filtering></igc-grid-toolbar-advanced-filtering>
            </igc-grid-toolbar-actions>
          </igc-grid-toolbar>

          <igc-column field="id" header="Vehicle ID" sortable="true" filterable="false"></igc-column>
          <igc-column field="licensePlate" header="License Plate" sortable="true" filterable="true"></igc-column>
          <igc-column field="make" header="Make" sortable="true" filterable="true"></igc-column>
          <igc-column field="model" header="Model" sortable="true" filterable="true"></igc-column>
          <igc-column field="type" header="Type" sortable="true" filterable="true"></igc-column>
          <igc-column field="vin" header="VIN" sortable="true" filterable="false"></igc-column>
          <igc-column field="status" header="Status" sortable="true" filterable="true" .bodyTemplate=${this.statusCellTemplate}></igc-column>
          <igc-column field="locationCity" header="Location" sortable="true" filterable="true" width="12%"></igc-column>

          <igc-action-strip>
            ${actionVehicle
              ? FLEET_ROW_ACTIONS.filter((action) => action.status !== actionVehicle.status).map(
                  (action) => html`
                    <igc-icon-button
                      variant="flat"
                      class="fleet-row-action ${action.className}"
                      type="button"
                      name=${action.icon}
                      collection=${FLEET_ICON_COLLECTION}
                      title=${action.title}
                      aria-label=${action.title}
                      @click=${() => this.onRowAction(action.status)}
                    ></igc-icon-button>
                  `
                )
              : null}
          </igc-action-strip>
          <igc-grid-state></igc-grid-state>
        </igc-grid>

        <igc-snackbar keep-open>${this.notice}</igc-snackbar>
      </section>

      <igc-dialog title="Reset the fleet?" close-on-outside-click hide-default-action>
        <span slot="message">
          Vehicle statuses, the status filter, the search, the component size and the theme all go back to how they opened,
          along with the grid's sorting, filters, column order, pinning and expanded rows.
        </span>
        <igc-button slot="footer" variant="flat" @click=${() => void this.resetDialog.hide()}>Cancel</igc-button>
        <igc-button slot="footer" variant="contained" class="fleet-reset-confirm" @click=${this.confirmResetFleet}>Reset</igc-button>
      </igc-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "app-fleet-management-new": FleetManagementNew;
  }
}
