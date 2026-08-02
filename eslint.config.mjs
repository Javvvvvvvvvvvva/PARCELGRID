import { FlatCompat } from "@eslint/eslintrc";
import { defineConfig, globalIgnores } from "eslint/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const baseDirectory = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory });

export default defineConfig([
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  globalIgnores([
    ".next/**",
    "coverage/**",
    ".parcelgrid-data/**",
    ".pnpm-home/**",
    ".pnpm-store/**",
    ".xdg-data/**",
    "next-env.d.ts",
  ]),
]);
