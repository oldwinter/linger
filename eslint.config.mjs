import js from "@eslint/js";
import globals from "globals";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const typedFiles = [
  "apps/{web,node-services,voice-runtime,computer,teamhub-cli,desktop,linger-installer}/**/*.{ts,tsx,mts,cts}",
  "packages/**/*.{ts,tsx,mts,cts}",
];

const nodeServiceRoles = ["agent", "memory", "llm-wiki", "document", "voice"];

// Roles in apps/node-services share only host-level seams under src/ and
// packages/*; they must never import sibling role modules directly.
const nodeServiceRoleBoundaryConfigs = nodeServiceRoles.map((role) => {
  const siblingRoles = nodeServiceRoles.filter((other) => other !== role);
  return {
    files: [`apps/node-services/src/${role}/**/*.{ts,tsx,mts,cts}`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: siblingRoles.map((other) => ({
            group: [
              `../${other}`,
              `../${other}/*`,
              `../../${other}`,
              `../../${other}/*`,
              `../../../${other}`,
              `../../../${other}/*`,
              `../../../../${other}`,
              `../../../../${other}/*`,
            ],
            message: `Role "${role}" must not import sibling role "${other}" directly; exchange data through host-owned seams in apps/node-services/src/.`,
          })),
        },
      ],
    },
  };
});

export default [
  {
    ignores: [
      "node_modules/**",
      "coverage/**",
      "dist/**",
      "**/dist/**",
      ".worktrees/**",
      ".linger-runtime/**",
      "playwright-report/**",
      "skills/builtin/*/*/**",
      "test-results/**",
      ".claude/**",
      ".cache/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    rules: {
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: typedFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      // react-router loaders throw `redirect()` / `Response` by design.
      "@typescript-eslint/only-throw-error": [
        "error",
        { allow: [{ from: "lib", name: "Response" }] },
      ],
      // Rejecting with `any`/`unknown` forwards caught errors and AbortSignal
      // reasons unchanged, matching only-throw-error's default behavior.
      "@typescript-eslint/prefer-promise-reject-errors": [
        "error",
        { allowThrowingAny: true, allowThrowingUnknown: true },
      ],
      "@typescript-eslint/no-base-to-string": "error",
      "@typescript-eslint/restrict-template-expressions": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-redundant-type-constituents": "error",
    },
  },
  {
    files: [
      "apps/web/src/**/*.{ts,tsx}",
      "apps/linger-installer/src/web/**/*.{ts,tsx}",
    ],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    ...jsxA11y.flatConfigs.recommended,
    files: [
      "apps/web/src/**/*.{ts,tsx}",
      "apps/linger-installer/src/web/**/*.{ts,tsx}",
    ],
  },
  ...nodeServiceRoleBoundaryConfigs,
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
];
