/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@market-themes/analysis",
    "@market-themes/db",
    "@market-themes/ingest"
  ],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }
        ]
      }
    ];
  }
};

export default nextConfig;
