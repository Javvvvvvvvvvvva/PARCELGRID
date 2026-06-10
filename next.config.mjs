/** @type {import('next').NextConfig} */
const nextConfig = {
  // PARCELGRID Next configuration.
  //
  // experimental.typedRoutes generates ts types for every `<Link href>` —
  // catches dead route refs at build time. We avoided it during dev to
  // keep iteration fast.
  experimental: {
    // Skip during this codepath; turn on once routes stabilize.
    typedRoutes: false,
  },

  // The finance engine uses Decimal.js which has no native binding —
  // safe in any runtime. We leave the default Node runtime for API routes
  // so we can connect to postgres-js.
  serverExternalPackages: ["postgres"],

  // Production: pin to a single image domain for the V월드 / NAVER static
  // tiles used by the comps map. Left empty during local dev.
  images: { remotePatterns: [] },
};

export default nextConfig;
