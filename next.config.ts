import type { NextConfig } from "next";

const backendApiUrl = (
  process.env.BACKEND_API_URL
  ?? process.env.NEXT_PUBLIC_API_URL
  ?? "https://physica-api-production.up.railway.app"
).replace(/\/+$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    const playgroundUrl = process.env.PLAYGROUND_API_URL
      ?? (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8001" : undefined);
    return [
      ...(playgroundUrl ? [{
        source: "/api/playground/:path*",
        destination: `${playgroundUrl.replace(/\/+$/, "")}/:path*`,
      }] : []),
      {
        source: "/api/backend/:path*",
        destination: `${backendApiUrl}/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
          {
            key: "Referrer-Policy",
            value: "no-referrer-when-downgrade",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
