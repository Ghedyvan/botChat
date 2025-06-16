module.exports = {
  apps: [
    {
      name: "bot",
      script: "bot.js",
      watch: false,
      ignore_watch: [
        "node_modules",
        "*.json",
        "*.log",
        "logs",
        "assets",
        "*.txt",
      ],
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        DISPLAY: ":99", // Display virtual para headless
        PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: "true",
        PUPPETEER_EXECUTABLE_PATH: "/usr/bin/chromium-browser"
      },
      restart_delay: 15000, // 15 segundos de espera antes de reiniciar
      max_restarts: 5, // Reduzido para evitar loops infinitos
      autorestart: true,
      kill_timeout: 10000, // 10 segundos para kill graceful
      wait_ready: true,
      listen_timeout: 30000, // 30 segundos para estar ready
    },
    {
      name: "watchdog",
      script: "watchdog.js",
      watch: false,
      restart_delay: 30000,
      max_restarts: 5,
      autorestart: true,
      env: {
        NODE_ENV: "production"
      }
    },
  ],
};