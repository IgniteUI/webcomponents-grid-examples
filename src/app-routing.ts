import { Route } from "@vaadin/router";

/** Route action that imports a sample on its first visit, so the shell bundle that every page loads does not carry it. */
const load = (importSample: () => Promise<unknown>) => async () => {
  await importSample();
};

export const routes: Route[] = [
  { path: "", redirect: "home" },
  {
    path: "home",
    component: "home-view",
    children: [
      { path: "", redirect: "home/inventory" },
      { path: "inventory", component: "erp-hgrid-view" },
      { path: "finance", component: "finance-view" },
      { path: "hr-portal", component: "hr-portal-view" },
      { path: "sales", component: "sales-view" },
      { path: "fleet", component: "fleet-management-view" },
      { path: "finance-grid-new", component: "finance-grid-new-view" },
      { path: "grid-fintech-100k", component: "grid-fintech-100k-view" },
      { path: "sales-dashboard", component: "sales-dashboard-view" },
      { path: "fleet-management-new", component: "fleet-management-new-view" },
      { path: "grid-fintech-dock-manager", component: "grid-fintech-dock-manager-view" },
      { path: "excel", component: "excel-view" },
      {
        path: "charts",
        children: [
          { path: "column-chart", component: "column-chart-view" },
          { path: "bar-chart", component: "bar-chart-view" },
          { path: "line-chart", component: "line-chart-view" },
          { path: "pie-chart", component: "pie-chart-view" },
          { path: "step-chart", component: "step-chart-view" },
          { path: "polar-chart", component: "polar-chart-view" },
        ]
      }
    ],
  },
  { path: "inventory", component: "app-erp-hgrid" },
  { path: "finance", component: "app-finance-grid" },
  { path: "hr-portal", component: "app-hr-portal" },
  { path: "sales", component: "app-sales-grid" },
  { path: "fleet", component: "app-fleet-management" },
  {
    path: "finance-grid-new",
    component: "app-finance-grid-new",
    action: load(() => import("../projects/finance-grid-new/src/finance-grid-new")),
  },
  {
    path: "grid-fintech-100k",
    component: "app-grid-fintech-100k",
    action: load(() => import("../projects/grid-fintech-100k/src/grid-fintech-100k")),
  },
  {
    path: "sales-dashboard",
    component: "app-sales-dashboard",
    action: load(() => import("../projects/sales-dashboard/src/sales-dashboard")),
  },
  {
    path: "fleet-management-new",
    component: "app-fleet-management-new",
    action: load(() => import("../projects/fleet-management-new/src/fleet-management-new")),
  },
  {
    path: "grid-fintech-dock-manager",
    component: "app-grid-fintech-dock-manager",
    action: load(() => import("../projects/grid-fintech-dock-manager/src/grid-fintech-dock-manager")),
  },
  {
    path: "excel",
    component: "app-excel",
    action: load(() => import("../projects/excel/src/excel")),
  },
  {
    path: "charts",
    children: [
      { path: "column-chart", component: "app-column-chart" },
      { path: "bar-chart", component: "app-bar-chart" },
      { path: "line-chart", component: "app-line-chart" },
      { path: "pie-chart", component: "app-pie-chart" },
      { path: "step-chart", component: "app-step-chart" },
      { path: "polar-chart", component: "app-polar-chart" },
    ]
  },

  // Fallback route
  { path: "(.*)", redirect: "home" }
];
