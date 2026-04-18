import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["node_modules/**", "dist/**", ".next/**"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // `any` is banned — covers `: any`, `as any`, `<any>`, and `Array<any>`.
      // For genuine escape hatches (third-party untyped shape, JSON.parse,
      // intentional bridge to a unknown), suppress per-line:
      //   // eslint-disable-next-line @typescript-eslint/no-explicit-any -- <reason>
      // The `-- <reason>` makes the escape hatch visible in code review.
      "@typescript-eslint/no-explicit-any": "error",

      // Don't let @ts-ignore become a silent override. @ts-expect-error is
      // allowed because it surfaces if the underlying issue ever gets fixed.
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-check": false,
          "ts-expect-error": "allow-with-description",
          minimumDescriptionLength: 10,
        },
      ],
    },
  },
);
