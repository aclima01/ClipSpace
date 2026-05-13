// Copy this file to ecosystem.config.js and adjust the paths for your machine.
// ecosystem.config.js is gitignored — it contains machine-specific paths.
//
// To generate TLS certs with mkcert:
//   mkcert -install
//   mkcert <your-local-ip> localhost 127.0.0.1
//   (generates certs/ folder — also gitignored)

module.exports = {
  apps: [
    {
      name: "clipspace",
      script: "server/dist/index.js",
      env: {
        NODE_ENV: "production",
        PORT: 3001,
        // Remove TLS_CERT / TLS_KEY to run without HTTPS (plain HTTP on LAN)
        TLS_CERT: "/absolute/path/to/certs/localhost+2.pem",
        TLS_KEY: "/absolute/path/to/certs/localhost+2-key.pem",
      },
    },
    {
      name: "clipspace-backup",
      script: "server/dist/backup.js",
      cron_restart: "0 */6 * * *", // every 6 hours
      autorestart: false,
      env: {
        BACKUP_DIR: "/absolute/path/to/backup/destination", // e.g. OneDrive folder
        BACKUP_KEEP: "30",
      },
    },
  ],
};
