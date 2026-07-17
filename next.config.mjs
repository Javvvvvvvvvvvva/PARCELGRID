/** @type {import('next').NextConfig} */
const nextConfig = {
  // PARCELGRID Next configuration.
  //
  // Next 15.5 moved typedRoutes out of experimental.
  typedRoutes: false,

  // The finance engine uses Decimal.js which has no native binding —
  // safe in any runtime. We leave the default Node runtime for API routes
  // so we can connect to postgres-js.
  // Next 15 + React Three Fiber: transpile three/r3f so Next bundles React
  // internals correctly (fixes 'ReactCurrentOwner' undefined runtime error).
  transpilePackages: ["three", "@react-three/fiber", "@react-three/drei"],

  serverExternalPackages: ["postgres"],

  // Production: pin to a single image domain for the V월드 / NAVER static
  // tiles used by the comps map. Left empty during local dev.
  images: { remotePatterns: [] },
};

export default nextConfig;
