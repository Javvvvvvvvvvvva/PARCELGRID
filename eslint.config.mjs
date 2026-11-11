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
  {
    files: ["src/app/**/*.tsx", "src/components/**/*.tsx", "src/lib/hooks/**/*.ts"],
    ignores: ["src/app/access/page.tsx", "src/components/auth/SessionBoundary.tsx", "src/components/auth/SessionBadge.tsx"],
    rules: {
      "no-restricted-globals": ["error",
        { name: "fetch", message: "Use sessionFetch for customer API requests." },
        { name: "localStorage", message: "Use sessionLocalStorage for customer data." },
        { name: "sessionStorage", message: "Use sessionDraftStorage for customer data." },
      ],
      "no-restricted-syntax": ["error", {
        selector: "MemberExpression[object.name=/^(window|globalThis)$/][property.name=/^(fetch|localStorage|sessionStorage)$/]",
        message: "Use the verified client-session request/storage boundary for customer data.",
      }],
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
