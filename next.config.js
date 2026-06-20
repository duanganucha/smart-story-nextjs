/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produce a self-contained build under .next/standalone (server.js + minimal
  // node_modules) so it can be copied to the Windows production server and run
  // under PM2 without `npm install` on the server. See deploy/.
  output: 'standalone',
  // allow larger request bodies for image uploads on server actions / route handlers
  experimental: {
    serverActions: { bodySizeLimit: '15mb' },
  },
};

module.exports = nextConfig;
