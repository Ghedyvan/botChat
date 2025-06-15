module.exports = {
  apps: [
    {
      name: "bot",
      script: "bot.js",
      watch: false,
      max_memory_restart: "768M", // Aumentar para comportar múltiplos browsers
      env: {
        NODE_ENV: "production",
        DISPLAY: ":99",
        CHROME_DEVEL_SANDBOX: "/usr/lib/chromium-browser/chrome-sandbox",
        // Adicionar variáveis para o browserManager
        MAX_BROWSERS: "2",
        BROWSER_TIMEOUT: "1800000" // 30 minutos em ms
      },
      restart_delay: 15000, // Aumentar delay para cleanup completo
      max_restarts: 10,
      autorestart: true,
      // Adicionar configurações para cleanup de browsers
      kill_timeout: 10000, // Tempo para cleanup antes de forçar kill
      listen_timeout: 8000,
      // Logs específicos
      log_file: "./logs/bot-combined.log",
      out_file: "./logs/bot-out.log",
      error_file: "./logs/bot-error.log",
      // Script pré-parada para cleanup
      stop_exit_codes: [0, 1, 2, 15],
    },
    {
      name: "watchdog",
      script: "watchdog.js",
      watch: false,
      restart_delay: 30000,
      max_restarts: 5,
      autorestart: true,
      max_memory_restart: "128M", // Watchdog usa pouca memória
      env: {
        NODE_ENV: "production",
        // Configurações do watchdog
        BOT_LOG_FILE: "./logs/bot.log",
        WATCHDOG_LOG_FILE: "./logs/watchdog.log",
        CHECK_INTERVAL: "300000", // 5 minutos
        MAX_INACTIVE_TIME: "900000" // 15 minutos
      },
      log_file: "./logs/watchdog-combined.log",
      out_file: "./logs/watchdog-out.log",
      error_file: "./logs/watchdog-error.log",
    },
  ],
};