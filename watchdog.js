const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');

// Configurações
const MAX_TEMPO_SEM_LOG = 15 * 60 * 1000; // 15 minutos em milissegundos
const INTERVALO_VERIFICACAO = 5 * 60 * 1000; // Verificar a cada 5 minutos
const LOG_FILE = './logs/bot.log';

function verificarBot() {
  try {
    // Verificar se o arquivo de log foi modificado recentemente
    const stats = fs.statSync(LOG_FILE);
    const ultimaModificacao = new Date(stats.mtime).getTime();
    const agora = Date.now();
    
    console.log(`[Watchdog] Última atividade de log: ${new Date(ultimaModificacao).toLocaleString('pt-BR')}`);
    
    // Se o log não foi atualizado por um longo período, reiniciar o bot
    if (agora - ultimaModificacao > MAX_TEMPO_SEM_LOG) {
      console.log(`[Watchdog] Bot parece estar inativo há ${Math.floor((agora - ultimaModificacao)/60000)} minutos. Reiniciando...`);
      
      // Usando PM2 para reiniciar a aplicação
      exec('pm2 restart bot', (error, stdout, stderr) => {
        if (error) {
          console.error(`[Watchdog] Erro ao reiniciar via PM2: ${error.message}`);
          return;
        }
        console.log('[Watchdog] Bot reiniciado com sucesso via PM2');
        
        // Registrar log
        fs.appendFileSync('./logs/watchdog.log', 
          `[${new Date().toLocaleString('pt-BR')}] Bot reiniciado pelo watchdog\n`);
      });
      return;
    }
    
    console.log('[Watchdog] Bot parece estar funcionando normalmente.');
  } catch (error) {
    console.error('[Watchdog] Erro ao verificar bot:', error);
  }
}

// Iniciar verificação periódica
console.log('[Watchdog] Serviço de monitoramento iniciado');
setInterval(verificarBot, INTERVALO_VERIFICACAO);

// Verificar imediatamente na inicialização
verificarBot();