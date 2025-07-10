const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');

// Configurações
const MAX_TEMPO_SEM_LOG = 10 * 60 * 1000; // 10 minutos
const INTERVALO_VERIFICACAO = 2 * 60 * 1000; // Verificar a cada 2 minutos
const LOG_FILE = './logs/bot.log';

let tentativasConsecutivas = 0;
const MAX_TENTATIVAS_CONSECUTIVAS = 3;

function verificarSaudeBot() {
  try {
    // Verificar se o arquivo de log existe
    if (!fs.existsSync(LOG_FILE)) {
      console.log(`[Monitor] Arquivo de log não encontrado: ${LOG_FILE}`);
      return;
    }

    // Verificar última modificação do log
    const stats = fs.statSync(LOG_FILE);
    const ultimaModificacao = new Date(stats.mtime).getTime();
    const agora = Date.now();
    const tempoInativo = agora - ultimaModificacao;
    
    console.log(`[Monitor] Última atividade: ${new Date(ultimaModificacao).toLocaleString('pt-BR')}`);
    console.log(`[Monitor] Tempo inativo: ${Math.floor(tempoInativo/60000)} minutos`);

    // Verificar se há processos do bot rodando
    exec('pm2 jlist', (error, stdout, stderr) => {
      if (error) {
        console.error(`[Monitor] Erro ao verificar PM2: ${error.message}`);
        return;
      }

      try {
        const processos = JSON.parse(stdout);
        const botProcess = processos.find(p => p.name === 'bot');
        
        if (!botProcess) {
          console.log('[Monitor] Processo bot não encontrado no PM2');
          reiniciarBot('Processo não encontrado');
          return;
        }

        const statusBot = botProcess.pm2_env.status;
        console.log(`[Monitor] Status do bot no PM2: ${statusBot}`);

        // Se o bot não está online ou ficou muito tempo sem log
        if (statusBot !== 'online' || tempoInativo > MAX_TEMPO_SEM_LOG) {
          tentativasConsecutivas++;
          console.log(`[Monitor] Bot precisa ser reiniciado (tentativa ${tentativasConsecutivas}/${MAX_TENTATIVAS_CONSECUTIVAS})`);
          
          if (tentativasConsecutivas >= MAX_TENTATIVAS_CONSECUTIVAS) {
            console.log('[Monitor] Muitas tentativas consecutivas, realizando limpeza completa');
            limpezaCompleta();
          } else {
            reiniciarBot(`Status: ${statusBot}, Inativo por: ${Math.floor(tempoInativo/60000)}min`);
          }
        } else {
          // Reset contador se tudo estiver funcionando
          tentativasConsecutivas = 0;
          console.log('[Monitor] Bot funcionando normalmente');
        }

      } catch (parseError) {
        console.error('[Monitor] Erro ao analisar resposta do PM2:', parseError.message);
      }
    });

  } catch (error) {
    console.error('[Monitor] Erro ao verificar saúde do bot:', error.message);
  }
}

function reiniciarBot(motivo) {
  console.log(`[Monitor] Reiniciando bot - Motivo: ${motivo}`);
  
  // Registrar no log
  const logEntry = `[${new Date().toLocaleString('pt-BR')}] Bot reiniciado pelo monitor - ${motivo}\n`;
  fs.appendFileSync('./logs/monitor.log', logEntry);

  // Primeiro, tentar parar o bot graciosamente
  exec('pm2 stop bot', (stopError) => {
    if (stopError) {
      console.log('[Monitor] Erro ao parar bot:', stopError.message);
    }

    // Aguardar um pouco e limpar processos órfãos
    setTimeout(() => {
      exec('pkill -f "chromium"', (killError) => {
        if (killError) {
          console.log('[Monitor] Nenhum processo chromium para matar');
        }

        // Aguardar mais um pouco e reiniciar
        setTimeout(() => {
          exec('pm2 start bot --update-env', (startError, stdout, stderr) => {
            if (startError) {
              console.error(`[Monitor] Erro ao reiniciar bot: ${startError.message}`);
            } else {
              console.log('[Monitor] Bot reiniciado com sucesso');
              tentativasConsecutivas = 0; // Reset contador em caso de sucesso
            }
          });
        }, 5000);
      });
    }, 10000);
  });
}

function limpezaCompleta() {
  console.log('[Monitor] Executando limpeza completa do sistema...');
  
  const comandos = [
    'pm2 delete bot',
    'pkill -f "chromium"',
    'pkill -f "chrome"', 
    'rm -rf ./session/.wwebjs_*',
    'sleep 15',
    'pm2 start ecosystem.config.js --only bot'
  ];

  function executarComando(index) {
    if (index >= comandos.length) {
      console.log('[Monitor] Limpeza completa finalizada');
      tentativasConsecutivas = 0;
      return;
    }

    const comando = comandos[index];
    console.log(`[Monitor] Executando: ${comando}`);
    
    exec(comando, (error, stdout, stderr) => {
      if (error && !comando.includes('pkill') && !comando.includes('rm')) {
        console.error(`[Monitor] Erro no comando ${comando}: ${error.message}`);
      }
      
      setTimeout(() => executarComando(index + 1), 2000);
    });
  }

  executarComando(0);
}

// Criar diretório de logs se não existir
if (!fs.existsSync('./logs')) {
  fs.mkdirSync('./logs');
}

console.log('[Monitor] Sistema de monitoramento iniciado');
console.log(`[Monitor] Verificando a cada ${INTERVALO_VERIFICACAO/60000} minutos`);
console.log(`[Monitor] Limite de inatividade: ${MAX_TEMPO_SEM_LOG/60000} minutos`);

// Iniciar monitoramento
setInterval(verificarSaudeBot, INTERVALO_VERIFICACAO);
verificarSaudeBot();

