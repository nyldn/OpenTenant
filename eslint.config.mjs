import js from "@eslint/js";
import { environmentExclusions, runtimeEnvironmentRules } from "./tooling/config/environment-policy.mjs";
import nextPlugin from "@next/eslint-plugin-next";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const sourceFiles = ["**/*.{js,mjs,cjs,jsx,ts,tsx}"];
const nextSourceFiles = [
  "apps/platform/**/*.{js,mjs,cjs,jsx,ts,tsx}",
  "templates/tenant-module-nextjs/**/*.{js,mjs,cjs,jsx,ts,tsx}",
];
const intentionalControlPatternFiles = [
  "apps/platform/app/m/**/route.ts",
  "modules/support/src/slack-delivery.ts",
  "packages/developer-mcp/src/audit.ts",
  "packages/platform-core/src/brand-validation.ts",
  "packages/security/src/module-context.ts",
];
const intentionalCleanupAssignmentFiles = [
  "modules/brain/src/host-api.ts",
  "apps/platform/app/api/settings/connections/**/callback/route.ts",
  "packages/security/src/module-context.ts",
];

export default defineConfig(
  globalIgnores([
    "**/node_modules/**",
    "**/.next/**",
    "**/.turbo/**",
    "**/coverage/**",
    "**/playwright-report/**",
    "**/test-results/**",
    "**/dist/**",
    "**/next-env.d.ts",
    "graphify-out/**",
  ]),
  {
    files: sourceFiles,
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["**/*.{jsx,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/rules-of-hooks": "error",
    },
  },
  {
    files: nextSourceFiles,
    plugins: {
      "@next/next": nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      // Both Next workspaces use the App Router and intentionally have no pages directory.
      "@next/next/no-html-link-for-pages": "off",
    },
    settings: {
      next: {
        rootDir: ["apps/platform/", "templates/tenant-module-nextjs/"],
      },
    },
  },
  {
    // These validators intentionally reject C0 control characters at the input boundary.
    files: intentionalControlPatternFiles,
    rules: {
      "no-control-regex": "off",
    },
  },
  {
    // These assignments clear sensitive or authorization state on terminal paths.
    files: intentionalCleanupAssignmentFiles,
    rules: {
      "no-useless-assignment": "off",
    },
  },
  {
    files: ["tooling/migrations/src/tenant-core.ts"],
    rules: {
      // The declaration reference supplies SQL import types to this migration entrypoint.
      "@typescript-eslint/triple-slash-reference": "off",
    },
  },
  {
    files: ["tooling/unattended/src/postgres-proof.mjs"],
    rules: {
      // Destructuring excludes the trusted cluster data directory from the child proof result.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^(?:_|dataDirectory$)",
        },
      ],
    },
  },
  {
    files: ["apps/platform/**/*.{js,mjs,cjs,jsx,ts,tsx}", "packages/*/src/**/*.{js,mjs,cjs,jsx,ts,tsx}", "modules/*/src/**/*.{js,mjs,cjs,jsx,ts,tsx}"],
    ignores: environmentExclusions.map(entry => entry.path),
    rules: runtimeEnvironmentRules,
  },
);
