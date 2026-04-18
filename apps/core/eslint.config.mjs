import nestjsConfig from "@consistent/eslint-config/nestjs";

export default [
  ...nestjsConfig,
  {
    ignores: ["dist/**", "node_modules/**", "drizzle/**"],
  },
];
