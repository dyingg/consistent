import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@consistent/contracts", "@consistent/realtime"],
};

export default nextConfig;
