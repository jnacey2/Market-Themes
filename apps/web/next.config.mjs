/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@market-themes/analysis",
    "@market-themes/db",
    "@market-themes/ingest"
  ]
};

export default nextConfig;
