import { createRequire } from "node:module";
import { dirname } from "node:path";
import { defineConfig, normalizePath } from "vite";

// Packages are located through Node resolution, so the project builds both with its own
// node_modules and from the repository root, where the packages are installed.
const require = createRequire(import.meta.url);
const themingDir = normalizePath(dirname(require.resolve("igniteui-theming/package.json")));

export default defineConfig({
  resolve: {
    alias: {
      "igniteui-theming": themingDir,
    },
  },
});
