/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdf-parse is old CommonJS with its own bundled pdf.js — keep it out of the
  // bundler and let Node require it at runtime on the server.
  serverExternalPackages: ["pdf-parse"],
  experimental: {
    // Server Actions receive full resume payloads during import review.
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
