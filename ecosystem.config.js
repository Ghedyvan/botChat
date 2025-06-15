module.exports = {
  apps: [
    {
      name: "bot",
      script: "bot.js",
      watch: false,
      max_memory_restart: "768M",
      env: {
        NODE_ENV: "production",
        DISPLAY: ":99",
        CHROME_DEVEL_SANDBOX: "/usr/lib/chromium-browser/chrome-sandbox",
        MAX_BROWSERS: "2",
        BROWSER_TIMEOUT: "1800000"
      },
      restart_delay: 20000, // Aumentar delay para cleanup completo
      max_restarts: 10,
      autorestart: true,
      kill_timeout: 15000, // Mais tempo para cleanup
      listen_timeout: 8000,
      // Adicionar script de pré-inicialização
      pre_start: "./cleanup-start.sh",
      log_file: "./logs/bot-combined.log",
      out_file: "./logs/bot-out.log",
      error_file: "./logs/bot-error.log",
      stop_exit_codes: [0, 1, 2, 15],
    },
    {
      name: "watchdog",
      script: "watchdog.js",
      watch: false,
      restart_delay: 30000,
      max_restarts: 5,
      autorestart: true,
      max_memory_restart: "128M",
      env: {
        NODE_ENV: "production",
        BOT_LOG_FILE: "./logs/bot.log",
        WATCHDOG_LOG_FILE: "./logs/watchdog.log",
        CHECK_INTERVAL: "300000",
        MAX_INACTIVE_TIME: "900000"
      },
      log_file: "./logs/watchdog-combined.log",
      out_file: "./logs/watchdog-out.log",
      error_file: "./logs/watchdog-error.log",
    },
  ],
};