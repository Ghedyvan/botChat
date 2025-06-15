const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');

// Configurações (usar variáveis de ambiente se disponíveis)
const MAX_TEMPO_SEM_LOG = parseInt(process.env.MAX_INACTIVE_TIME) || 15 * 60 * 1000; // 15 minutos
const INTERVALO_VERIFICACAO = parseInt(process.env.CHECK_INTERVAL) || 5 * 60 * 1000; // 5 minutos
const LOG_FILE = process.env.BOT_LOG_FILE || './logs/bot.log';
const WATCHDOG_LOG_FILE = process.env.WATCHDOG_LOG_FILE || './logs/watchdog.log';

// Contadores para evitar restarts excessivos
let contadorRestarts = 0;
const MAX_RESTARTS_POR_HORA = 3;
const resetContadorInterval = 60 * 60 * 1000; // 1 hora

function logWatchdog(mensagem) {
  const timestamp = new Date().toLocaleString('pt-BR');
  const logEntry = `[${timestamp}] ${mensagem}\n`;
  
  console.log(`[Watchdog] ${mensagem}`);
  
  try {
    // Garantir que o diretório de logs existe
    const logDir = path.dirname(WATCHDOG_LOG_FILE);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    fs.appendFileSync(WATCHDOG_LOG_FILE, logEntry);
  } catch (error) {
    console.error('[Watchdog] Erro ao escrever log:', error);
  }
}

function verificarProcessosBrowser() {
  return new Promise((resolve) => {
    // Verificar se há processos órfãos do Chromium
    exec('pgrep -f "chromium.*remote-debugging-port"', (error, stdout, stderr) => {
      if (stdout) {
        const processos = stdout.trim().split('\n').filter(p => p);
        if (processos.length > 3) { // Mais de 3 processos pode indicar vazamento
          logWatchdog(`Detectados ${processos.length} processos Chromium. Pode haver vazamento.`);
          
          // Limpar processos órfãos
          exec('pkill -f "chromium.*remote-debugging-port"', (killError) => {
            if (!killError) {
              logWatchdog('Processos Chromium órfãos limpos.');
            }
          });
        }
      }
      resolve();
    });
  });
}

async function verificarBot() {
  try {
    // Verificar se excedeu o limite de restarts
    if (contadorRestarts >= MAX_RESTARTS_POR_HORA) {
      logWatchdog(`Limite de restarts atingido (${contadorRestarts}). Aguardando reset.`);
      return;
    }

    // Verificar se o arquivo de log existe
    if (!fs.existsSync(LOG_FILE)) {
      logWatchdog(`Arquivo de log não encontrado: ${LOG_FILE}`);
      return;
    }

    // Verificar modificação do log
    const stats = fs.statSync(LOG_FILE);
    const ultimaModificacao = new Date(stats.mtime).getTime();
    const agora = Date.now();
    const tempoInativo = agora - ultimaModificacao;
    
    logWatchdog(`Última atividade: ${new Date(ultimaModificacao).toLocaleString('pt-BR')} (${Math.floor(tempoInativo/60000)} min atrás)`);
    
    // Verificar processos browser
    await verificarProcessosBrowser();
    
    // Verificar se o bot está usando PM2
    exec('pm2 jlist', (error, stdout) => {
      if (error) {
        logWatchdog('PM2 não encontrado ou erro ao verificar processos');
        return;
      }
      
      try {
        const processos = JSON.parse(stdout);
        const botProcess = processos.find(p => p.name === 'bot');
        
        if (!botProcess) {
          logWatchdog('Processo bot não encontrado no PM2');
          return;
        }
        
        // Verificar se o processo está rodando
        if (botProcess.pm2_env.status !== 'online') {
          logWatchdog(`Bot está ${botProcess.pm2_env.status}. Tentando iniciar...`);
          reiniciarBot();
          return;
        }
        
        // Verificar uso de memória
        const memoryMB = Math.round(botProcess.memory / 1024 / 1024);
        logWatchdog(`Memória do bot: ${memoryMB}MB`);
        
        if (memoryMB > 600) { // Se usar mais que 600MB
          logWatchdog(`Uso alto de memória detectado (${memoryMB}MB). Reiniciando por precaução.`);
          reiniciarBot();
          return;
        }
        
        // Se inativo por muito tempo, reiniciar
        if (tempoInativo > MAX_TEMPO_SEM_LOG) {
          logWatchdog(`Bot inativo há ${Math.floor(tempoInativo/60000)} minutos. Reiniciando...`);
          reiniciarBot();
          return;
        }
        
        logWatchdog('Bot funcionando normalmente.');
        
      } catch (parseError) {
        logWatchdog(`Erro ao analisar saída do PM2: ${parseError.message}`);
      }
    });
    
  } catch (error) {
    logWatchdog(`Erro ao verificar bot: ${error.message}`);
  }
}

function reiniciarBot() {
  contadorRestarts++;
  logWatchdog(`Iniciando restart #${contadorRestarts}...`);
  
  // Primeiro, limpar processos browser órfãos
  exec('pkill -f "chromium.*remote-debugging-port"', (killError) => {
    if (!killError) {
      logWatchdog('Processos Chromium limpos antes do restart.');
    }
    
    // Reiniciar o bot via PM2
    exec('pm2 restart bot --wait-ready --listen-timeout 10000', (error, stdout, stderr) => {
      if (error) {
        logWatchdog(`Erro ao reiniciar via PM2: ${error.message}`);
        
        // Tentar restart mais agressivo
        exec('pm2 kill && pm2 start ecosystem.config.js', (killError) => {
          if (killError) {
            logWatchdog(`Erro no restart agressivo: ${killError.message}`);
          } else {
            logWatchdog('Restart agressivo executado.');
          }
        });
        return;
      }
      
      logWatchdog('Bot reiniciado com sucesso via PM2');
      
      // Verificar se realmente reiniciou após 30 segundos
      setTimeout(() => {
        verificarBot();
      }, 30000);
    });
  });
}

// Reset do contador de restarts a cada hora
setInterval(() => {
  if (contadorRestarts > 0) {
    logWatchdog(`Reset contador de restarts. Era: ${contadorRestarts}`);
    contadorRestarts = 0;
  }
}, resetContadorInterval);

// Cleanup na saída
process.on('SIGINT', () => {
  logWatchdog('Watchdog finalizado (SIGINT)');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logWatchdog('Watchdog finalizado (SIGTERM)');
  process.exit(0);
});

// Inicialização
logWatchdog('Serviço de monitoramento iniciado');
logWatchdog(`Configurações: Log check: ${INTERVALO_VERIFICACAO/60000}min, Timeout: ${MAX_TEMPO_SEM_LOG/60000}min`);

// Verificação inicial após 1 minuto (dar tempo do bot inicializar)
setTimeout(verificarBot, 60000);

// Verificação periódica
setInterval(verificarBot, INTERVALO_VERIFICACAO);