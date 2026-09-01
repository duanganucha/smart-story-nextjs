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
  async headers() {
    return [
      {
        // Scene images and narration are immutable once written: a regenerated
        // scene is served under a new ?v=<ts> URL, so a client that already has
        // the bytes never needs to revalidate. Without this Next sends
        // `max-age=0` and every cached image still costs a round-trip.
        source: '/:dir(scenes|audio)/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
