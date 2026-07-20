// Config PM2 supaya gateway ini otomatis restart kalau crash / server reboot.
// Jalankan dengan: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "wa-gateway",
      script: "server.js",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
    },
  ],
};
