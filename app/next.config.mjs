/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 and puppeteer are native/heavy — keep them out of the bundler
  // and let Node require them at runtime on the server.
  serverExternalPackages: ["better-sqlite3", "puppeteer", "pdf-parse"],
  experimental: {
    // Server Actions receive full resume payloads during import review.
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
