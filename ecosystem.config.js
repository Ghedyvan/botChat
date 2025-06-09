module.exports = {
  apps: [
    {
      name: "bot",
      script: "bot.js",
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        DISPLAY: ":99",
        CHROME_DEVEL_SANDBOX: "/usr/lib/chromium-browser/chrome-sandbox"
      },
      restart_delay: 10000,
      max_restarts: 10,
      autorestart: true,
    },
    {
      name: "watchdog",
      script: "watchdog.js",
      watch: false,
      restart_delay: 30000,
      max_restarts: 5,
      autorestart: true,
    },
  ],
};