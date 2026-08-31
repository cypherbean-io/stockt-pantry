import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits `.next/standalone` with a minimal server.js and only the traced
  // node_modules, so the runtime image needs no `npm install` at all
  // (next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md).
  // The Dockerfile depends on this being set.
  output: "standalone",
};

export default nextConfig;
