import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import globals from "globals";

const eslintConfig = defineConfig([
  ...nextVitals,
  {
    // Catch references to undefined variables — real bugs, like using
    // `student.id` where the map variable is `s`. Next's own config does
    // not enable this (it assumes TypeScript), but this is a JS project.
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "no-undef": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
