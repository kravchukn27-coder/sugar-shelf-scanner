import type { NextConfig } from "next";

// Railway runs the compact standalone server. The postbuild script copies its
// static and public assets alongside the server bundle.
const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
