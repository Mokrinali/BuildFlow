import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Server actions bound with useActionState receive an unused previous-state argument.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      // Bound server actions + useActionState + a no-JS form post hang Next.js 16.4 (DoS).
      // Pass ids as hidden form fields instead (see formId in src/server/action.ts).
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='bind'][arguments.0.raw='null']",
          message:
            "Do not bind server actions; pass ids as hidden form fields (see src/server/action.ts).",
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
    "branding/tools/**",
  ]),
]);
