module.exports = {
  apps: [
    {
      name: "bot",
      script: "bot.js",
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
      restart_delay: 10000,  // 10 segundos de espera antes de reiniciar em caso de falha
      max_restarts: 10,      // Máximo de 10 reinicializações em caso de falhas contínuas
      autorestart: true
    },
    {
      name: "watchdog",
      script: "watchdog.js",
      watch: false,
      restart_delay: 30000,  // 30 segundos de espera antes de reiniciar o watchdog
      max_restarts: 5,
      autorestart: true
    }
  ]
};