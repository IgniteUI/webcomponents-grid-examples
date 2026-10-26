import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
export default defineConfig(() => {
  return {
    base: "/webcomponents-grid-examples/",
    resolve: {
      alias: {
        "igniteui-theming": new URL("./node_modules/igniteui-theming", import.meta.url).pathname,
      },
    },
    plugins: [
      viteStaticCopy({
        targets: [
          {
            src: "./web.config",
            dest: "",
          },
          {
            src: "./projects/finance-grid/public/*",
            dest: "",
          },
          {
            src: "./projects/hr-portal/public/*",
            dest: "",
          },
          {
            src: "./projects/erp-hgrid/public/*",
            dest: "",
          },
          {
            src: "./projects/fleet-management-grid/public/*",
            dest: "",
          },
          {
            src: "./projects/sales-grid/public/*",
            dest: "",
          },
          {
            src: "./projects/fleet-management-new/public/*",
            dest: "",
          },
          {
            src: "./projects/excel/public/*",
            dest: "",
          },
          {
            src: "node_modules/igniteui-webcomponents-grids/grids/themes/light/bootstrap.css",
            dest: "themes",
          },
          {
            src: "node_modules/igniteui-webcomponents-grids/grids/themes/light/fluent.css",
            dest: "themes",
          },
          {
            src: "node_modules/igniteui-webcomponents-grids/grids/themes/light/material.css",
            dest: "themes",
          },
          {
            src: "node_modules/igniteui-webcomponents-grids/grids/themes/dark/material.css",
            dest: "themes/dark",
          },
          {
            src: "node_modules/igniteui-webcomponents-grids/grids/themes/dark/fluent.css",
            dest: "themes/dark",
          },
          {
            src: "node_modules/igniteui-webcomponents-grids/grids/themes/light/indigo.css",
            dest: "themes",
          },
        ],
      }),
    ],
    build: {
      target: "esnext",
      sourcemap: false,
      chunkSizeWarningLimit: 3000,
      rollupOptions: {
        treeshake: true
      }
    }
  };
});
