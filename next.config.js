/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com" }],
  },
  experimental: {
    instrumentationHook: true,
    // USearch 包含 Node-API 原生模块，必须由 Node 直接加载而非打入 webpack bundle。
    serverComponentsExternalPackages: ["usearch"],
  },
};

module.exports = nextConfig;
