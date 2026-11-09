import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Excel/PDF libraries are used client-side only; keep server bundles lean.
  serverExternalPackages: [],
};

export default nextConfig;
