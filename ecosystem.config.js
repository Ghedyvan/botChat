module.exports = {
  apps: [
    {
      name: "bot",
      script: "bot.js",
      watch: false,
      max_memory_restart: "600M",
      env: {
        NODE_ENV: "production",
        NODE_OPTIONS: "--max-old-space-size=512 --expose-gc",
        PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: "true",
        PUPPETEER_EXECUTABLE_PATH: "/usr/bin/chromium-browser"
      },
      restart_delay: 30000, // 30 segundos de espera
      max_restarts: 3, // Reduzido ainda mais
      autorestart: true,
      kill_timeout: 15000, // 15 segundos para kill
      wait_ready: false, // Desabilitar wait_ready que pode causar problemas
      listen_timeout: 60000, // 1 minuto
      error_file: "./logs/bot-error.log",
      out_file: "./logs/bot-out.log",
      log_file: "./logs/bot-combined.log"
    },
    {
      name: "monitor",
      script: "monitor.js",
      watch: false,
      restart_delay: 10000,
      max_restarts: 10,
      autorestart: true,
      env: {
        NODE_ENV: "production"
      }
    }
  ],
};