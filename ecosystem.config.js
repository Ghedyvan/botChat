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
        PUPPETEER_EXECUTABLE_PATH: "/usr/bin/chromium-browser",
        XDG_CONFIG_HOME: "/tmp/.config",
        XDG_CACHE_HOME: "/tmp/.cache",
        CHROME_DEVEL_SANDBOX: "/usr/lib/chromium-browser/chrome-sandbox",
        // Remover DISPLAY para VPS headless
        // DISPLAY não deve ser definido em VPS sem interface gráfica
      },
      restart_delay: 30000,
      max_restarts: 3,
      autorestart: true,
      kill_timeout: 20000, // Aumentado para VPS mais lenta
      wait_ready: false,
      listen_timeout: 90000, // Aumentado para VPS
      error_file: "./logs/bot-error.log",
      out_file: "./logs/bot-out.log",
      log_file: "./logs/bot-combined.log",
      merge_logs: true,
      time: true // Adicionar timestamp nos logs
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