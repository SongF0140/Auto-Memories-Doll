/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com" }],
  },
  experimental: {
    instrumentationHook: true,
    // USearch 包含 Node-API 原生模块，必须由 Node 直接加载而非打入 webpack bundle。
    // @huggingface/transformers 内部依赖 onnxruntime-node（原生模块），同理外置。
    serverComponentsExternalPackages: ["usearch", "@huggingface/transformers"],
  },
};

module.exports = nextConfig;
