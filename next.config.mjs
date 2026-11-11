import path from "node:path";
import { fileURLToPath } from "node:url";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // PARCELGRID Next configuration.
  //
  // Next 15.5 moved typedRoutes out of experimental.
  typedRoutes: false,
  poweredByHeader: false,
  outputFileTracingRoot: projectRoot,
  allowedDevOrigins: ["127.0.0.1"],

  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },

  // The finance engine uses Decimal.js which has no native binding —
  // safe in any runtime. We leave the default Node runtime for API routes
  // so we can connect to postgres-js.
  // Next 15 + React Three Fiber: transpile three/r3f so Next bundles React
  // internals correctly (fixes 'ReactCurrentOwner' undefined runtime error).
  transpilePackages: ["three", "@react-three/fiber", "@react-three/drei"],

  // concaveman's CommonJS RBush constructor must use Node resolution;
  // bundling it into the RSC graph selects an incompatible ESM namespace.
  serverExternalPackages: ["postgres", "concaveman"],

  // Production: pin to a single image domain for the V월드 / NAVER static
  // tiles used by the comps map. Left empty during local dev.
  images: { remotePatterns: [] },
};

/** @param {string} phase */
export default function configForPhase(phase) {
  // A production verification build must not delete a running dev server's chunks.
  return { ...nextConfig, distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next" };
}
