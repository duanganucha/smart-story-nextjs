// PM2 app definition for the Smart Story (หมีอ่าน) Next.js backend.
//
// Runs the Next.js standalone server (server.js) on the Windows server.
// Reads runtime secrets from .env.production sitting next to this file
// (parsed inline so no extra npm install is needed on the server).
//
//   pm2 start ecosystem.config.js
//   pm2 save
//
const fs = require('fs');
const path = require('path');

function loadEnv(file) {
  const out = {};
  try {
    const txt = fs.readFileSync(file, 'utf8');
    for (let line of txt.split(/\r?\n/)) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      out[key] = val;
    }
  } catch (e) {
    console.warn('[ecosystem] could not read', file, '-', e.message);
  }
  return out;
}

const fileEnv = loadEnv(path.join(__dirname, '.env.production'));

module.exports = {
  apps: [
    {
      name: 'smart-story',
      script: 'server.js',          // Next.js standalone entrypoint
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      max_memory_restart: '600M',
      env: {
        NODE_ENV: 'production',
        PORT: '3100',
        HOSTNAME: '0.0.0.0',        // listen on all interfaces (reverse proxy in front)
        ...fileEnv,                  // DB_*, GEMINI_API_KEY, GOOGLE_CLIENT_IDS, APPLE_CLIENT_IDS, ...
      },
    },
  ],
};
