const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");

// Módulos internos
const { obterJogosParaWhatsApp } = require("./scrapper.js");
const {
  isContactSaved,
  responderComLog,
  obterDataBrasilia,
} = require("./utils.js");
const { gerarTeste, marcarTesteRespondido, testesPendentes, verificarTestesPendentes } = require("./gerarTest");
const config = require("./config.js");

// Banco de dados
const supabaseClient = require("./supabase");

// Configurações
const adminNumber = config.ADMIN_NUMBER;
const logFile = config.LOG_FILE;
const sessionTimeout = config.SESSION_TIMEOUT || 12 * 60 * 60 * 1000; 
const indicacoesFile = config.INDICACOES_FILE || "./indicacoes.json";

// Recursos
const iptvstreamplayer = MessageMedia.fromFilePath("./assets/streamplayer.png");
const ibo = MessageMedia.fromFilePath("./assets/ibo.png");
const tabelaprecos = MessageMedia.fromFilePath("./assets/tabelaprecos.png");

// Estado global
let modoAusente = false;
const avisosEnviados = new Set();
let indicacoes = {};
let mensagensRecebidas = 0;
let ultimaAtividadeTempo = Date.now();
let monitoramentoAtivo = true;
const userSessions = new Map();
global.respostasEnviadas = 0;

// Inicializar dados
async function inicializarDados() {
  await supabaseClient.inicializarSupabase();
  const sessions = await supabaseClient.carregarSessoes();
  userSessions.clear();

  for (const [id, userData] of sessions.entries()) {
    userSessions.set(id, userData);
  }
  console.log(
    `${userSessions.size} sessões carregadas do Supabase com sucesso.`
  );
}

// Função para backup de indicações
function fazerBackupIndicacoes() {
  try {
    const backupDir = "./backups";
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir);
    }

    const agora = obterDataBrasilia();
    const nomeArquivo = `indicacoes_backup_${
      agora.toISOString().split("T")[0]
    }.json`;
    fs.writeFileSync(
      `${backupDir}/${nomeArquivo}`,
      JSON.stringify(indicacoes, null, 2)
    );
    return true;
  } catch (error) {
    console.error("Erro ao criar backup das indicações:", error);
    return false;
  }
}

// Salvar dados de indicações
function salvarIndicacoes() {
  try {
    fs.writeFileSync(indicacoesFile, JSON.stringify(indicacoes, null, 2));
    return true;
  } catch (error) {
    console.error("Erro ao salvar indicações:", error);
    registrarLogLocal(
      `Erro ao salvar indicações: ${error.message}`,
      "ERROR",
      "salvarIndicacoes",
      null
    );
    return false;
  }
}

async function salvarTodasSessoes() {
  try {
    console.log('Salvando todas as sessões de usuários...');
    let sessoesGravadas = 0;
    
    for (const [chatId, sessao] of userSessions.entries()) {
      try {
        await supabaseClient.salvarSessao(chatId, sessao);
        sessoesGravadas++;
      } catch (error) {
        console.error(`Erro ao salvar sessão ${chatId}:`, error.message);
        registrarLogLocal(
          `Erro ao salvar sessão ${chatId}: ${error.message}`,
          "ERROR",
          "salvarTodasSessoes",
          chatId
        );
      }
    }
    
    console.log(`${sessoesGravadas} sessões salvas com sucesso.`);
    registrarLogLocal(
      `${sessoesGravadas} sessões salvas com sucesso`,
      "INFO",
      "salvarTodasSessoes",
      null
    );
    
    return sessoesGravadas;
  } catch (error) {
    console.error('Erro geral ao salvar sessões:', error.message);
    registrarLogLocal(
      `Erro geral ao salvar sessões: ${error.message}`,
      "ERROR",
      "salvarTodasSessoes",
      null
    );
    return 0;
  }
}

async function limparSessoesExpiradas() {
  try {
    const agora = Date.now();
    let sessoesRemovidas = 0;
    
    for (const [chatId, sessao] of userSessions.entries()) {
      const tempoInativo = agora - (sessao.ultimaInteracao || 0);
      
      // Remove sessões inativas por mais de 24 horas
      if (tempoInativo > 24 * 60 * 60 * 1000) {
        userSessions.delete(chatId);
        sessoesRemovidas++;
        
        // Remover do Supabase também
        try {
          await supabaseClient.removerSessao(chatId);
        } catch (error) {
          console.error(`Erro ao remover sessão ${chatId} do Supabase:`, error.message);
        }
      }
    }
    
    if (sessoesRemovidas > 0) {
      console.log(`${sessoesRemovidas} sessões expiradas removidas.`);
      registrarLogLocal(
        `${sessoesRemovidas} sessões expiradas removidas`,
        "INFO",
        "limparSessoesExpiradas",
        null
      );
    }
    
    return sessoesRemovidas;
  } catch (error) {
    console.error('Erro ao limpar sessões expiradas:', error.message);
    registrarLogLocal(
      `Erro ao limpar sessões expiradas: ${error.message}`,
      "ERROR",
      "limparSessoesExpiradas",
      null
    );
    return 0;
  }
}

