import { createRequire } from "node:module";
import { dirname } from "node:path";
import { defineConfig, normalizePath } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

// Packages are located through Node resolution, so the project builds both with its own
// node_modules and from the repository root, where the packages are installed.
const require = createRequire(import.meta.url);
const themingDir = normalizePath(dirname(require.resolve("igniteui-theming/package.json")));
const gridsDir = normalizePath(dirname(require.resolve("igniteui-webcomponents-grids/package.json")));

export default defineConfig({
  resolve: {
    alias: {
      "igniteui-theming": themingDir,
    },
  },
  plugins: [
    // The sample runs the light Fluent component sheets on its own dark palette, so only the
    // light grid theme is served - at the same URL the shell uses.
    viteStaticCopy({
      targets: [
        {
          src: `${gridsDir}/grids/themes/light/fluent.css`,
          dest: "themes",
        },
      ],
    }),
  ],
});
