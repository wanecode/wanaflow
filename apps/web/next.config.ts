import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["pg"],
  transpilePackages: ["@wanaflow/db", "@wanaflow/modeling", "@wanaflow/ui"],
};

export default nextConfig;