// Função para backup de dados críticos
async function backupDadosCriticos() {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = './backups';
    
    // Criar diretório de backup se não existir
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    // Backup das sessões
    const sessionsBackup = {};
    for (const [chatId, sessao] of userSessions.entries()) {
      sessionsBackup[chatId] = sessao;
    }
    
    const backupPath = path.join(backupDir, `sessions_backup_${timestamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(sessionsBackup, null, 2));
    
    // Backup das indicações
    if (fs.existsSync(indicacoesFile)) {
      const indicacoesBackupPath = path.join(backupDir, `indicacoes_backup_${timestamp}.json`);
      fs.copyFileSync(indicacoesFile, indicacoesBackupPath);
    }
    
    console.log(`Backup criado: ${backupPath}`);
    registrarLogLocal(
      `Backup de dados críticos criado: ${backupPath}`,
      "INFO",
      "backupDadosCriticos",
      null
    );
    
    // Limpar backups antigos (manter apenas os últimos 7)
    limparBackupsAntigos(backupDir);
    
    return backupPath;
  } catch (error) {
    console.error('Erro ao criar backup:', error.message);
    registrarLogLocal(
      `Erro ao criar backup: ${error.message}`,
      "ERROR",
      "backupDadosCriticos",
      null
    );
    return null;
  }
}

// Função para limpar backups antigos
function limparBackupsAntigos(backupDir) {
  try {
    const arquivos = fs.readdirSync(backupDir)
      .filter(file => file.startsWith('sessions_backup_') && file.endsWith('.json'))
      .map(file => ({
        name: file,
        path: path.join(backupDir, file),
        time: fs.statSync(path.join(backupDir, file)).mtime
      }))
      .sort((a, b) => b.time - a.time);
    
    // Manter apenas os 7 backups mais recentes
    const arquivosParaRemover = arquivos.slice(7);
    
    for (const arquivo of arquivosParaRemover) {
      fs.unlinkSync(arquivo.path);
      console.log(`Backup antigo removido: ${arquivo.name}`);
    }
  } catch (error) {
    console.error('Erro ao limpar backups antigos:', error.message);
  }
}

// Função para monitorar uso de memória
function monitorarMemoria() {
  try {
    const uso = process.memoryUsage();
    const usoMB = {
      rss: Math.round(uso.rss / 1024 / 1024),
      heapTotal: Math.round(uso.heapTotal / 1024 / 1024),
      heapUsed: Math.round(uso.heapUsed / 1024 / 1024),
      external: Math.round(uso.external / 1024 / 1024)
    };
    
    console.log(`Uso de memória - RSS: ${usoMB.rss}MB, Heap: ${usoMB.heapUsed}/${usoMB.heapTotal}MB`);
    
    // Se o uso de heap estiver muito alto, forçar coleta de lixo
    if (usoMB.heapUsed > 400 && global.gc) {
      console.log('Uso de memória alto, executando coleta de lixo...');
      global.gc();
      
      const usoApos = process.memoryUsage();
      const usoAposMB = Math.round(usoApos.heapUsed / 1024 / 1024);
      console.log(`Memória após GC: ${usoAposMB}MB`);
      
      registrarLogLocal(
        `Coleta de lixo executada. Memória: ${usoMB.heapUsed}MB -> ${usoAposMB}MB`,
        "INFO",
        "monitorarMemoria",
        null
      );
    }
    
    // Se ainda estiver muito alto, considerar reinício
    if (usoMB.heapUsed > 500) {
      console.log('Uso de memória crítico, considerando reinício...');
      registrarLogLocal(
        `Uso de memória crítico: ${usoMB.heapUsed}MB`,
        "WARN",
        "monitorarMemoria",
        null
      );
      
      // Agendar reinício suave
      setTimeout(() => {
        reinicioSuave();
      }, 5000);
    }
    
    return usoMB;
  } catch (error) {
    console.error('Erro ao monitorar memória:', error.message);
    return null;
  }
}

// Backup de indicações
function fazerBackupIndicacoes() {
  try {
    const backupDir = "./backups";
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir);
    }

    const agora = new Date();
    const nomeArquivo = `indicacoes_backup_${
      agora.toISOString().split("T")[0]
    }.json`;
    fs.writeFileSync(
      `${backupDir}/${nomeArquivo}`,
      JSON.stringify(indicacoes, null, 2)
    );
    return true;
  } catch (error) {
    console.error("Erro ao criar backup das indicações:", error);
    return false;
  }
}

// Logging
async function registrarLogLocal(
  mensagem,
  nivel = "INFO",
  origem = null,
  numero = null
) {
  try {
    const agora = obterDataBrasilia();
    const dataHora = `[${agora.toLocaleDateString("pt-BR")} - ${agora
      .toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      .replace(":", "-")}]`;
    const logMensagem = `${dataHora} [${nivel}] ${mensagem}\n`;

    fs.appendFileSync(logFile, logMensagem, "utf8");

    supabaseClient
      .registrarLog(nivel, mensagem, origem, numero)
      .catch((err) => console.error("Erro ao enviar log para Supabase:", err));
  } catch (error) {
    console.error("Erro ao registrar log local:", error);
  }
}

// Função para obter configurações do Puppeteer otimizadas para VPS headless
function obterConfigPuppeteer() {
  // Configurar variáveis de ambiente para VPS sem interface gráfica
  process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = 'true';
  process.env.PUPPETEER_EXECUTABLE_PATH = '/usr/bin/chromium-browser';
  
  // Configurações específicas para ambiente headless
  delete process.env.DISPLAY; // Remove DISPLAY em ambiente headless
  
  return {
    headless: true, // Usar modo headless tradicional (mais estável)
    executablePath: "/usr/bin/chromium-browser",
    args: [
      // Argumentos essenciais para VPS
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-features=VizDisplayCompositor",
      "--disable-features=AudioServiceOutOfProcess",
      "--disable-ipc-flooding-protection",
      
      // Otimizações de memória para VPS
      "--memory-pressure-off",
      "--max-old-space-size=512",
      "--single-process",
      "--no-zygote",
      
      // Configurações para WhatsApp Web (JavaScript HABILITADO)
      "--disable-extensions",
      "--disable-plugins",
      "--disable-default-apps",
      "--disable-sync",
      "--disable-translate",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-client-side-phishing-detection",
      "--disable-hang-monitor",
      "--disable-popup-blocking",
      "--disable-prompt-on-repost",
      "--safebrowsing-disable-auto-update",
      
      // Configurações de primeira execução
      "--no-first-run",
      "--no-default-browser-check",
      "--metrics-recording-only",
      
      // Configurações de autenticação (menos agressivas)
      "--password-store=basic",
      "--use-mock-keychain",
      
      // Configurações de áudio/vídeo
      "--mute-audio",
      "--disable-audio-output",
      "--disable-notifications",
      
      // Diretórios temporários para VPS
      "--user-data-dir=/tmp/chrome-user-data",
      "--data-path=/tmp/chrome-data",
      "--disk-cache-dir=/tmp/chrome-cache",
      
      // Otimizações específicas para ambiente servidor
      "--disable-plugins-discovery",
      "--disable-print-preview",
      "--hide-scrollbars",
      
      // Configuração de viewport
      "--window-size=1366,768",
      
      // User agent realista
      "--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ],
    defaultViewport: {
      width: 1366,
      height: 768,
      deviceScaleFactor: 1,
    },
    timeout: 180000, // 3 minutos
    protocolTimeout: 180000, // 3 minutos
    ignoreDefaultArgs: ['--disable-extensions'],
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    
    // Configurações específicas para VPS
    ignoreHTTPSErrors: true,
    slowMo: 100, // Delay maior entre ações para estabilidade
    devtools: false,
  };
}

// Inicializar cliente WhatsApp com tratamento de erros robusto
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: './session',
    clientId: 'bot-session'
  }),
  puppeteer: obterConfigPuppeteer(),
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
  },
  // Configurações adicionais para estabilidade
  qrMaxRetries: 5,
  restartOnAuthFail: true,
  takeoverOnConflict: true,
  takeoverTimeoutMs: 60000,
});

// Tratamento global de erros não capturados
process.on('unhandledRejection', (reason, promise) => {
  console.error('Erro não tratado (unhandledRejection):', reason);
  registrarLogLocal(
    `Erro não tratado: ${reason}`,
    "ERROR",
    "unhandledRejection",
    null
  );
});

process.on('uncaughtException', (error) => {
  console.error('Exceção não capturada:', error);
  registrarLogLocal(
    `Exceção não capturada: ${error.message}`,
    "ERROR",
    "uncaughtException",
    null
  );
  
  // Tentar reinício suave em caso de erro crítico
  setTimeout(() => {
    reinicioSuave().catch(err => {
      console.error('Erro durante reinício de emergência:', err);
      process.exit(1);
    });
  }, 5000);
});

// Configurar handlers de sinal para shutdown gracioso
process.on('SIGTERM', async () => {
  console.log('Recebido SIGTERM, fazendo shutdown gracioso...');
  await reinicioSuave();
});

process.on('SIGINT', async () => {
  console.log('Recebido SIGINT, fazendo shutdown gracioso...');
  await reinicioSuave();
});

//Agendamento de reinicio automático
function agendarReinicioPreventivo() {
  const horaReinicio = obterDataBrasilia();

  // Programar para reiniciar às 4:00 AM (horário de menor movimento)
  horaReinicio.setHours(4, 0, 0, 0);

  // Se já passou das 4:00 hoje, programe para amanhã
  if (obterDataBrasilia() > horaReinicio) {
    horaReinicio.setDate(horaReinicio.getDate() + 1);
  }

  const msAteReinicio = horaReinicio - obterDataBrasilia();

  console.log(
    `Reinício preventivo programado para: ${horaReinicio.toLocaleString(
      "pt-BR"
    )}`
  );
  registrarLogLocal(
    `Reinício preventivo programado para: ${horaReinicio.toLocaleString(
      "pt-BR"
    )}`,
    "INFO",
    "agendarReinicioPreventivo",
    null
  );

  setTimeout(async () => {
    console.log("Executando reinício preventivo programado");
    registrarLogLocal(
      "Executando reinício preventivo programado",
      "INFO",
      "reinicioPreventivo",
      null
    );

    try {
      await reinicioSuave();

      // Agendar próximo reinício
      agendarReinicioPreventivo();
    } catch (error) {
      console.error("Erro durante reinício preventivo:", error);
      registrarLogLocal(
        `Erro durante reinício preventivo: ${error.message}`,
        "ERROR",
        "reinicioPreventivo",
        null
      );

      // Tentar novamente em 1 hora em caso de falha
      setTimeout(agendarReinicioPreventivo, 60 * 60 * 1000);
    }
  }, msAteReinicio);
}

async function salvarSessao(chatId, sessaoData) {
  try {
    // Atualiza a cópia em memória
    userSessions.set(chatId, sessaoData);

    // Salva no Supabase
    await supabaseClient.salvarSessao(chatId, sessaoData);

    // Log apenas para confirmar
    console.log(`Sessão ${chatId} salva no Supabase`);
    return true;
  } catch (error) {
    console.error(`Erro ao salvar sessão ${chatId}:`, error);
    return false;
  }
}
//Ping periódico para ver se o bot está ativo
async function verificarConexaoAtiva() {
  try {
    // Verifica se o estado reportado é "CONNECTED"
    const estadoReportado = await client.getState();
    console.log(`Estado reportado: ${estadoReportado}`);

    if (estadoReportado !== "CONNECTED") {
      console.log("Estado diferente de CONNECTED, reconectando...");
      registrarLogLocal(
        "Estado não conectado detectado, forçando reconexão",
        "WARN",
        "verificarConexaoAtiva",
        null
      );

      // Tenta reconectar
      setTimeout(() => {
        client.initialize();
      }, 5000);
      return;
    }

    // Mesmo que o estado seja CONNECTED, vamos testar enviando uma mensagem para nós mesmos
    const ultimaMensagemRecebida = Date.now() - ultimaAtividadeTempo;

    // Se ficou mais de 20 minutos sem receber mensagens, teste enviando para si mesmo
    if (ultimaMensagemRecebida > 20 * 60 * 1000) {
      console.log(
        "Mais de 20 minutos sem receber mensagens, testando conexão..."
      );

      try {
        // Enviar mensagem invisível para si mesmo (não aparece no WhatsApp)
        const timestamp = new Date().toISOString();
        await client.sendMessage(`${adminNumber}@c.us`, `_ping_${timestamp}_`);
        console.log("Ping enviado para teste de conexão");

        // Definir um timeout para verificar se a mensagem foi recebida
        setTimeout(async () => {
          // Se o tempo da última atividade não mudou, algo está errado
          if (Date.now() - ultimaAtividadeTempo > 21 * 60 * 1000) {
            console.log("Ping não foi detectado, forçando reinicialização...");
            registrarLogLocal(
              "Ping não detectado, conexão parece estar quebrada",
              "ERROR",
              "verificarConexaoAtiva",
              null
            );
            await reinicioSuave();
          }
        }, 90000); // Espere 90 segundos para ver se o ping é detectado
      } catch (error) {
        console.error("Erro ao enviar ping:", error);
        registrarLogLocal(
          `Erro ao enviar ping: ${error.message}`,
          "ERROR",
          "verificarConexaoAtiva",
          null
        );
        await reinicioSuave();
      }
    }
  } catch (error) {
    console.error("Erro ao verificar conexão ativa:", error);
    registrarLogLocal(
      `Erro ao verificar conexão ativa: ${error.message}`,
      "ERROR",
      "verificarConexaoAtiva",
      null
    );

    // Se houve erro ao verificar, tente reiniciar
    await reinicioSuave();
  }
}

// Chamar esta função na inicialização
agendarReinicioPreventivo();

// Adicionar o ping periódico aos timers existentes
setInterval(verificarConexaoAtiva, 10 * 60 * 1000); // Verificar a cada 10 minutos

// Função para reinício suave com ambiente configurado
async function reinicioSuave() {
  console.log("Realizando reinício suave do bot...");
  registrarLogLocal(
    "Realizando reinício suave do bot",
    "INFO",
    "reinicioSuave",
    null
  );

  try {
    // 1. Salvar sessões de usuários
    console.log("Salvando sessões de usuários...");
    for (const [chatId, sessao] of userSessions.entries()) {
      await supabaseClient.salvarSessao(chatId, sessao).catch(err => 
        console.log(`Erro ao salvar sessão ${chatId}:`, err.message)
      );
    }

    // 2. Fechar cliente WhatsApp graciosamente
    console.log("Fechando cliente WhatsApp...");
    try {
      if (client && typeof client.destroy === 'function') {
        await Promise.race([
          client.destroy(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout ao fechar cliente')), 10000)
          )
        ]);
      }
    } catch (closeError) {
      console.log("Erro ao fechar cliente:", closeError.message);
    }

    // 3. Limpar processos do browser e preparar ambiente VPS
    console.log("Limpando processos do browser e preparando ambiente VPS...");
    const { exec } = require('child_process');
    
    // Comandos específicos para VPS headless
    const comandosLimpeza = [
      'pkill -f "chromium" || true',
      'pkill -f "chrome" || true',
      'pkill -f "Xvfb" || true', // Limpar display virtual se existir
      'rm -rf /tmp/chrome-* || true',
      'rm -rf /tmp/.X* || true',
      'rm -rf /tmp/.com.google.Chrome* || true',
      'mkdir -p /tmp/chrome-user-data /tmp/chrome-data /tmp/chrome-cache || true',
      'chmod -R 755 /tmp/chrome-* || true'
    ];

    for (const comando of comandosLimpeza) {
      await new Promise((resolve) => {
        exec(comando, (error) => {
          // Ignorar erros de comandos de limpeza
          resolve();
        });
      });
    }

    // 4. Aguardar limpeza completa
    console.log("Aguardando limpeza de recursos...");
    await new Promise((resolve) => setTimeout(resolve, 8000)); // Reduzido para VPS

    // 5. Configurar ambiente para VPS headless
    console.log("Configurando ambiente para VPS headless...");
    delete process.env.DISPLAY; // Remover DISPLAY para VPS
    process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = 'true';
    process.env.PUPPETEER_EXECUTABLE_PATH = '/usr/bin/chromium-browser';
    process.env.HOME = process.env.HOME || '/root';
    process.env.XDG_CONFIG_HOME = '/tmp/.config';
    process.env.XDG_CACHE_HOME = '/tmp/.cache';
    process.env.CHROME_DEVEL_SANDBOX = '/usr/lib/chromium-browser/chrome-sandbox';
    
    // 6. Forçar coleta de lixo
    if (global.gc) {
      console.log("Executando coleta de lixo...");
      global.gc();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      global.gc();
    }

    // 7. Resetar variáveis de estado
    mensagensRecebidas = 0;
    global.respostasEnviadas = 0;
    ultimaAtividadeTempo = Date.now();

    // 8. Criar script de reinício otimizado para VPS
    const scriptReinicio = `#!/bin/bash
# Script otimizado para VPS headless

# Configurar ambiente
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
export HOME=${process.env.HOME || '/root'}
export XDG_CONFIG_HOME=/tmp/.config
export XDG_CACHE_HOME=/tmp/.cache
export CHROME_DEVEL_SANDBOX=/usr/lib/chromium-browser/chrome-sandbox

# Remover DISPLAY para VPS
unset DISPLAY

# Verificar se chromium existe
if ! command -v chromium-browser &> /dev/null; then
    echo "Chromium não encontrado, tentando instalar..."
    apt-get update && apt-get install -y chromium-browser
fi

# Criar diretórios necessários
mkdir -p /tmp/.config /tmp/.cache /tmp/chrome-user-data /tmp/chrome-data /tmp/chrome-cache
chmod -R 755 /tmp/chrome-* /tmp/.config /tmp/.cache

# Verificar recursos do sistema
echo "Memória disponível:"
free -h

# Reiniciar com PM2
pm2 restart bot --update-env --force
`;

    fs.writeFileSync('/tmp/restart_bot_vps.sh', scriptReinicio);
    await new Promise((resolve) => {
      exec('chmod +x /tmp/restart_bot_vps.sh', () => resolve());
    });

    // 9. Executar reinício otimizado para VPS
    console.log("Executando reinício otimizado para VPS...");
    registrarLogLocal(
      "Executando reinício otimizado para VPS",
      "INFO",
      "reinicioSuave",
      null
    );

    exec('/tmp/restart_bot_vps.sh', (error, stdout, stderr) => {
      if (error) {
        console.error('Erro no reinício VPS:', error.message);
        registrarLogLocal(
          `Erro no reinício VPS: ${error.message}`,
          "ERROR",
          "reinicioSuave",
          null
        );
        
        // Fallback: reinício simples
        exec('pm2 restart bot --update-env --force', (fallbackError) => {
          if (fallbackError) {
            console.error('Erro no fallback:', fallbackError.message);
          }
        });
      } else {
        console.log('Reinício VPS executado com sucesso');
        registrarLogLocal(
          "Reinício VPS executado com sucesso",
          "INFO",
          "reinicioSuave",
          null
        );
      }
    });

    return true;

  } catch (error) {
    console.error("Erro durante reinício suave:", error);
    registrarLogLocal(
      `Erro durante reinício suave: ${error.message}`,
      "ERROR",
      "reinicioSuave",
      null
    );

    // Fallback: forçar reinício via PM2
    console.log("Executando reinício de emergência...");
    const { exec } = require('child_process');
    
    exec('pm2 restart bot --force', (error, stdout, stderr) => {
      if (error) {
        console.error('Erro no reinício de emergência:', error.message);
      } else {
        console.log('Reinício de emergência executado');
      }
    });

    return false;
  }
}
// Verificar estado da conexão regularmente
async function verificarEstadoConexao() {
  try {
    console.log("Verificando estado da conexão...");
    
    if (!client) {
      console.log("Cliente não inicializado");
      return false;
    }

    const info = await client.getState().catch(() => null);
    console.log(`Estado atual: ${info || 'Desconhecido'}`);
    
    registrarLogLocal(
      `Verificação de conexão - Estado: ${info || 'Desconhecido'}`,
      "INFO",
      "verificarEstadoConexao",
      null
    );

    // Atualizar timestamp da última atividade
    ultimaAtividadeTempo = Date.now();
    
    return info === 'CONNECTED';
  } catch (error) {
    console.error("Erro ao verificar estado da conexão:", error.message);
    registrarLogLocal(
      `Erro ao verificar estado da conexão: ${error.message}`,
      "ERROR",
      "verificarEstadoConexao",
      null
    );
    return false;
  }
}

// Monitorar saúde do bot
function monitorarSaudeBot() {
  // Verifica se o sistema está respondendo
  const tempoInativo = Date.now() - ultimaAtividadeTempo;

  // Contar sessões em modo humano para ajustar expectativas
  let sessoesHumano = 0;
  for (const [_, session] of userSessions.entries()) {
    if (session.step === "humano") {
      sessoesHumano++;
    }
  }

  if (mensagensRecebidas > 0) {
    console.log(
      `Status do bot: Recebidas ${mensagensRecebidas}, Respondidas ${respostasEnviadas}, Modo humano: ${sessoesHumano}, Inativo por ${Math.floor(
        tempoInativo / 1000
      )}s`
    );

    // Ajustar critério considerando sessões em atendimento humano
    if (
      mensagensRecebidas - respostasEnviadas > 3 + sessoesHumano * 2 &&
      tempoInativo > 2 * 60 * 1000
    ) {
      if (monitoramentoAtivo) {
        console.error(
          "🔄 PROBLEMA DETECTADO: Bot recebendo mensagens mas não respondendo."
        );
        registrarLogLocal(
          "PROBLEMA DETECTADO: Bot recebendo mensagens mas não respondendo.",
          "ERROR",
          "monitorarSaudeBot",
          null
        );

        // Evita reinícios múltiplos
        monitoramentoAtivo = false;

        // Tenta reinício suave
        reinicioSuave().then((sucesso) => {
          if (sucesso) {
            console.log("Reinício automático bem sucedido!");
            registrarLogLocal(
              "Reinício automático bem sucedido",
              "INFO",
              "monitorarSaudeBot",
              null
            );
          } else {
            console.error("Reinício automático falhou");
            registrarLogLocal(
              "Reinício automático falhou",
              "ERROR",
              "monitorarSaudeBot",
              null
            );
          }

          // Reativa o monitoramento após um tempo
          setTimeout(() => {
            monitoramentoAtivo = true;
          }, 15000);
        });
      }
    }
  }
}

// HANDLERS DE EVENTOS COM TRATAMENTO ROBUSTO DE ERROS
client.on("qr", (qr) => {
  try {
    qrcode.generate(qr, { small: true });
    console.log("QR Code gerado. Escaneie-o com seu WhatsApp.");
    registrarLogLocal("QR Code gerado", "INFO", "clientQR", null);
  } catch (error) {
    console.error("Erro ao gerar QR code:", error);
    registrarLogLocal(`Erro ao gerar QR code: ${error.message}`, "ERROR", "clientQR", null);
  }
});

client.on("authenticated", () => {
  try {
    const mensagem = "Autenticado com sucesso!";
    console.log(mensagem);
    registrarLogLocal(mensagem, "INFO", "clientAuth", null);
  } catch (error) {
    console.error("Erro no evento authenticated:", error);
  }
});

client.on("auth_failure", (session) => {
  console.error("Falha na autenticação:", session);
  registrarLogLocal(`Falha na autenticação: ${session}`, "ERROR", "clientAuthFailure", null);
  
  // Tentar limpar sessão corrompida e reiniciar
  setTimeout(async () => {
    try {
      console.log("Limpando sessão após falha de autenticação...");
      const { exec } = require('child_process');
      exec('rm -rf ./session/.wwebjs_*', () => {
        console.log("Sessão limpa, reiniciando...");
        reinicioSuave();
      });
    } catch (error) {
      console.error("Erro ao limpar sessão:", error);
    }
  }, 5000);
});

client.on("ready", async () => {
  try {
    const mensagem = "Bot está pronto!";
    console.log(mensagem);
    registrarLogLocal(mensagem, "INFO", "clientReady", null);

    // Configurar timeouts e intervalos com tratamento de erro
    try {
      setInterval(() => {
        verificarTestesPendentes().catch(err => 
          console.error("Erro em verificarTestesPendentes:", err)
        );
      }, 15 * 60 * 1000);
      
      setInterval(monitorarSaudeBot, 60000);
      
      setInterval(() => {
        verificarEstadoConexao().catch(err => 
          console.error("Erro em verificarEstadoConexao:", err)
        );
      }, 15 * 60 * 1000);
      
      setInterval(() => {
        salvarTodasSessoes().catch(err => 
          console.error("Erro em salvarTodasSessoes:", err)
        );
      }, 5 * 60 * 1000);
      
      setInterval(() => {
        limparSessoesExpiradas().catch(err => 
          console.error("Erro em limparSessoesExpiradas:", err)
        );
      }, 60 * 60 * 1000);
      
      setInterval(monitorarMemoria, 2 * 60 * 1000);
      
      setInterval(() => {
        backupDadosCriticos().catch(err => 
          console.error("Erro em backupDadosCriticos:", err)
        );
      }, 6 * 60 * 60 * 1000);

      // Executar limpeza inicial
      await limparSessoesExpiradas();
      await backupDadosCriticos();

      // Programar backup diário
      const agora = obterDataBrasilia();
      const proximaMeiaNoite = new Date(obterDataBrasilia());
      proximaMeiaNoite.setHours(24, 0, 0, 0);
      const tempoAteBackup = proximaMeiaNoite - agora;

      setTimeout(() => {
        setInterval(fazerBackupIndicacoes, 24 * 60 * 60 * 1000);
        fazerBackupIndicacoes();
      }, tempoAteBackup);
      
      console.log("Todos os intervalos configurados com sucesso");
    } catch (error) {
      console.error("Erro ao configurar intervalos:", error);
      registrarLogLocal(`Erro ao configurar intervalos: ${error.message}`, "ERROR", "clientReady", null);
    }
  } catch (error) {
    console.error("Erro no evento ready:", error);
    registrarLogLocal(`Erro no evento ready: ${error.message}`, "ERROR", "clientReady", null);
  }
});

client.on("disconnected", async (reason) => {
  try {
    console.log("Cliente desconectado:", reason);
    registrarLogLocal(
      `Cliente desconectado: ${reason}`,
      "WARN",
      "clientEvent",
      null
    );

    // Aguardar antes de tentar reconectar
    console.log("Aguardando antes de tentar reconectar...");
    await new Promise(resolve => setTimeout(resolve, 30000));

    // Tentar reconexão via PM2
    const { exec } = require('child_process');
    exec('pm2 restart bot --update-env', (error, stdout, stderr) => {
      if (error) {
        console.error('Erro ao reiniciar via PM2:', error.message);
        registrarLogLocal(`Erro ao reiniciar via PM2: ${error.message}`, "ERROR", "clientDisconnected", null);
      } else {
        console.log('Reinício via PM2 solicitado após desconexão');
        registrarLogLocal("Reinício via PM2 solicitado após desconexão", "INFO", "clientDisconnected", null);
      }
    });
  } catch (error) {
    console.error("Erro no evento disconnected:", error);
  }
});

client.on('change_state', (state) => {
  try {
    console.log('Estado do cliente mudou para:', state);
    registrarLogLocal(
      `Estado do cliente mudou para: ${state}`,
      "INFO",
      "clientStateChange",
      null
    );
    
    // Se o estado for CONFLICT, tentar takeover
    if (state === 'CONFLICT') {
      console.log('Detectado conflito, tentando takeover...');
      client.takeOver();
    }
  } catch (error) {
    console.error("Erro no evento change_state:", error);
  }
});

// Adicionar handlers para erros do cliente
client.on('error', (error) => {
  console.error('Erro do cliente WhatsApp:', error);
  registrarLogLocal(`Erro do cliente WhatsApp: ${error.message}`, "ERROR", "clientError", null);
  
  // Se for um erro crítico, tentar reinício
  if (error.message.includes('Protocol error') || error.message.includes('Session closed')) {
    console.log('Erro crítico detectado, agendando reinício...');
    setTimeout(() => {
      reinicioSuave().catch(err => console.error('Erro durante reinício:', err));
    }, 10000);
  }
});

// Função para inicializar o bot de forma robusta
async function inicializarBot() {
  try {
    console.log("Iniciando bot WhatsApp...");
    registrarLogLocal("Iniciando inicialização do bot", "INFO", "inicializarBot", null);
    
    // Verificar se o ambiente está configurado corretamente
    if (!process.env.PUPPETEER_EXECUTABLE_PATH) {
      process.env.PUPPETEER_EXECUTABLE_PATH = '/usr/bin/chromium-browser';
    }
    
    // Limpar diretórios temporários antigos
    const { exec } = require('child_process');
    exec('rm -rf /tmp/chrome-* 2>/dev/null || true', () => {});
    
    // Criar diretórios necessários
    const dirs = ['./logs', './session', './backups', '/tmp/chrome-user-data', '/tmp/chrome-data', '/tmp/chrome-cache'];
    dirs.forEach(dir => {
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      } catch (error) {
        console.error(`Erro ao criar diretório ${dir}:`, error.message);
      }
    });
    
    // Inicializar dados do Supabase
    await inicializarDados();
    
    // Inicializar cliente WhatsApp com retry
    let tentativas = 0;
    const maxTentativas = 3;
    
    while (tentativas < maxTentativas) {
      try {
        tentativas++;
        console.log(`Tentativa ${tentativas} de inicialização do cliente...`);
        
        await client.initialize();
        
        console.log("Cliente inicializado com sucesso!");
        registrarLogLocal("Cliente inicializado com sucesso", "INFO", "inicializarBot", null);
        break;
        
      } catch (error) {
        console.error(`Erro na tentativa ${tentativas}:`, error.message);
        registrarLogLocal(
          `Erro na tentativa ${tentativas} de inicialização: ${error.message}`,
          "ERROR",
          "inicializarBot",
          null
        );
        
        if (tentativas < maxTentativas) {
          console.log(`Aguardando antes da próxima tentativa...`);
          await new Promise(resolve => setTimeout(resolve, 15000));
          
          // Limpar sessão se erro persistir
          if (tentativas === 2) {
            console.log("Limpando sessão antes da última tentativa...");
            exec('rm -rf ./session/.wwebjs_* 2>/dev/null || true', () => {});
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        } else {
          throw new Error(`Falha em todas as ${maxTentativas} tentativas de inicialização`);
        }
      }
    }
    
  } catch (error) {
    console.error("Erro crítico na inicialização:", error);
    registrarLogLocal(
      `Erro crítico na inicialização: ${error.message}`,
      "ERROR",
      "inicializarBot",
      null
    );
    
    // Aguardar e tentar novamente via PM2
    setTimeout(() => {
      console.log("Tentando reinício via PM2...");
      exec('pm2 restart bot --update-env', (err) => {
        if (err) {
          console.error("Erro no reinício via PM2:", err.message);
          process.exit(1);
        }
      });
    }, 10000);
  }
}

// Inicializar cliente WhatsApp com tratamento de erros robusto
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: './session',
    clientId: 'bot-session'
  }),
  puppeteer: obterConfigPuppeteer(),
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
  },
  // Configurações adicionais para estabilidade
  qrMaxRetries: 5,
  restartOnAuthFail: true,
  takeoverOnConflict: true,
  takeoverTimeoutMs: 60000,
});

// Tratamento global de erros não capturados
process.on('unhandledRejection', (reason, promise) => {
  console.error('Erro não tratado (unhandledRejection):', reason);
  registrarLogLocal(
    `Erro não tratado: ${reason}`,
    "ERROR",
    "unhandledRejection",
    null
  );
});

process.on('uncaughtException', (error) => {
  console.error('Exceção não capturada:', error);
  registrarLogLocal(
    `Exceção não capturada: ${error.message}`,
    "ERROR",
    "uncaughtException",
    null
  );
  
  // Tentar reinício suave em caso de erro crítico
  setTimeout(() => {
    reinicioSuave().catch(err => {
      console.error('Erro durante reinício de emergência:', err);
      process.exit(1);
    });
  }, 5000);
});

// Configurar handlers de sinal para shutdown gracioso
process.on('SIGTERM', async () => {
  console.log('Recebido SIGTERM, fazendo shutdown gracioso...');
  await reinicioSuave();
});

process.on('SIGINT', async () => {
  console.log('Recebido SIGINT, fazendo shutdown gracioso...');
  await reinicioSuave();
});

//Agendamento de reinicio automático
function agendarReinicioPreventivo() {
  const horaReinicio = obterDataBrasilia();

  // Programar para reiniciar às 4:00 AM (horário de menor movimento)
  horaReinicio.setHours(4, 0, 0, 0);

  // Se já passou das 4:00 hoje, programe para amanhã
  if (obterDataBrasilia() > horaReinicio) {
    horaReinicio.setDate(horaReinicio.getDate() + 1);
  }

  const msAteReinicio = horaReinicio - obterDataBrasilia();

  console.log(
    `Reinício preventivo programado para: ${horaReinicio.toLocaleString(
      "pt-BR"
    )}`
  );
  registrarLogLocal(
    `Reinício preventivo programado para: ${horaReinicio.toLocaleString(
      "pt-BR"
    )}`,
    "INFO",
    "agendarReinicioPreventivo",
    null
  );

  setTimeout(async () => {
    console.log("Executando reinício preventivo programado");
    registrarLogLocal(
      "Executando reinício preventivo programado",
      "INFO",
      "reinicioPreventivo",
      null
    );

    try {
      await reinicioSuave();

      // Agendar próximo reinício
      agendarReinicioPreventivo();
    } catch (error) {
      console.error("Erro durante reinício preventivo:", error);
      registrarLogLocal(
        `Erro durante reinício preventivo: ${error.message}`,
        "ERROR",
        "reinicioPreventivo",
        null
      );

      // Tentar novamente em 1 hora em caso de falha
      setTimeout(agendarReinicioPreventivo, 60 * 60 * 1000);
    }
  }, msAteReinicio);
}

async function salvarSessao(chatId, sessaoData) {
  try {
    // Atualiza a cópia em memória
    userSessions.set(chatId, sessaoData);

    // Salva no Supabase
    await supabaseClient.salvarSessao(chatId, sessaoData);

    // Log apenas para confirmar
    console.log(`Sessão ${chatId} salva no Supabase`);
    return true;
  } catch (error) {
    console.error(`Erro ao salvar sessão ${chatId}:`, error);
    return false;
  }
}
//Ping periódico para ver se o bot está ativo
async function verificarConexaoAtiva() {
  try {
    // Verifica se o estado reportado é "CONNECTED"
    const estadoReportado = await client.getState();
    console.log(`Estado reportado: ${estadoReportado}`);

    if (estadoReportado !== "CONNECTED") {
      console.log("Estado diferente de CONNECTED, reconectando...");
      registrarLogLocal(
        "Estado não conectado detectado, forçando reconexão",
        "WARN",
        "verificarConexaoAtiva",
        null
      );

      // Tenta reconectar
      setTimeout(() => {
        client.initialize();
      }, 5000);
      return;
    }

    // Mesmo que o estado seja CONNECTED, vamos testar enviando uma mensagem para nós mesmos
    const ultimaMensagemRecebida = Date.now() - ultimaAtividadeTempo;

    // Se ficou mais de 20 minutos sem receber mensagens, teste enviando para si mesmo
    if (ultimaMensagemRecebida > 20 * 60 * 1000) {
      console.log(
        "Mais de 20 minutos sem receber mensagens, testando conexão..."
      );

      try {
        // Enviar mensagem invisível para si mesmo (não aparece no WhatsApp)
        const timestamp = new Date().toISOString();
        await client.sendMessage(`${adminNumber}@c.us`, `_ping_${timestamp}_`);
        console.log("Ping enviado para teste de conexão");

        // Definir um timeout para verificar se a mensagem foi recebida
        setTimeout(async () => {
          // Se o tempo da última atividade não mudou, algo está errado
          if (Date.now() - ultimaAtividadeTempo > 21 * 60 * 1000) {
            console.log("Ping não foi detectado, forçando reinicialização...");
            registrarLogLocal(
              "Ping não detectado, conexão parece estar quebrada",
              "ERROR",
              "verificarConexaoAtiva",
              null
            );
            await reinicioSuave();
          }
        }, 90000); // Espere 90 segundos para ver se o ping é detectado
      } catch (error) {
        console.error("Erro ao enviar ping:", error);
        registrarLogLocal(
          `Erro ao enviar ping: ${error.message}`,
          "ERROR",
          "verificarConexaoAtiva",
          null
        );
        await reinicioSuave();
      }
    }
  } catch (error) {
    console.error("Erro ao verificar conexão ativa:", error);
    registrarLogLocal(
      `Erro ao verificar conexão ativa: ${error.message}`,
      "ERROR",
      "verificarConexaoAtiva",
      null
    );

    // Se houve erro ao verificar, tente reiniciar
    await reinicioSuave();
  }
}

// Chamar esta função na inicialização
agendarReinicioPreventivo();

// Adicionar o ping periódico aos timers existentes
setInterval(verificarConexaoAtiva, 10 * 60 * 1000); // Verificar a cada 10 minutos

// Função para reinício suave com ambiente configurado
async function reinicioSuave() {
  console.log("Realizando reinício suave do bot...");
  registrarLogLocal(
    "Realizando reinício suave do bot",
    "INFO",
    "reinicioSuave",
    null
  );

  try {
    // 1. Salvar sessões de usuários
    console.log("Salvando sessões de usuários...");
    for (const [chatId, sessao] of userSessions.entries()) {
      await supabaseClient.salvarSessao(chatId, sessao).catch(err => 
        console.log(`Erro ao salvar sessão ${chatId}:`, err.message)
      );
    }

    // 2. Fechar cliente WhatsApp graciosamente
    console.log("Fechando cliente WhatsApp...");
    try {
      if (client && typeof client.destroy === 'function') {
        await Promise.race([
          client.destroy(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout ao fechar cliente')), 10000)
          )
        ]);
      }
    } catch (closeError) {
      console.log("Erro ao fechar cliente:", closeError.message);
    }

    // 3. Limpar processos do browser e preparar ambiente VPS
    console.log("Limpando processos do browser e preparando ambiente VPS...");
    const { exec } = require('child_process');
    
    // Comandos específicos para VPS headless
    const comandosLimpeza = [
      'pkill -f "chromium" || true',
      'pkill -f "chrome" || true',
      'pkill -f "Xvfb" || true', // Limpar display virtual se existir
      'rm -rf /tmp/chrome-* || true',
      'rm -rf /tmp/.X* || true',
      'rm -rf /tmp/.com.google.Chrome* || true',
      'mkdir -p /tmp/chrome-user-data /tmp/chrome-data /tmp/chrome-cache || true',
      'chmod -R 755 /tmp/chrome-* || true'
    ];

    for (const comando of comandosLimpeza) {
      await new Promise((resolve) => {
        exec(comando, (error) => {
          // Ignorar erros de comandos de limpeza
          resolve();
        });
      });
    }

    // 4. Aguardar limpeza completa
    console.log("Aguardando limpeza de recursos...");
    await new Promise((resolve) => setTimeout(resolve, 8000)); // Reduzido para VPS

    // 5. Configurar ambiente para VPS headless
    console.log("Configurando ambiente para VPS headless...");
    delete process.env.DISPLAY; // Remover DISPLAY para VPS
    process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = 'true';
    process.env.PUPPETEER_EXECUTABLE_PATH = '/usr/bin/chromium-browser';
    process.env.HOME = process.env.HOME || '/root';
    process.env.XDG_CONFIG_HOME = '/tmp/.config';
    process.env.XDG_CACHE_HOME = '/tmp/.cache';
    process.env.CHROME_DEVEL_SANDBOX = '/usr/lib/chromium-browser/chrome-sandbox';
    
    // 6. Forçar coleta de lixo
    if (global.gc) {
      console.log("Executando coleta de lixo...");
      global.gc();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      global.gc();
    }

    // 7. Resetar variáveis de estado
    mensagensRecebidas = 0;
    global.respostasEnviadas = 0;
    ultimaAtividadeTempo = Date.now();

    // 8. Criar script de reinício otimizado para VPS
    const scriptReinicio = `#!/bin/bash
# Script otimizado para VPS headless

# Configurar ambiente
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
export HOME=${process.env.HOME || '/root'}
export XDG_CONFIG_HOME=/tmp/.config
export XDG_CACHE_HOME=/tmp/.cache
export CHROME_DEVEL_SANDBOX=/usr/lib/chromium-browser/chrome-sandbox

# Remover DISPLAY para VPS
unset DISPLAY

# Verificar se chromium existe
if ! command -v chromium-browser &> /dev/null; then
    echo "Chromium não encontrado, tentando instalar..."
    apt-get update && apt-get install -y chromium-browser
fi

# Criar diretórios necessários
mkdir -p /tmp/.config /tmp/.cache /tmp/chrome-user-data /tmp/chrome-data /tmp/chrome-cache
chmod -R 755 /tmp/chrome-* /tmp/.config /tmp/.cache

# Verificar recursos do sistema
echo "Memória disponível:"
free -h

# Reiniciar com PM2
pm2 restart bot --update-env --force
`;

    fs.writeFileSync('/tmp/restart_bot_vps.sh', scriptReinicio);
    await new Promise((resolve) => {
      exec('chmod +x /tmp/restart_bot_vps.sh', () => resolve());
    });

    // 9. Executar reinício otimizado para VPS
    console.log("Executando reinício otimizado para VPS...");
    registrarLogLocal(
      "Executando reinício otimizado para VPS",
      "INFO",
      "reinicioSuave",
      null
    );

    exec('/tmp/restart_bot_vps.sh', (error, stdout, stderr) => {
      if (error) {
        console.error('Erro no reinício VPS:', error.message);
        registrarLogLocal(
          `Erro no reinício VPS: ${error.message}`,
          "ERROR",
          "reinicioSuave",
          null
        );
        
        // Fallback: reinício simples
        exec('pm2 restart bot --update-env --force', (fallbackError) => {
          if (fallbackError) {
            console.error('Erro no fallback:', fallbackError.message);
          }
        });
      } else {
        console.log('Reinício VPS executado com sucesso');
        registrarLogLocal(
          "Reinício VPS executado com sucesso",
          "INFO",
          "reinicioSuave",
          null
        );
      }
    });

    return true;

  } catch (error) {
    console.error("Erro durante reinício suave:", error);
    registrarLogLocal(
      `Erro durante reinício suave: ${error.message}`,
      "ERROR",
      "reinicioSuave",
      null
    );

    // Fallback: forçar reinício via PM2
    console.log("Executando reinício de emergência...");
    const { exec } = require('child_process');
    
    exec('pm2 restart bot --force', (error, stdout, stderr) => {
      if (error) {
        console.error('Erro no reinício de emergência:', error.message);
      } else {
        console.log('Reinício de emergência executado');
      }
    });

    return false;
  }
}
// Verificar estado da conexão regularmente
async function verificarEstadoConexao() {
  try {
    console.log("Verificando estado da conexão...");
    
    if (!client) {
      console.log("Cliente não inicializado");
      return false;
    }

    const info = await client.getState().catch(() => null);
    console.log(`Estado atual: ${info || 'Desconhecido'}`);
    
    registrarLogLocal(
      `Verificação de conexão - Estado: ${info || 'Desconhecido'}`,
      "INFO",
      "verificarEstadoConexao",
      null
    );

    // Atualizar timestamp da última atividade
    ultimaAtividadeTempo = Date.now();
    
    return info === 'CONNECTED';
  } catch (error) {
    console.error("Erro ao verificar estado da conexão:", error.message);
    registrarLogLocal(
      `Erro ao verificar estado da conexão: ${error.message}`,
      "ERROR",
      "verificarEstadoConexao",
      null
    );
    return false;
  }
}

// Monitorar saúde do bot
function monitorarSaudeBot() {
  // Verifica se o sistema está respondendo
  const tempoInativo = Date.now() - ultimaAtividadeTempo;

  // Contar sessões em modo humano para ajustar expectativas
  let sessoesHumano = 0;
  for (const [_, session] of userSessions.entries()) {
    if (session.step === "humano") {
      sessoesHumano++;
    }
  }

  if (mensagensRecebidas > 0) {
    console.log(
      `Status do bot: Recebidas ${mensagensRecebidas}, Respondidas ${respostasEnviadas}, Modo humano: ${sessoesHumano}, Inativo por ${Math.floor(
        tempoInativo / 1000
      )}s`
    );

    // Ajustar critério considerando sessões em atendimento humano
    if (
      mensagensRecebidas - respostasEnviadas > 3 + sessoesHumano * 2 &&
      tempoInativo > 2 * 60 * 1000
    ) {
      if (monitoramentoAtivo) {
        console.error(
          "🔄 PROBLEMA DETECTADO: Bot recebendo mensagens mas não respondendo."
        );
        registrarLogLocal(
          "PROBLEMA DETECTADO: Bot recebendo mensagens mas não respondendo.",
          "ERROR",
          "monitorarSaudeBot",
          null
        );

        // Evita reinícios múltiplos
        monitoramentoAtivo = false;

        // Tenta reinício suave
        reinicioSuave().then((sucesso) => {
          if (sucesso) {
            console.log("Reinício automático bem sucedido!");
            registrarLogLocal(
              "Reinício automático bem sucedido",
              "INFO",
              "monitorarSaudeBot",
              null
            );
          } else {
            console.error("Reinício automático falhou");
            registrarLogLocal(
              "Reinício automático falhou",
              "ERROR",
              "monitorarSaudeBot",
              null
            );
          }

          // Reativa o monitoramento após um tempo
          setTimeout(() => {
            monitoramentoAtivo = true;
          }, 15000);
        });
      }
    }
  }
}

// HANDLERS DE EVENTOS COM TRATAMENTO ROBUSTO DE ERROS
client.on("qr", (qr) => {
  try {
    qrcode.generate(qr, { small: true });
    console.log("QR Code gerado. Escaneie-o com seu WhatsApp.");
    registrarLogLocal("QR Code gerado", "INFO", "clientQR", null);
  } catch (error) {
    console.error("Erro ao gerar QR code:", error);
    registrarLogLocal(`Erro ao gerar QR code: ${error.message}`, "ERROR", "clientQR", null);
  }
});

client.on("authenticated", () => {
  try {
    const mensagem = "Autenticado com sucesso!";
    console.log(mensagem);
    registrarLogLocal(mensagem, "INFO", "clientAuth", null);
  } catch (error) {
    console.error("Erro no evento authenticated:", error);
  }
});

client.on("auth_failure", (session) => {
  console.error("Falha na autenticação:", session);
  registrarLogLocal(`Falha na autenticação: ${session}`, "ERROR", "clientAuthFailure", null);
  
  // Tentar limpar sessão corrompida e reiniciar
  setTimeout(async () => {
    try {
      console.log("Limpando sessão após falha de autenticação...");
      const { exec } = require('child_process');
      exec('rm -rf ./session/.wwebjs_*', () => {
        console.log("Sessão limpa, reiniciando...");
        reinicioSuave();
      });
    } catch (error) {
      console.error("Erro ao limpar sessão:", error);
    }
  }, 5000);
});

client.on("ready", async () => {
  try {
    const mensagem = "Bot está pronto!";
    console.log(mensagem);
    registrarLogLocal(mensagem, "INFO", "clientReady", null);

    // Configurar timeouts e intervalos com tratamento de erro
    try {
      setInterval(() => {
        verificarTestesPendentes().catch(err => 
          console.error("Erro em verificarTestesPendentes:", err)
        );
      }, 15 * 60 * 1000);
      
      setInterval(monitorarSaudeBot, 60000);
      
      setInterval(() => {
        verificarEstadoConexao().catch(err => 
          console.error("Erro em verificarEstadoConexao:", err)
        );
      }, 15 * 60 * 1000);
      
      setInterval(() => {
        salvarTodasSessoes().catch(err => 
          console.error("Erro em salvarTodasSessoes:", err)
        );
      }, 5 * 60 * 1000);
      
      setInterval(() => {
        limparSessoesExpiradas().catch(err => 
          console.error("Erro em limparSessoesExpiradas:", err)
        );
      }, 60 * 60 * 1000);
      
      setInterval(monitorarMemoria, 2 * 60 * 1000);
      
      setInterval(() => {
        backupDadosCriticos().catch(err => 
          console.error("Erro em backupDadosCriticos:", err)
        );
      }, 6 * 60 * 60 * 1000);

      // Executar limpeza inicial
      await limparSessoesExpiradas();
      await backupDadosCriticos();

      // Programar backup diário
      const agora = obterDataBrasilia();
      const proximaMeiaNoite = new Date(obterDataBrasilia());
      proximaMeiaNoite.setHours(24, 0, 0, 0);
      const tempoAteBackup = proximaMeiaNoite - agora;

      setTimeout(() => {
        setInterval(fazerBackupIndicacoes, 24 * 60 * 60 * 1000);
        fazerBackupIndicacoes();
      }, tempoAteBackup);
      
      console.log("Todos os intervalos configurados com sucesso");
    } catch (error) {
      console.error("Erro ao configurar intervalos:", error);
      registrarLogLocal(`Erro ao configurar intervalos: ${error.message}`, "ERROR", "clientReady", null);
    }
  } catch (error) {
    console.error("Erro no evento ready:", error);
    registrarLogLocal(`Erro no evento ready: ${error.message}`, "ERROR", "clientReady", null);
  }
});

client.on("disconnected", async (reason) => {
  try {
    console.log("Cliente desconectado:", reason);
    registrarLogLocal(
      `Cliente desconectado: ${reason}`,
      "WARN",
      "clientEvent",
      null
    );

    // Aguardar antes de tentar reconectar
    console.log("Aguardando antes de tentar reconectar...");
    await new Promise(resolve => setTimeout(resolve, 30000));

    // Tentar reconexão via PM2
    const { exec } = require('child_process');
    exec('pm2 restart bot --update-env', (error, stdout, stderr) => {
      if (error) {
        console.error('Erro ao reiniciar via PM2:', error.message);
        registrarLogLocal(`Erro ao reiniciar via PM2: ${error.message}`, "ERROR", "clientDisconnected", null);
      } else {
        console.log('Reinício via PM2 solicitado após desconexão');
        registrarLogLocal("Reinício via PM2 solicitado após desconexão", "INFO", "clientDisconnected", null);
      }
    });
  } catch (error) {
    console.error("Erro no evento disconnected:", error);
  }
});

client.on('change_state', (state) => {
  try {
    console.log('Estado do cliente mudou para:', state);
    registrarLogLocal(
      `Estado do cliente mudou para: ${state}`,
      "INFO",
      "clientStateChange",
      null
    );
    
    // Se o estado for CONFLICT, tentar takeover
    if (state === 'CONFLICT') {
      console.log('Detectado conflito, tentando takeover...');
      client.takeOver();
    }
  } catch (error) {
    console.error("Erro no evento change_state:", error);
  }
});

// Adicionar handlers para erros do cliente
client.on('error', (error) => {
  console.error('Erro do cliente WhatsApp:', error);
  registrarLogLocal(`Erro do cliente WhatsApp: ${error.message}`, "ERROR", "clientError", null);
  
  // Se for um erro crítico, tentar reinício
  if (error.message.includes('Protocol error') || error.message.includes('Session closed')) {
    console.log('Erro crítico detectado, agendando reinício...');
    setTimeout(() => {
      reinicioSuave().catch(err => console.error('Erro durante reinício:', err));
    }, 10000);
  }
});

// Função para inicializar o bot de forma robusta
async function inicializarBot() {
  try {
    console.log("Iniciando bot WhatsApp...");
    registrarLogLocal("Iniciando inicialização do bot", "INFO", "inicializarBot", null);
    
    // Verificar se o ambiente está configurado corretamente
    if (!process.env.PUPPETEER_EXECUTABLE_PATH) {
      process.env.PUPPETEER_EXECUTABLE_PATH = '/usr/bin/chromium-browser';
    }
    
    // Limpar diretórios temporários antigos
    const { exec } = require('child_process');
    exec('rm -rf /tmp/chrome-* 2>/dev/null || true', () => {});
    
    // Criar diretórios necessários
    const dirs = ['./logs', './session', './backups', '/tmp/chrome-user-data', '/tmp/chrome-data', '/tmp/chrome-cache'];
    dirs.forEach(dir => {
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      } catch (error) {
        console.error(`Erro ao criar diretório ${dir}:`, error.message);
      }
    });
    
    // Inicializar dados do Supabase
    await inicializarDados();
    
    // Inicializar cliente WhatsApp com retry
    let tentativas = 0;
    const maxTentativas = 3;
    
    while (tentativas < maxTentativas) {
      try {
        tentativas++;
        console.log(`Tentativa ${tentativas} de inicialização do cliente...`);
        
        await client.initialize();
        
        console.log("Cliente inicializado com sucesso!");
        registrarLogLocal("Cliente inicializado com sucesso", "INFO", "inicializarBot", null);
        break;
        
      } catch (error) {
        console.error(`Erro na tentativa ${tentativas}:`, error.message);
        registrarLogLocal(
          `Erro na tentativa ${tentativas} de inicialização: ${error.message}`,
          "ERROR",
          "inicializarBot",
          null
        );
        
        if (tentativas < maxTentativas) {
          console.log(`Aguardando antes da próxima tentativa...`);
          await new Promise(resolve => setTimeout(resolve, 15000));
          
          // Limpar sessão se erro persistir
          if (tentativas === 2) {
            console.log("Limpando sessão antes da última tentativa...");
            exec('rm -rf ./session/.wwebjs_* 2>/dev/null || true', () => {});
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        } else {
          throw new Error(`Falha em todas as ${maxTentativas} tentativas de inicialização`);
        }
      }
    }
    
  } catch (error) {
    console.error("Erro crítico na inicialização:", error);
    registrarLogLocal(
      `Erro crítico na inicialização: ${error.message}`,
      "ERROR",
      "inicializarBot",
      null
    );
    
    // Aguardar e tentar novamente via PM2
    setTimeout(() => {
      console.log("Tentando reinício via PM2...");
      exec('pm2 restart bot --update-env', (err) => {
        if (err) {
          console.error("Erro no reinício via PM2:", err.message);
          process.exit(1);
        }
      });
    }, 10000);
  }
}

// Inicializar cliente WhatsApp com tratamento de erros robusto
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: './session',
    clientId: 'bot-session'
  }),
  puppeteer: obterConfigPuppeteer(),
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
  },
  // Configurações adicionais para estabilidade
  qrMaxRetries: 5,
  restartOnAuthFail: true,
  takeoverOnConflict: true,
  takeoverTimeoutMs: 60000,
});

// Tratamento global de erros não capturados
process.on('unhandledRejection', (reason, promise) => {
  console.error('Erro não tratado (unhandledRejection):', reason);
  registrarLogLocal(
    `Erro não tratado: ${reason}`,
    "ERROR",
    "unhandledRejection",
    null
  );
});

process.on('uncaughtException', (error) => {
  console.error('Exceção não capturada:', error);
  registrarLogLocal(
    `Exceção não capturada: ${error.message}`,
    "ERROR",
    "uncaughtException",
    null
  );
  
  // Tentar reinício suave em caso de erro crítico
  setTimeout(() => {
    reinicioSuave().catch(err => {
      console.error('Erro durante reinício de emergência:', err);
      process.exit(1);
    });
  }, 5000);
});

// Configurar handlers de sinal para shutdown gracioso
process.on('SIGTERM', async () => {
  console.log('Recebido SIGTERM, fazendo shutdown gracioso...');
  await reinicioSuave();
});

process.on('SIGINT', async () => {
  console.log('Recebido SIGINT, fazendo shutdown gracioso...');
  await reinicioSuave();
});

//Agendamento de reinicio automático
function agendarReinicioPreventivo() {
  const horaReinicio = obterDataBrasilia();

  // Programar para reiniciar às 4:00 AM (horário de menor movimento)
  horaReinicio.setHours(4, 0, 0, 0);

  // Se já passou das 4:00 hoje, programe para amanhã
  if (obterDataBrasilia() > horaReinicio) {
    horaReinicio.setDate(horaReinicio.getDate() + 1);
  }

  const msAteReinicio = horaReinicio - obterDataBrasilia();

  console.log(
    `Reinício preventivo programado para: ${horaReinicio.toLocaleString(
      "pt-BR"
    )}`
  );
  registrarLogLocal(
    `Reinício preventivo programado para: ${horaReinicio.toLocaleString(
      "pt-BR"
    )}`,
    "INFO",
    "agendarReinicioPreventivo",
    null
  );

  setTimeout(async () => {
    console.log("Executando reinício preventivo programado");
    registrarLogLocal(
      "Executando reinício preventivo programado",
      "INFO",
      "reinicioPreventivo",
      null
    );

    try {
      await reinicioSuave();

      // Agendar próximo reinício
      agendarReinicioPreventivo();
    } catch (error) {
      console.error("Erro durante reinício preventivo:", error);
      registrarLogLocal(
        `Erro durante reinício preventivo: ${error.message}`,
        "ERROR",
        "reinicioPreventivo",
        null
      );

      // Tentar novamente em 1 hora em caso de falha
      setTimeout(agendarReinicioPreventivo, 60 * 60 * 1000);
    }
  }, msAteReinicio);
}

async function salvarSessao(chatId, sessaoData) {
  try {
    // Atualiza a cópia em memória
    userSessions.set(chatId, sessaoData);

    // Salva no Supabase
    await supabaseClient.salvarSessao(chatId, sessaoData);

    // Log apenas para confirmar
    console.log(`Sessão ${chatId} salva no Supabase`);
    return true;
  } catch (error) {
    console.error(`Erro ao salvar sessão ${chatId}:`, error);
    return false;
  }
}
//Ping periódico para ver se o bot está ativo
async function verificarConexaoAtiva() {
  try {
    // Verifica se o estado reportado é "CONNECTED"
    const estadoReportado = await client.getState();
    console.log(`Estado reportado: ${estadoReportado}`);

    if (estadoReportado !== "CONNECTED") {
      console.log("Estado diferente de CONNECTED, reconectando...");
      registrarLogLocal(
        "Estado não conectado detectado, forçando reconexão",
        "WARN",
        "verificarConexaoAtiva",
        null
      );

      // Tenta reconectar
      setTimeout(() => {
        client.initialize();
      }, 5000);
      return;
    }

    // Mesmo que o estado seja CONNECTED, vamos testar enviando uma mensagem para nós mesmos
    const ultimaMensagemRecebida = Date.now() - ultimaAtividadeTempo;

    // Se ficou mais de 20 minutos sem receber mensagens, teste enviando para si mesmo
    if (ultimaMensagemRecebida > 20 * 60 * 1000) {
      console.log(
        "Mais de 20 minutos sem receber mensagens, testando conexão..."
      );

      try {
        // Enviar mensagem invisível para si mesmo (não aparece no WhatsApp)
        const timestamp = new Date().toISOString();
        await client.sendMessage(`${adminNumber}@c.us`, `_ping_${timestamp}_`);
        console.log("Ping enviado para teste de conexão");

        // Definir um timeout para verificar se a mensagem foi recebida
        setTimeout(async () => {
          // Se o tempo da última atividade não mudou, algo está errado
          if (Date.now() - ultimaAtividadeTempo > 21 * 60 * 1000) {
            console.log("Ping não foi detectado, forçando reinicialização...");
            registrarLogLocal(
              "Ping não detectado, conexão parece estar quebrada",
              "ERROR",
              "verificarConexaoAtiva",
              null
            );
            await reinicioSuave();
          }
        }, 90000); // Espere 90 segundos para ver se o ping é detectado
      } catch (error) {
        console.error("Erro ao enviar ping:", error);
        registrarLogLocal(
          `Erro ao enviar ping: ${error.message}`,
          "ERROR",
          "verificarConexaoAtiva",
          null
        );
        await reinicioSuave();
      }
    }
  } catch (error) {
    console.error("Erro ao verificar conexão ativa:", error);
    registrarLogLocal(
      `Erro ao verificar conexão ativa: ${error.message}`,
      "ERROR",
      "verificarConexaoAtiva",
      null
    );

    // Se houve erro ao verificar, tente reiniciar
    await reinicioSuave();
  }
}

// Chamar esta função na inicialização
agendarReinicioPreventivo();

// Adicionar o ping periódico aos timers existentes
setInterval(verificarConexaoAtiva, 10 * 60 * 1000); // Verificar a cada 10 minutos

// Função para reinício suave com ambiente configurado
async function reinicioSuave() {
  console.log("Realizando reinício suave do bot...");
  registrarLogLocal(
    "Realizando reinício suave do bot",
    "INFO",
    "reinicioSuave",
    null
  );

  try {
    // 1. Salvar sessões de usuários
    console.log("Salvando sessões de usuários...");
    for (const [chatId, sessao] of userSessions.entries()) {
      await supabaseClient.salvarSessao(chatId, sessao).catch(err => 
        console.log(`Erro ao salvar sessão ${chatId}:`, err.message)
      );
    }

    // 2. Fechar cliente WhatsApp graciosamente
    console.log("Fechando cliente WhatsApp...");
    try {
      if (client && typeof client.destroy === 'function') {
        await Promise.race([
          client.destroy(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout ao fechar cliente')), 10000)
          )
        ]);
      }
    } catch (closeError) {
      console.log("Erro ao fechar cliente:", closeError.message);
    }

    // 3. Limpar processos do browser e preparar ambiente VPS
    console.log("Limpando processos do browser e preparando ambiente VPS...");
    const { exec } = require('child_process');
    
    // Comandos específicos para VPS headless
    const comandosLimpeza = [
      'pkill -f "chromium" || true',
      'pkill -f "chrome" || true',
      'pkill -f "Xvfb" || true', // Limpar display virtual se existir
      'rm -rf /tmp/chrome-* || true',
      'rm -rf /tmp/.X* || true',
      'rm -rf /tmp/.com.google.Chrome* || true',
      'mkdir -p /tmp/chrome-user-data /tmp/chrome-data /tmp/chrome-cache || true',
      'chmod -R 755 /tmp/chrome-* || true'
    ];

    for (const comando of comandosLimpeza) {
      await new Promise((resolve) => {
        exec(comando, (error) => {
          // Ignorar erros de comandos de limpeza
          resolve();
        });
      });
    }

    // 4. Aguardar limpeza completa
    console.log("Aguardando limpeza de recursos...");
    await new Promise((resolve) => setTimeout(resolve, 8000)); // Reduzido para VPS

    // 5. Configurar ambiente para VPS headless
    console.log("Configurando ambiente para VPS headless...");
    delete process.env.DISPLAY; // Remover DISPLAY para VPS
    process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = 'true';
    process.env.PUPPETEER_EXECUTABLE_PATH = '/usr/bin/chromium-browser';
    process.env.HOME = process.env.HOME || '/root';
    process.env.XDG_CONFIG_HOME = '/tmp/.config';
    process.env.XDG_CACHE_HOME = '/tmp/.cache';
    process.env.CHROME_DEVEL_SANDBOX = '/usr/lib/chromium-browser/chrome-sandbox';
    
    // 6. Forçar coleta de lixo
    if (global.gc) {
      console.log("Executando coleta de lixo...");
      global.gc();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      global.gc();
    }

    // 7. Resetar variáveis de estado
    mensagensRecebidas = 0;
    global.respostasEnviadas = 0;
    ultimaAtividadeTempo = Date.now();

    // 8. Criar script de reinício otimizado para VPS
    const scriptReinicio = `#!/bin/bash
# Script otimizado para VPS headless

# Configurar ambiente
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
export HOME=${process.env.HOME || '/root'}
export XDG_CONFIG_HOME=/tmp/.config
export XDG_CACHE_HOME=/tmp/.cache
export CHROME_DEVEL_SANDBOX=/usr/lib/chromium-browser/chrome-sandbox

# Remover DISPLAY para VPS
unset DISPLAY

# Verificar se chromium existe
if ! command -v chromium-browser &> /dev/null; then
    echo "Chromium não encontrado, tentando instalar..."
    apt-get update && apt-get install -y chromium-browser
fi

# Criar diretórios necessários
mkdir -p /tmp/.config /tmp/.cache /tmp/chrome-user-data /tmp/chrome-data /tmp/chrome-cache
chmod -R 755 /tmp/chrome-* /tmp/.config /tmp/.cache

# Verificar recursos do sistema
echo "Memória disponível:"
free -h

# Reiniciar com PM2
pm2 restart bot --update-env --force
`;

    fs.writeFileSync('/tmp/restart_bot_vps.sh', scriptReinicio);
    await new Promise((resolve) => {
      exec('chmod +x /tmp/restart_bot_vps.sh', () => resolve());
    });

    // 9. Executar reinício otimizado para VPS
    console.log("Executando reinício otimizado para VPS...");
    registrarLogLocal(
      "Executando reinício otimizado para VPS",
      "INFO",
      "reinicioSuave",
      null
    );

    exec('/tmp/restart_bot_vps.sh', (error, stdout, stderr) => {
      if (error) {
        console.error('Erro no reinício VPS:', error.message);
        registrarLogLocal(
          `Erro no reinício VPS: ${error.message}`,
          "ERROR",
          "reinicioSuave",
          null
        );
        
        // Fallback: reinício simples
        exec('pm2 restart bot --update-env --force', (fallbackError) => {
          if (fallbackError) {
            console.error('Erro no fallback:', fallbackError.message);
          }
        });
      } else {
        console.log('Reinício VPS executado com sucesso');
        registrarLogLocal(
          "Reinício VPS executado com sucesso",
          "INFO",
          "reinicioSuave",
          null
        );
      }
    });

    return true;

  } catch (error) {
    console.error("Erro durante reinício suave:", error);
    registrarLogLocal(
      `Erro durante reinício suave: ${error.message}`,
      "ERROR",
      "reinicioSuave",
      null
    );

    // Fallback: forçar reinício via PM2
    console.log("Executando reinício de emergência...");
    const { exec } = require('child_process');
    
    exec('pm2 restart bot --force', (error, stdout, stderr) => {
      if (error) {
        console.error('Erro no reinício de emergência:', error.message);
      } else {
        console.log('Reinício de emergência executado');
      }
    });

    return false;
  }
}
// Verificar estado da conexão regularmente
async function verificarEstadoConexao() {
  try {
    console.log("Verificando estado da conexão...");
    
    if (!client) {
      console.log("Cliente não inicializado");
      return false;
    }

    const info = await client.getState().catch(() => null);
    console.log(`Estado atual: ${info || 'Desconhecido'}`);
    
    registrarLogLocal(
      `Verificação de conexão - Estado: ${info || 'Desconhecido'}`,
      "INFO",
      "verificarEstadoConexao",
      null
    );

    // Atualizar timestamp da última atividade
    ultimaAtividadeTempo = Date.now();
    
    return info === 'CONNECTED';
  } catch (error) {
    console.error("Erro ao verificar estado da conexão:", error.message);
    registrarLogLocal(
      `Erro ao verificar estado da conexão: ${error.message}`,
      "ERROR",
      "verificarEstadoConexao",
      null
    );
    return false;
  }
}

// Monitorar saúde do bot
function monitorarSaudeBot() {
  // Verifica se o sistema está respondendo
  const tempoInativo = Date.now() - ultimaAtividadeTempo;

  // Contar sessões em modo humano para ajustar expectativas
  let sessoesHumano = 0;
  for (const [_, session] of userSessions.entries()) {
    if (session.step === "humano") {
      sessoesHumano++;
    }
  }

  if (mensagensRecebidas > 0) {
    console.log(
      `Status do bot: Recebidas ${mensagensRecebidas}, Respondidas ${respostasEnviadas}, Modo humano: ${sessoesHumano}, Inativo por ${Math.floor(
        tempoInativo / 1000
      )}s`
    );

    // Ajustar critério considerando sessões em atendimento humano
    if (
      mensagensRecebidas - respostasEnviadas > 3 + sessoesHumano * 2 &&
      tempoInativo > 2 * 60 * 1000
    ) {
      if (monitoramentoAtivo) {
        console.error(
          "🔄 PROBLEMA DETECTADO: Bot recebendo mensagens mas não respondendo."
        );
        registrarLogLocal(
          "PROBLEMA DETECTADO: Bot recebendo mensagens mas não respondendo.",
          "ERROR",
          "monitorarSaudeBot",
          null
        );

        // Evita reinícios múltiplos
        monitoramentoAtivo = false;

        // Tenta reinício suave
        reinicioSuave().then((sucesso) => {
          if (sucesso) {
            console.log("Reinício automático bem sucedido!");
            registrarLogLocal(
              "Reinício automático bem sucedido",
              "INFO",
              "monitorarSaudeBot",
              null
            );
          } else {
            console.error("Reinício automático falhou");
            registrarLogLocal(
              "Reinício automático falhou",
              "ERROR",
              "monitorarSaudeBot",
              null
            );
          }

          // Reativa o monitoramento após um tempo
          setTimeout(() => {
            monitoramentoAtivo = true;
          }, 15000);
        });
      }
    }
  }
}

// HANDLERS DE EVENTOS COM TRATAMENTO ROBUSTO DE ERROS
client.on("qr", (qr) => {
  try {
    qrcode.generate(qr, { small: true });
    console.log("QR Code gerado. Escaneie-o com seu WhatsApp.");
    registrarLogLocal("QR Code gerado", "INFO", "clientQR", null);
  } catch (error) {
    console.error("Erro ao gerar QR code:", error);
    registrarLogLocal(`Erro ao gerar QR code: ${error.message}`, "ERROR", "clientQR", null);
  }
});

client.on("authenticated", () => {
  try {
    const mensagem = "Autenticado com sucesso!";
    console.log(mensagem);
    registrarLogLocal(mensagem, "INFO", "clientAuth", null);
  } catch (error) {
    console.error("Erro no evento authenticated:", error);
  }
});

client.on("auth_failure", (session) => {
  console.error("Falha na autenticação:", session);
  registrarLogLocal(`Falha na autenticação: ${session}`, "ERROR", "clientAuthFailure", null);
  
  // Tentar limpar sessão corrompida e reiniciar
  setTimeout(async () => {
    try {
      console.log("Limpando sessão após falha de autenticação...");
      const { exec } = require('child_process');
      exec('rm -rf ./session/.wwebjs_*', () => {
        console.log("Sessão limpa, reiniciando...");
        reinicioSuave();
      });
    } catch (error) {
      console.error("Erro ao limpar sessão:", error);
    }
  }, 5000);
});

client.on("ready", async () => {
  try {
    const mensagem = "Bot está pronto!";
    console.log(mensagem);
    registrarLogLocal(mensagem, "INFO", "clientReady", null);

    // Configurar timeouts e intervalos com tratamento de erro
    try {
      setInterval(() => {
        verificarTestesPendentes().catch(err => 
          console.error("Erro em verificarTestesPendentes:", err)
        );
      }, 15 * 60 * 1000);
      
      setInterval(monitorarSaudeBot, 60000);
      
      setInterval(() => {
        verificarEstadoConexao().catch(err => 
          console.error("Erro em verificarEstadoConexao:", err)
        );
      }, 15 * 60 * 1000);
      
      setInterval(() => {
        salvarTodasSessoes().catch(err => 
          console.error("Erro em salvarTodasSessoes:", err)
        );
      }, 5 * 60 * 1000);
      
      setInterval(() => {
        limparSessoesExpiradas().catch(err => 
          console.error("Erro em limparSessoesExpiradas:", err)
        );
      }, 60 * 60 * 1000);
      
      setInterval(monitorarMemoria, 2 * 60 * 1000);
      
      setInterval(() => {
        backupDadosCriticos().catch(err => 
          console.error("Erro em backupDadosCriticos:", err)
        );
      }, 6 * 60 * 60 * 1000);

      // Executar limpeza inicial
          doc.fillColor('orange');
        } else {
          doc.fillColor('black');
        }
        
        // Texto da mensagem pode ser longo, ajustar para quebrar linhas
        const textoY = doc.y;
        doc.text(dataFormatada, 50, textoY, { width: 120 })
           .text(log.nivel, 170, textoY, { width: 50 })
           .text(log.origem || '-', 220, textoY, { width: 80 });
        
        // Calcular a altura necessária para a mensagem
        const alturaAnterior = doc.y;
        doc.text(log.mensagem, 300, textoY, { 
          width: doc.page.width - 350,
          align: 'left'
        });
        
        // Ajustar espaço para a próxima linha
        const alturaFinal = Math.max(doc.y, alturaAnterior);
        doc.y = alturaFinal + 5;
        
        // Resetar cor
        doc.fillColor('black');
      });
      
      // Finalizar o documento
      doc.end();
      
      // Retornar o caminho quando o arquivo estiver pronto
      stream.on('finish', () => {
        resolve(filePath);
      });
      
      stream.on('error', (err) => {
        reject(err);
      });
      
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = {
  client,
  handleMessage,
  reinicioSuave,
  userSessions,
  salvarTodasSessoes,
  limparSessoesExpiradas,
  backupDadosCriticos,
  monitorarMemoria,
  verificarEstadoConexao
};