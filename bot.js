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
  process.env.XVFB_WHD = '1920x1080x24'; // Configuração virtual se necessário
  
  return {
    headless: 'new', // Usar o novo modo headless do Chromium
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
      "--disable-features=TranslateUI",
      "--disable-features=VizDisplayCompositor",
      "--disable-features=AudioServiceOutOfProcess",
      "--disable-ipc-flooding-protection",
      
      // Otimizações de memória para VPS
      "--memory-pressure-off",
      "--max-old-space-size=512",
      "--single-process",
      "--no-zygote",
      
      // Desabilitar recursos desnecessários
      "--disable-extensions",
      "--disable-plugins",
      "--disable-images", // Opcional: desabilitar carregamento de imagens
      "--disable-javascript", // Opcional: se não precisar de JS no WhatsApp Web
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
      "--disable-web-security",
      
      // Configurações de primeira execução
      "--no-first-run",
      "--no-default-browser-check",
      "--metrics-recording-only",
      
      // Configurações de autenticação
      "--enable-automation",
      "--password-store=basic",
      "--use-mock-keychain",
      "--disable-blink-features=AutomationControlled",
      
      // Configurações de áudio/vídeo
      "--mute-audio",
      "--disable-audio-output",
      "--disable-notifications",
      
      // Diretórios temporários para VPS
      "--user-data-dir=/tmp/chrome-user-data",
      "--data-path=/tmp/chrome-data",
      "--disk-cache-dir=/tmp/chrome-cache",
      "--crash-dumps-dir=/tmp/chrome-crashes",
      
      // Configurações de rede
      "--aggressive-cache-discard",
      "--disable-background-timer-throttling",
      
      // Otimizações específicas para ambiente servidor
      "--disable-dev-tools",
      "--disable-plugins-discovery",
      "--disable-preconnect",
      "--disable-print-preview",
      "--hide-scrollbars",
      
      // Configuração de viewport
      "--window-size=1920,1080",
      "--virtual-time-budget=25000"
    ],
    defaultViewport: {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
    },
    timeout: 120000,
    protocolTimeout: 240000, // Aumentado para VPS mais lenta
    ignoreDefaultArgs: ['--disable-extensions', '--enable-automation'],
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    
    // Configurações específicas para VPS
    pipe: true, // Usar pipe em vez de WebSocket para melhor performance
    ignoreHTTPSErrors: true,
    slowMo: 50, // Pequeno delay entre ações para estabilidade
  };
}

// Inicializar cliente WhatsApp
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: './session'
  }),
  puppeteer: obterConfigPuppeteer(),
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
  }
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

// HANDLERS DE EVENTOS
client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
  console.log("QR Code gerado. Escaneie-o com seu WhatsApp.");
});

client.on("authenticated", () => {
  const mensagem = "Autenticado com sucesso!";
  console.log(mensagem);
  registrarLogLocal(mensagem, "INFO", "clientAuth", null);
});
client.on("ready", async () => {
  const mensagem = "Bot está pronto!";
  console.log(mensagem);
  registrarLogLocal(mensagem, "INFO", "clientReady", null);

  // Configurar timeouts e intervalos
  setInterval(verificarTestesPendentes, 15 * 60 * 1000); // A cada 15 minutos
  setInterval(monitorarSaudeBot, 60000); // A cada 1 minuto
  setInterval(verificarEstadoConexao, 15 * 60 * 1000); // A cada 15 minutos
  setInterval(salvarTodasSessoes, 5 * 60 * 1000); // A cada 5 minutos
  setInterval(limparSessoesExpiradas, 60 * 60 * 1000); // A cada 1 hora
  setInterval(monitorarMemoria, 2 * 60 * 1000); // A cada 2 minutos
  setInterval(backupDadosCriticos, 6 * 60 * 60 * 1000); // A cada 6 horas

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
});

client.on("disconnected", async (reason) => {
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
  exec('pm2 restart bot', (error, stdout, stderr) => {
    if (error) {
      console.error('Erro ao reiniciar via PM2:', error.message);
    } else {
      console.log('Reinício via PM2 solicitado após desconexão');
    }
  });
});

client.on('change_state', (state) => {
  console.log('Estado do cliente mudou para:', state);
  registrarLogLocal(
    `Estado do cliente mudou para: ${state}`,
    "INFO",
    "clientStateChange",
    null
  );
});


// Processador de mensagens principal
async function handleMessage(msg) {
  if (msg.from.endsWith("@g.us")) return;

  const chatId = msg.from;
  const contatoSalvo = await isContactSaved(chatId);

  // COMANDOS UNIVERSAIS (funcionam para todos)
  // =======================================
  // Comando especial para gerar teste independentemente do tipo de contato
  if (msg.body.toLowerCase() === "/tst") {
    try {
      console.log(`Gerando teste especial para ${chatId}`);

      const novaSessao = {
        step: "testeEspecial",
        timestamp: Date.now(),
        invalidCount: 0,
      };
      // Perguntar qual dispositivo o usuário está usando
      await responderComLog(
        msg,
        "🔑 *Teste Especial Ativado*\n\n" +
          "Escolha o tipo de dispositivo para gerar seu teste:\n\n" +
          "1️⃣ Android/TV Box (IPTV Stream Player)\n" +
          "2️⃣ iPhone/iPad (Smarters Player)\n" +
          "3️⃣ Smart TV LG/Samsung/Roku (xCloud TV)"
      );

      await salvarSessao(chatId, novaSessao);

      // Registrar o uso do comando especial
      registrarLogLocal(
        `Comando teste especial usado por: ${chatId}`,
        "INFO",
        "comandoTst",
        chatId
      );
      return;
    } catch (error) {
      console.error(
        `Erro ao processar comando de teste especial: ${error.message}`
      );
      await responderComLog(
        msg,
        "⚠️ Ocorreu um erro ao processar sua solicitação de teste."
      );
      return;
    }
  }

  // Comando para limpar sessão
  if (
    msg.body.toLowerCase() === "/clear" ||
    msg.body.toLowerCase() === "/reiniciar_conversa"
  ) {
    const novaSessao = {
      step: "menu",
      timestamp: Date.now(),
      invalidCount: 0,
    };
    await salvarSessao(chatId, novaSessao);

    await responderComLog(msg, "✅ Sua conversa foi reiniciada com sucesso!");

    await responderComLog(
      msg,
      "Olá! Como posso te ajudar? Responda com o número da opção que deseja:\n\n" +
        "1️⃣ Conhecer nossos planos de IPTV\n" +
        "2️⃣ Testar o serviço gratuitamente\n" +
        "3️⃣ Saber mais sobre como funciona o IPTV\n" +
        "4️⃣ Já testei e quero pagar agora\n" +
        "5️⃣ Falar com um atendente\n\n" +
        "⚠️ Um humano não verá suas mensagens até que uma opção válida do robô seja escolhida."
    );

    console.log(`Sessão reiniciada para: ${chatId}`);
    registrarLogLocal(
      `Sessão reiniciada pelo usuário`,
      "INFO",
      "comandoClear",
      chatId
    );

    return;
  }

  //Ver os planos disponíveis
  if (msg.body.toLowerCase() === "/planos") {
    const session = userSessions.get(chatId) || {
      step: "fim",
      timestamp: Date.now(),
      invalidCount: 0,
    };
    session.step = "fim";
    await salvarSessao(msg.from, session);
    global.respostasEnviadas++;
    await client.sendMessage(msg.from, tabelaprecos);
    return;
  }

  // Salvar periodicamente todas as sessões
  function salvarTodasSessoes() {
    if (userSessions.size > 0) {
      console.log(`Salvando ${userSessions.size} sessões no Supabase...`);

      for (const [chatId, sessao] of userSessions.entries()) {
        supabaseClient
          .salvarSessao(chatId, sessao)
          .catch((err) =>
            console.error(`Erro ao salvar sessão ${chatId}:`, err)
          );
      }
    }
  }

  // Comando para ver indicações
  if (msg.body.toLowerCase() === "/indicacoes") {
    const indicacao = await supabaseClient.getIndicacoesByNumero(chatId);

    if (!indicacao) {
      await responderComLog(
        msg,
        "📊 Você ainda não possui nenhuma indicação registrada."
      );
      return;
    }

    await responderComLog(
      msg,
      `📊 ${indicacao.nome}, você possui ${indicacao.quantidade} indicação(ões) registrada(s).`
    );
    return;
  }

  // Comando para registrar indicação
  if (msg.body.toLowerCase() === "/indiquei") {
    const contato = await client.getContactById(chatId);
    const nomeContato =
      contato.pushname || contato.name || "Contato Desconhecido";

    // Incrementa ou cria a indicação
    const indicacao = await supabaseClient.incrementIndicacao(
      chatId,
      nomeContato
    );

    if (!indicacao) {
      await responderComLog(
        msg,
        "⚠️ Ocorreu um erro ao registrar sua indicação. Por favor, tente novamente mais tarde."
      );
      return;
    }

    const pontos = indicacao.quantidade * 10;

    await responderComLog(
      msg,
      `✅ Indicação registrada com sucesso! ${indicacao.nome}, você agora possui ${indicacao.quantidade} indicação(ões), o que equivale a ${pontos} ponto(s).\n\n` +
        "Se desejar ver a tabela de recompensas, envie a mensagem abaixo para mim:\n\n" +
        "/recompensas"
    );
    return;
  }

  // Comando para ver pontos/recompensas
  if (
    msg.body.toLowerCase() === "/pontos" ||
    msg.body.toLowerCase() === "/recompensas"
  ) {
    const indicacao = await supabaseClient.getIndicacoesByNumero(chatId);

    if (!indicacao) {
      await responderComLog(
        msg,
        "📊 Você ainda não possui nenhuma indicação registrada."
      );
      return;
    }

    const pontos = indicacao.quantidade * 10;

    await responderComLog(
      msg,
      `📊 ${indicacao.nome}, você possui ${indicacao.quantidade} indicação(ões), o que equivale a ${pontos} ponto(s).`
    );
    return;
  }

  // Comando para ver jogos
  if (msg.body.toLowerCase() === "/jogos") {
    const resposta = await obterJogosParaWhatsApp();
    if (typeof resposta === "string" && resposta.length > 0) {
      await responderComLog(msg, resposta);
    } else {
      await responderComLog(
        msg,
        "⚠️ Nenhum jogo foi encontrado ou houve erro ao obter os dados."
      );
    }
    return;
  }

  // Comando para listar comandos
  if (msg.body.toLowerCase() === "/comandos") {
    await responderComLog(
      msg,
      "*Lista de comandos do BOT* \n\n" +
        "📋 *Comandos gerais:*\n" +
        "*/indicacoes -* Exibe o número de indicações que você fez\n" +
        "*/indiquei -* Registra uma nova indicação\n" +
        "*/pontos -* Consulta seus pontos de indicações\n" +
        "*/jogos -* Exibe os jogos do dia\n" +
        "*/clear -* Reinicia sua conversa com o bot\n\n" +
        "📋 *Outros comandos:*\n" +
        "*/comandos -* Exibe esta lista de comandos\n"
    );
    return;
  }

  // Chave PIX
  if (
    (msg.body.toLowerCase().includes("chave") &&
      msg.body.toLowerCase().includes("envia")) ||
    (msg.body.toLowerCase().includes("manda") &&
      msg.body.toLowerCase().includes("chave"))
  ) {
    await responderComLog(msg, "Segue abaixo a chave pix do tipo aleatória:");
    await responderComLog(msg, "c366c9e3-fb7c-431f-957e-97287f4f964f");
    return;
  }

  // Respostas para agradecimentos
  if (
    msg.body.toLowerCase().includes("obrigado") ||
    msg.body.toLowerCase().includes("obrigada") ||
    msg.body.toLowerCase().includes("vlw") ||
    msg.body.toLowerCase().includes("obg")
  ) {
    await responderComLog(msg, "Disponha 🤝");
    return;
  }

  // Saudações
  if (msg.body.toLowerCase() === "bom dia") {
    await responderComLog(msg, "Bom dia!");
    return;
  }

  if (msg.body.toLowerCase() === "boa tarde") {
    await responderComLog(msg, "Boa tarde!");
    return;
  }

  if (msg.body.toLowerCase() === "boa noite") {
    await responderComLog(msg, "Boa noite!");
    return;
  }

  // COMANDOS ADMINISTRATIVOS (apenas para admin)
  // ==========================================
  if (msg.from === `${adminNumber}@c.us`) {
    // Comando para listar todas as indicações
    if (msg.body.toLowerCase() === "/indicacoes_todos") {
      const indicacoes = await supabaseClient.getAllIndicacoes();

      if (!indicacoes || indicacoes.length === 0) {
        await responderComLog(
          msg,
          "📊 Nenhuma indicação registrada até o momento."
        );
        return;
      }

      let resposta = "📋 *Lista de Indicações:*\n\n";
      for (const indicacao of indicacoes) {
        const numeroSemSufixo = indicacao.numero.replace("@c.us", "");
        resposta += `📞 *${numeroSemSufixo || "Contato Desconhecido"}* ${
          indicacao.nome
        }: ${indicacao.quantidade} indicação(ões)\n`;
      }

      await responderComLog(msg, resposta);
      return;
    }

    // Comando para exportar logs em PDF
    if (msg.body.toLowerCase().startsWith("/log")) {
      // Extrair parâmetros: /log [dias=1] [nivel=INFO]
      const partes = msg.body.split(" ");
      const dias = partes.length > 1 ? parseInt(partes[1]) || 1 : 1;
      const nivel = partes.length > 2 ? partes[2].toUpperCase() : null;

      await responderComLog(
        msg,
        `🔍 Gerando PDF com logs dos últimos ${dias} dias${
          nivel ? ` com nível ${nivel}` : ""
        }...\nPor favor, aguarde.`
      );

      try {
        // Obter intervalo de datas
        const dataFim = obterDataBrasilia();
        const dataInicio = new Date(dataFim);
        dataInicio.setDate(dataInicio.getDate() - dias);

        // Obter logs do Supabase
        const logs = await supabaseClient.consultarLogs(
          dataInicio,
          dataFim,
          nivel,
          1000
        );

        if (logs.length === 0) {
          await responderComLog(
            msg,
            "❌ Não foram encontrados logs para o período especificado."
          );
          return;
        }

        // Gerar o PDF com os logs
        const pdfPath = await gerarPDFComLogs(logs, dias, nivel);

        // Enviar o PDF
        const media = MessageMedia.fromFilePath(pdfPath);
        await client.sendMessage(msg.from, media, {
          caption: `📊 Logs do sistema - Últimos ${dias} dias${
            nivel ? ` (${nivel})` : ""
          }`,
          sendMediaAsDocument: true,
        });

        // Remover arquivo temporário após envio
        setTimeout(() => {
          fs.unlink(pdfPath, (err) => {
            if (err)
              console.error(
                `Erro ao remover arquivo temporário: ${err.message}`
              );
          });
        }, 5000);

        registrarLogLocal(
          `PDF com ${logs.length} logs gerado e enviado`,
          "INFO",
          "comandoLog",
          msg.from
        );
      } catch (error) {
        console.error("Erro ao gerar PDF de logs:", error);
        await responderComLog(msg, `❌ Erro ao gerar PDF: ${error.message}`);
        registrarLogLocal(
          `Erro ao gerar PDF de logs: ${error.message}`,
          "ERROR",
          "comandoLog",
          msg.from
        );
      }
      return;
    }

    // Comando para ajustar indicações
    if (msg.body.toLowerCase().startsWith("/ajustar")) {
      const [_, quantidade] = msg.body.split(" ");

      if (!quantidade || isNaN(quantidade)) {
        await responderComLog(msg, "⚠️ Uso correto: /ajustar <quantidade>");
        return;
      }

      const contato = await client.getContactById(chatId);
      const nomeContato =
        contato.pushname || contato.name || "Contato Desconhecido";

      const indicacao = await supabaseClient.ajustarIndicacao(
        chatId,
        nomeContato,
        parseInt(quantidade, 10)
      );

      if (!indicacao) {
        await responderComLog(
          msg,
          "⚠️ Ocorreu um erro ao ajustar as indicações. Por favor, tente novamente mais tarde."
        );
        return;
      }

      await responderComLog(
        msg,
        `✅ O número de indicações foi ajustado para ${indicacao.quantidade} para o contato ${indicacao.nome}.`
      );
      return;
    }

    // Comando para ativar modo ausente
    if (msg.body.toLowerCase() === "/ausente") {
      modoAusente = true;
      avisosEnviados.clear();
      await responderComLog(msg, "Modo ausente ativado.");
      return;
    }

    // Comando para desativar modo ausente
    if (msg.body.toLowerCase() === "/ativo") {
      modoAusente = false;
      avisosEnviados.clear();
      await responderComLog(msg, "Modo ausente desativado.");
      return;
    }

    // Comando para reiniciar bot
    if (msg.body.toLowerCase() === "/reiniciar") {
      await responderComLog(msg, "🔄 Realizando reinício suave...");
      const sucesso = await reinicioSuave();

      if (sucesso) {
        await responderComLog(msg, "✅ Bot reiniciado com sucesso!");
      } else {
        await responderComLog(msg, "⚠️ Ocorreu um erro durante o reinício.");
      }
      return;
    }

    // Comando para resetar todas as sessões
    if (
      msg.body.toLowerCase() === "/resetar_todos" ||
      msg.body.toLowerCase() === "/reset_all"
    ) {
      await responderComLog(
        msg,
        "⚠️ ATENÇÃO! Você está prestes a resetar TODAS as sessões de usuários. Isso vai fazer com que todos os usuários recebam o menu inicial na próxima interação.\n\nDigite 'CONFIRMAR' para prosseguir."
      );

      // Aguardar confirmação
      const chat = await msg.getChat();
      chat.sendStateTyping();

      const filter = (m) => m.from === msg.from && m.body === "CONFIRMAR";
      const collector = chat.createMessageCollector(filter, {
        max: 1,
        time: 30000,
      });

      collector.on("collect", async () => {
        const totalSessoes = userSessions.size;

        // Salvar um backup antes de resetar
        const backupFileName = `./sessoes_backup_${Date.now()}.json`;
        saveSessions(userSessions, backupFileName);

        // Limpar todas as sessões
        userSessions.clear();

        // Salvar sessões (agora vazias)
        await salvarSessao(chatId, novaSessao);

        await responderComLog(
          msg,
          `✅ Todas as ${totalSessoes} sessões foram resetadas com sucesso.\nUm backup foi salvo em ${backupFileName}`
        );
        registrarLog(
          `Administrador ${adminNumber} resetou todas as ${totalSessoes} sessões de usuários`
        );
      });

      collector.on("end", async (collected) => {
        if (collected.size === 0) {
          await responderComLog(
            msg,
            "❌ Operação cancelada: tempo esgotado ou resposta inválida."
          );
        }
      });

      return;
    }

    // Comando para ver painel admin
    if (msg.body.toLowerCase() === "/admin") {
      await responderComLog(
        msg,
        "*Lista de comandos do BOT* \n\n" +
          "📋 *Comandos gerais:*\n" +
          "*/indicacoes -* Exibe o número de indicações do cliente\n" +
          "*/indicacoes_todos -* Lista o número de indicações de todos os clientes\n" +
          "*/indiquei -* Registra manualmente uma nova indicação\n" +
          "*/ajustar <quantidade> -* Ajusta manualmente o número de indicações do cliente\n" +
          "*/jogos -* Exibe os jogos do dia\n\n" +
          "📋 *Comandos de status:*\n" +
          "*/ausente -* Ativa o modo ausente\n" +
          "*/ativo -* Desativa o modo ausente\n\n" +
          "📋 *Comandos de manutenção:*\n" +
          "*/reiniciar -* Reinicia o bot suavemente\n" +
          "*/resetar_todos -* Limpa todas as sessões de usuários\n" +
          "*/status -* Mostra estatísticas do bot\n\n" +
          "*/log [dias] [nivel] -* Exporta logs em PDF\n" +
          "📋 *Outros comandos:*\n" +
          "*/comandos -* Exibe lista de comandos para usuários\n" +
          "*/admin -* Exibe esta lista de comandos\n\n" +
          "⚠️ _Estes comandos são restritos ao administrador._"
      );
      return;
    }
  }

  // TRATAMENTO ESPECÍFICO PARA CONTATOS SALVOS
  // =========================================
  if (contatoSalvo) {
    // Verificar se o contato está em algum fluxo de comando especial
    const session = userSessions.get(chatId);

    // Se estiver em fluxos específicos, continuar o processamento mesmo sendo contato salvo
    if (
      session &&
      (session.step === "testeEspecial" || session.step === "testeGerado")
    ) {
      if (session.step === "testeEspecial") {
        // Processar escolha do dispositivo para teste especial
        if (msg.body === "1") {
          // Android/TV Box
          console.log(
            `Gerando teste iptvstream para ${msg.from} (teste especial)`
          );
          try {
            await gerarTeste(msg, "iptvstream");
            session.step = "testeAdmGerado";
            await salvarSessao(msg.from, session);
          } catch (error) {
            console.error(
              `Erro ao gerar teste especial iptvstream: ${error.message}`
            );
            await responderComLog(
              msg,
              "⚠️ Não foi possível gerar seu teste. Por favor, tente novamente mais tarde."
            );
            session.invalidCount = (session.invalidCount || 0) + 1;
            if (session.invalidCount >= 3) {
              session.step = "menu"; // Volta ao menu após 3 tentativas
            }
            await salvarSessao(msg.from, session);
          }
        } else if (msg.body === "2") {
          // iPhone/iPad
          console.log(
            `Gerando teste smarters para ${msg.from} (teste especial)`
          );
          try {
            // Gera teste para Smarters Player
            await gerarTeste(msg, "smarters");
            session.step = "testeAdmGerado";
            await salvarSessao(msg.from, session);
          } catch (error) {
            console.error(
              `Erro ao gerar teste especial smarters: ${error.message}`
            );
            await responderComLog(
              msg,
              "⚠️ Não foi possível gerar seu teste. Por favor, tente novamente mais tarde."
            );

            session.invalidCount = (session.invalidCount || 0) + 1;
            if (session.invalidCount >= 3) {
              session.step = "menu"; // Volta ao menu após 3 tentativas
            }
            await salvarSessao(msg.from, session);
          }
        } else if (msg.body === "3") {
          // Smart TV
          console.log(`Gerando teste xcloud para ${msg.from} (teste especial)`);
          try {
            // Gera teste para xCloud TV
            await gerarTeste(msg, "xcloud");
            session.step = "testeAdmGerado";
            await salvarSessao(msg.from, session);
          } catch (error) {
            console.error(
              `Erro ao gerar teste especial xcloud: ${error.message}`
            );
            await responderComLog(
              msg,
              "⚠️ Não foi possível gerar seu teste. Por favor, tente novamente mais tarde."
            );

            // Mantém no modo de teste para tentar novamente
            session.invalidCount = (session.invalidCount || 0) + 1;
            if (session.invalidCount >= 3) {
              session.step = "menu"; // Volta ao menu após 3 tentativas
            }
            await salvarSessao(msg.from, session);
          }
        } else {
          // Opção inválida
          session.invalidCount = (session.invalidCount || 0) + 1;
          if (session.invalidCount < 3) {
            await responderComLog(
              msg,
              "Por favor, escolha uma opção válida:\n\n" +
                "1️⃣ Android/TV Box (IPTV Stream Player)\n" +
                "2️⃣ iPhone/iPad (Smarters Player)\n" +
                "3️⃣ Smart TV LG/Samsung/Roku (xCloud TV)"
            );
          } else {
            session.step = "menu";
            await salvarSessao(msg.from, session);
            await responderComLog(
              msg,
              "⚠️ Muitas opções inválidas. Voltando ao menu principal.\n\n"
            );
          }
        }
      }
    } else {
      return;
    }
  }

  // FLUXO NORMAL DO BOT (apenas para contatos não salvos)
  // ==================================================

  // Verifica se o modo ausente está ativado
  if (modoAusente && !avisosEnviados.has(chatId)) {
    // Envia o aviso apenas se ainda não foi enviado para este usuário
    await responderComLog(
      msg,
      "No momento estamos ausentes, então o atendimento humano pode demorar um pouco mais que o normal."
    );
    avisosEnviados.add(chatId); // Marca o usuário como já avisado
  }

  const now = Date.now();

  // Para usuários novos ou sessões expiradas, cria nova sessão
  if (
    !userSessions.has(chatId) ||
    now - userSessions.get(chatId).timestamp > sessionTimeout
  ) {
    const novaSessao = {
      step: "menu",
      timestamp: obterDataBrasilia().getTime(),
      invalidCount: 0,
    };
    await salvarSessao(chatId, novaSessao);

    await responderComLog(
      msg,
      "Olá! Como posso te ajudar? Responda com o número da opção que deseja:\n\n" +
        "1️⃣ Conhecer nossos planos de IPTV\n" +
        "2️⃣ Testar o serviço gratuitamente\n" +
        "3️⃣ Saber mais sobre como funciona o IPTV\n" +
        "4️⃣ Já testei e quero ativar\n" +
        "5️⃣ Falar com um atendente\n\n" +
        "⚠️ Um humano não verá suas mensagens até que uma opção válida do robô seja escolhida."
    );
    return;
  }

  const session = userSessions.get(chatId);

  // Verificar mensagens não numéricas consecutivas
  const isNumber = /^\d+$/.test(msg.body);

  if (!session.naoNumericaConsecutivas) {
    session.naoNumericaConsecutivas = 0;
  }

  if (!isNumber && msg.body.length > 2) {
    session.naoNumericaConsecutivas += 1;

    // Se atingiu o limite e não está em modo humano, ativar automaticamente
    if (session.naoNumericaConsecutivas >= 3 && session.step !== "humano") {
      session.step = "humano";
      session.invalidCount = 0;
      await salvarSessao(msg.from, session);
      await responderComLog(
        msg,
        "Percebi que você está tentando conversar. Ativei o modo de atendimento humano. Um atendente responderá sua mensagem assim que possível."
      );
      console.log(`Atendimento humano ativado automaticamente para: ${chatId}`);
      registrarLogLocal(
        `Atendimento humano ativado automaticamente`,
        "INFO",
        "handleMessage",
        chatId
      );
      return;
    }
  } else {
    // Reset do contador se for um número
    session.naoNumericaConsecutivas = 0;
  }

  // Comando universal para voltar ao menu
  if (msg.body === "0") {
    session.step = "menuRecovery";
    session.invalidCount = 0;
    await salvarSessao(msg.from, session);
    await responderComLog(
      msg,
      "Bem vindo de volta ao menu\n\n" +
        "1️⃣ Conhecer nossos planos de IPTV\n" +
        "2️⃣ Testar o serviço gratuitamente\n" +
        "3️⃣ Saber mais sobre como funciona o IPTV\n" +
        "4️⃣ Já testei e quero ativar\n" +
        "5️⃣ Falar com um atendente"
    );
    return;
  }

  if (session.invalidCount >= 3) return;

  // Menu inicial
  if (session.step === "menu" || session.step === "menuRecovery") {
    // Processamento do menu principal
    processarMenuPrincipal(msg, session);
    return;
  } else if (session.step === "testar") {
    // Processamento da etapa de teste
    processarTestar(msg, session);
    return;
  } else if (session.step === "celular") {
    processarCelular(msg, session);
    return;
  } else if (session.step === "smarttv") {
    processarSmartTV(msg, session);
    return;
  } else if (
    ((session.step === "lg" ||
      session.step === "samsung" ||
      session.step === "roku") &&
      (msg.body === "1" ||
        msg.body.toLowerCase().includes("já instalei") ||
        msg.body.toLowerCase().includes("instalei o app"))) ||
    msg.body.toLowerCase().includes("instalei")
  ) {
    await gerarTeste(msg, "xcloud");
    session.step = "testeGerado";
    await salvarSessao(msg.from, session);
  } else if (
    session.step === "android" &&
    (msg.body === "1" ||
      msg.body.toLowerCase().includes("cheguei") ||
      msg.body.toLowerCase().includes("tela de login"))
  ) {
    await gerarTeste(msg, "iptvstream");
    session.step = "testeGerado";
    await salvarSessao(msg.from, session);
  } else if (
    session.step === "iphone" &&
    (msg.body === "1" ||
      msg.body.toLowerCase().includes("cheguei") ||
      msg.body.toLowerCase().includes("tela de login"))
  ) {
    await gerarTeste(msg, "smarters");
    session.step = "testeGerado";
    await salvarSessao(msg.from, session);
  } else if (session.step === "planos") {
    // Processamento da etapa de planos
    processarPlanos(msg, session);
    return;
  } else if (session.step === "ativar") {
    // Processamento da etapa de ativação
    processarAtivar(msg, session);
    return;
  } else if (
    session.step === "cinema" ||
    session.step === "completo" ||
    session.step === "duo"
  ) {
    // Processamento da etapa de pagamento
    processarPagamento(msg, session);
  } else if (session.step === "humano") {
    // Modo humano - permitir voltar ao menu com "0"
    if (msg.body === "0") {
      session.step = "menuRecovery";
      session.naoNumericaConsecutivas = 0;
      session.invalidCount = 0;
      await salvarSessao(msg.from, session);
      await responderComLog(
        msg,
        "Voltando ao menu automático\n\n" +
          "1️⃣ Conhecer nossos planos de IPTV\n" +
          "2️⃣ Testar o serviço gratuitamente\n" +
          "3️⃣ Saber mais sobre como funciona o IPTV\n" +
          "4️⃣ Já testei e quero pagar agora\n" +
          "5️⃣ Falar com um atendente"
      );
      return;
    }
    // Não responder outras mensagens no modo humano
  } else if (session.step === "testeGerado") {
    // Processamento do feedback
    if (msg.body === "1") {
      // Usuário confirma que está funcionando
      session.step = "fim";
      await responderComLog(
        msg,
        "🎉 Ótimo! Ficamos felizes que está tudo funcionando! Lembre-se que este é um teste de 3 horas.\n\n" +
          "Caso queira contratar após o teste, digite /planos para conhecer nossas opções.\n\n" +
          "0️⃣ Menu inicial"
      );
      await salvarSessao(msg.from, session);
      return;
    } else if (msg.body === "2") {
      // Usuário relata problemas
      session.step = "humano"; // Encaminha para atendimento humano
      await salvarSessao(msg.from, session);
      await responderComLog(
        msg,
        "Vou transferir para um atendente humano que irá te ajudar em seguida.\n\n" +
          "Por favor, descreva o problema que está enfrentando detalhadamente para que possamos resolver mais rapidamente."
      );
    } else if (msg.body === "0") {
      // Volta ao menu inicial
      session.step = "menuRecovery";
      await salvarSessao(msg.from, session);
      await responderComLog(
        msg,
        "Voltando ao menu principal\n\n" +
          "1️⃣ Conhecer nossos planos de IPTV\n" +
          "2️⃣ Testar o serviço gratuitamente\n" +
          "3️⃣ Saber mais sobre como funciona o IPTV\n" +
          "4️⃣ Já testei e quero ativar\n" +
          "5️⃣ Falar com um atendente"
      );
    } else {
      // Mensagem inválida
      await responderComLog(
        msg,
        "Por favor, escolha uma das opções:\n\n" +
          "1️⃣ Sim, está funcionando\n" +
          "2️⃣ Estou com problemas\n" +
          "0️⃣ Menu inicial"
      );
    }
  }
}

// PROCESSADORES DE ETAPAS

// Menu principal
async function processarMenuPrincipal(msg, session) {
  if (msg.body === "1") {
    session.step = "planos";
    session.invalidCount = 0;
    await salvarSessao(msg.from, session);
    global.respostasEnviadas++;
    await client.sendMessage(msg.from, tabelaprecos, {
      caption:
        "📌 Escolha o que deseja fazer agora:\n\n" +
        "1️⃣ Testar o serviço gratuitamente\n" +
        "2️⃣ Escolhi meu plano, quero ativar agora\n" +
        "3️⃣ Saber mais sobre como funciona o IPTV\n\n" +
        "0️⃣ Menu inicial",
    });
  } else if (msg.body === "2") {
    session.step = "testar";
    session.invalidCount = 0;
    await salvarSessao(msg.from, session);
    await responderComLog(
      msg,
      "Em qual dispositivo gostaria de realizar o teste?\n\n1️⃣ Celular\n2️⃣ TV Box\n3️⃣ Smart TV\n4️⃣ Computador\n\n0️⃣ Menu inicial"
    );
  } else if (msg.body === "3") {
    session.step = "comoFunciona";
    session.invalidCount = 0;
    await salvarSessao(msg.from, session);
    await responderComLog(
      msg,
      "O IPTV é um serviço de streaming que permite assistir a canais de TV ao vivo, filmes, séries e novelas pela internet. Você pode acessar uma variedade de canais e programas em diferentes dispositivos, como TVs, smartphones e computadores.\n\n" +
        "0️⃣ Menu inicial"
    );
  } else if (msg.body === "4") {
    session.step = "ativar";
    session.invalidCount = 0;
    await salvarSessao(msg.from, session);
    global.respostasEnviadas++;
    await client.sendMessage(msg.from, tabelaprecos, {
      caption:
        "📌 Escolha o plano que deseja:\n\n" +
        "1️⃣ Plano CINEMA (R$ 18,00 por mês)\n" +
        "2️⃣ Plano COMPLETO (R$ 20,00 por mês)\n" +
        "3️⃣ Plano DUO (R$ 35,00 por mês)\n\n" +
        "0️⃣ Menu inicial\n\n" +
        "_O plano completo tem acréscimo de 5$ caso seja pago após o vencimento_",
    });
  } else if (msg.body === "5") {
    session.step = "humano";
    session.invalidCount = 0;
    await salvarSessao(msg.from, session);
    await responderComLog(
      msg,
      "Digite abaixo o que deseja, um atendente humano irá responder suas mensagens o mais rápido possível 😊"
    );
  } else {
    session.invalidCount = (session.invalidCount || 0) + 1;
    await salvarSessao(msg.from, session);
    
    // Log da mensagem inválida para monitoramento
    console.log(`Mensagem inválida de ${msg.from} (invalidCount: ${session.invalidCount})`);
    registrarLogLocal(
      `Mensagem inválida no menu principal: "${msg.body}"`,
      "INFO",
      "processarMenuPrincipal",
      msg.from
    );
  }
}
// Testar
async function processarTestar(msg, session) {
  if (msg.body === "1" || msg.body.toLowerCase().includes("celular")) {
    session.step = "celular";
    session.invalidCount = 0;
    await salvarSessao(msg.from, session);
    await responderComLog(
      msg,
      "Seu celular é:\n\n1️⃣ Android\n2️⃣ iPhone\n\n0️⃣ Menu inicial"
    );
  } else if (msg.body === "2" || msg.body.toLowerCase().includes("tvbox")) {
    session.step = "android";
    session.invalidCount = 0;
    await salvarSessao(msg.from, session);
    global.respostasEnviadas++;
    await client.sendMessage(msg.from, iptvstreamplayer, {
      caption:
        "✅ Siga os passos abaixo para configurar:\n\n" +
        "📲 Procura na PlayStore e baixa um aplicativo chamado IPTV STREAM PLAYER.\n\n" +
        "📌 Depois, pode abrir, irá aparecer uma tela com 3 botões, você seleciona o primeiro e ele irá te direcionar à página onde pede os dados de login.\n" +
        "🚀 Quando chegar na tela de login, me avise que te envio seus dados!\n\n" +
        "1️⃣ Cheguei na tela de login\n" +
        "0️⃣ Menu inicial",
    });
  } else if (msg.body === "3" || msg.body.toLowerCase().includes("smarttv")) {
    session.step = "smarttv";
    session.invalidCount = 0;
    await salvarSessao(msg.from, session);
    await responderComLog(
      msg,
      "Qual a marca da sua TV?\n\n1️⃣ LG\n2️⃣ Samsung\n3️⃣ Outra com Android\n4️⃣ Outra com Roku\n5️⃣ Não sei se é Roku ou Android\n\n0️⃣ Menu inicial"
    );
  } else if (
    msg.body === "4" ||
    msg.body.toLowerCase().includes("computador")
  ) {
    session.step = "computador";
    session.invalidCount = 0;
    await salvarSessao(msg.from, session);
    await responderComLog(
      msg,
      "🌐 No seu computador, acesse o site: applime.cc\n\n" +
        "👤 Me informe quando acessar para te enviar os dados de acesso"
    );
  } else {
    session.invalidCount = (session.invalidCount || 0) + 1;
    if (session.invalidCount < 3) {
      await responderComLog(
        msg,
        "Escolha um dispositivo válido:\n\n1️⃣ Celular\n2️⃣ TV Box\n3️⃣ Smart TV\n4️⃣ Computador\n\n0️⃣ Menu inicial"
      );
    }
  }
}

// Celular
async function processarCelular(msg, session) {
  if (msg.body === "1") {
    session.step = "android";
    session.invalidCount = 0;
    await salvarSessao(msg.from, session);
    global.respostasEnviadas++;
    await client.sendMessage(msg.from, iptvstreamplayer, {
      caption:
        "✅ Siga os passos abaixo para configurar:\n\n" +
        "📲 Procura na PlayStore e baixa um aplicativo chamado IPTV STREAM PLAYER.\n\n" +
        "📌 Depois, pode abrir, irá aparecer uma tela com 3 botões, você seleciona o primeiro e ele irá te direcionar à página onde pede os dados de login.\n" +
        "🚀 Quando chegar na tela de login, me avise que te envio seus dados!\n\n" +
        "1️⃣ Cheguei na tela de login\n" +
        "0️⃣ Menu inicial",
    });
  } else if (msg.body === "2") {
    session.step = "iphone";
    session.invalidCount = 0;
    await salvarSessao(msg.from, session);
    await responderComLog(
      msg,
      "✅ Siga os passos abaixo para configurar:\n\n" +
        "📲 Baixe o *Smarters Player Lite* na AppStore\n" +
        "📌 Abra o app e aceite os termos (Se ele pedir)\n" +
        "🚀 Selecione *Xtreme Codes* na tela\n\n" +
        "1️⃣ Cheguei na tela de login\n" +
        "0️⃣ Menu inicial"
    );
  } else {
    session.invalidCount = (session.invalidCount || 0) + 1;
    if (session.invalidCount < 3) {
      await responderComLog(
        msg,
        "Escolha uma opção válida:\n\n1️⃣ Android\n2️⃣ iPhone\n\n0️⃣ Menu inicial"
      );
    }
  }
}

// Smart TV
async function processarSmartTV(msg, session) {
  if (msg.body === "1") {
    session.step = "lg";
    session.invalidCount = 0;
    await salvarSessao(msg.from, session);
    await responderComLog(
      msg,
      "✅ Siga os passos abaixo para configurar:\n\n" +
        "📺 Abra a loja de aplicativos da sua TV.\n" +
        "🔍 Procure e instale o aplicativo xCloud TV.\n" +
        "📌 Depois de instalar, abra o app e me avise pra eu te enviar os dados de acesso.\n" +
        "⚠️ Obs: Se não encontrar o xCloud TV, me avise que te ajudo a baixar outro app.\n\n" +
        "1️⃣ Já instalei e abri o app\n" +
        "0️⃣ Menu inicial"
    );
  } else if (msg.body === "2") {
    session.step = "samsung";
    session.invalidCount = 0;
    await salvarSessao(msg.from, session);
    await responderComLog(
      msg,
      "✅ Siga os passos abaixo para configurar:\n\n" +
        "📺 Abra a loja de aplicativos da sua TV.\n" +
        "🔍 Procure e instale o aplicativo xCloud TV.\n" +
        "📌 Depois de instalar, abra o app e me avise pra eu te enviar os dados de acesso.\n" +
        "⚠️ Obs: Se não encontrar o xCloud TV, me avise que te ajudo a baixar outro app.\n\n" +
        "1️⃣ Já instalei e abri o app\n" +
        "0️⃣ Menu inicial"
    );
  } else if (msg.body === "3") {
    session.step = "android";
    session.invalidCount = 0;
    await salvarSessao(msg.from, session);
    global.respostasEnviadas++;
    await client.sendMessage(msg.from, iptvstreamplayer, {
      caption:
        "✅ Siga os passos abaixo para configurar:\n\n" +
        "📲 Procura na PlayStore e baixa um aplicativo chamado IPTV STREAM PLAYER.\n\n" +
        "📌 Depois, pode abrir, irá aparecer uma tela com 3 botões, você seleciona o primeiro e ele irá te direcionar à página onde pede os dados de login.\n" +
        "🚀 Quando chegar na tela de login, me avise que te envio seus dados!\n\n" +
        "1️⃣ Cheguei na tela de login\n" +
        "0️⃣ Menu inicial",
    });
  } else if (msg.body === "4") {
    session.step = "roku";
    session.invalidCount = 0;
    await salvarSessao(msg.from, session);
    await responderComLog(
      msg,
      "✅ Siga os passos abaixo para configurar:\n\n" +
        "📺 Abra a loja de aplicativos da sua TV.\n" +
        "🔍 Procure e instale o aplicativo xCloud TV.\n" +
        "📌 Depois de instalar, abra o app e me avise pra eu te enviar os dados de acesso.\n" +
        "⚠️ Obs: Se não encontrar o xCloud TV, me avise que te ajudo a baixar outro app.\n\n" +
        "1️⃣ Já instalei e abri o app\n" +
        "0️⃣ Menu inicial"
    );
  } else if (msg.body === "5") {
    session.step = "outro";
    session.invalidCount = 0;
    await salvarSessao(msg.from, session);
    await responderComLog(
      msg,
      "📱 Abre a loja de aplicativos e me manda uma foto da tela, por favor!"
    );
  }
}

// Planos
async function processarPlanos(msg, session) {
  if (msg.body === "1") {
    session.step = "testar";
    session.invalidCount = 0;
    await salvarSessao(msg.from, session);
    await responderComLog(
      msg,
      "Em qual dispositivo gostaria de realizar o teste?\n\n1️⃣ Celular\n2️⃣ TV Box\n3️⃣ Smart TV\n4️⃣ Computador\n\n0️⃣ Menu inicial"
    );
  } else if (msg.body === "2") {
    session.step = "ativar";
    session.invalidCount = 0;
    await salvarSessao(msg.from, session);
    await responderComLog(
      msg,
      "📌 Escolha o plano que deseja:\n\n" +
        "1️⃣ Plano CINEMA (R$ 18,00 por mês)\n" +
        "2️⃣ Plano COMPLETO (R$ 20,00 por mês)\n" +
        "3️⃣ Plano DUO (R$ 35,00 por mês)\n\n" +
        "0️⃣ Menu inicial\n\n" +
        "_O plano completo tem acréscimo de 5$ caso seja pago após o vencimento_"
    );
  } else if (msg.body === "3") {
    session.step = "comoFunciona";
    session.invalidCount = 0;
    await salvarSessao(msg.from, session);
    await responderComLog(
      msg,
      "O IPTV é um serviço de streaming que permite assistir a canais de TV ao vivo, filmes, séries e novelas pela internet. Você pode acessar uma variedade de canais e programas em diferentes dispositivos, como TVs, smartphones e computadores.\n\n" +
        "0️⃣ Menu inicial"
    );
  } else {
    session.invalidCount = (session.invalidCount || 0) + 1;
    if (session.invalidCount < 3) {
      await responderComLog(
        msg,
        "📌 Escolha uma opção válida:\n\n" +
          "1️⃣ Testar o serviço gratuitamente\n" +
          "2️⃣ Escolhi meu plano, quero ativar agora\n" +
          "3️⃣ Saber mais sobre como funciona o IPTV\n\n" +
          "0️⃣ Menu inicial"
      );
    }
  }
}

// Ativar plano
async function processarAtivar(msg, session) {
  if (msg.body === "1") {
    session.step = "cinema";
    session.planoSelecionado = "CINEMA";
    session.valorPlano = "18,00";
    await responderComLog(
      msg,
      "Perfeito, o plano escolhido custa apenas R$ 18,00 por mês, você deseja efetuar o pagamento via cartão ou pix?\n\n" +
        "1️⃣ Cartão de crédito\n" +
        "2️⃣ PIX\n\n" +
        "_Obs: No cartão tem taxa da operadora de cerca de 1 real_"
    );
  } else if (msg.body === "2") {
    session.step = "completo";
    session.planoSelecionado = "COMPLETO";
    session.valorPlano = "20,00";
    await responderComLog(
      msg,
      "Perfeito, o plano escolhido custa apenas R$ 20,00 por mês, você deseja efetuar o pagamento via cartão ou pix?\n\n" +
        "1️⃣ Cartão de crédito\n" +
        "2️⃣ PIX\n\n" +
        "_Obs: No cartão tem taxa da operadora de cerca de 1 real_"
    );
  } else if (msg.body === "3") {
    session.step = "duo";
    session.planoSelecionado = "DUO";
    session.valorPlano = "35,00";
    await responderComLog(
      msg,
      "Perfeito, o plano escolhido custa apenas R$ 35,00 por mês, você deseja efetuar o pagamento via cartão ou pix?\n\n" +
        "1️⃣ Cartão de crédito\n" +
        "2️⃣ PIX\n\n" +
        "_Obs: No cartão tem taxa da operadora de cerca de 1 real_"
    );
  } else {
    session.invalidCount = (session.invalidCount || 0) + 1;
    if (session.invalidCount < 3) {
      await responderComLog(
        msg,
        "📌 Escolha o plano que deseja:\n\n" +
          "1️⃣ Plano CINEMA (R$ 18,00 por mês)\n" +
          "2️⃣ Plano COMPLETO (R$ 20,00 por mês)\n" +
          "3️⃣ Plano DUO (R$ 35,00 por mês)\n\n" +
          "0️⃣ Menu inicial\n\n" +
          "_O plano completo tem acréscimo de 5$ caso seja pago após o vencimento_"
      );
    }
  }
}

// Processar pagamento
async function processarPagamento(msg, session) {
  const pagamentosLinks = {
    cinema: "https://pay.infinitepay.io/servico-suportetv/VC1D-MOItUPj43-18,00",
    completo:
      "https://pay.infinitepay.io/servico-suportetv/VC1D-cYyPbKeF-20,00",
    duo: "https://pay.infinitepay.io/servico-suportetv/VC1D-5PscvMd79r-35,00",
  };

  const plano = session.step; // cinema, completo ou duo

  if (msg.body === "1") {
    // Cartão de crédito
    session.metodoPagamento = "cartao";
    await responderComLog(
      msg,
      `Combinado, você pode efetuar o pagamento com cartão através do link abaixo:\n\n${pagamentosLinks[plano]}`
    );

    // Adicionar mensagem de confirmação
    setTimeout(async () => {
      await responderComLog(
        msg,
        "Quando finalizar o pagamento, por favor me avise para que eu possa liberar seu acesso 😊"
      );
    }, 2000);
  } else if (msg.body === "2") {
    // PIX
    session.metodoPagamento = "pix";
    await responderComLog(
      msg,
      "Combinado, você pode efetuar o pagamento por PIX através da chave pix aleatória abaixo:"
    );
    await responderComLog(msg, "c366c9e3-fb7c-431f-957e-97287f4f964f");

    // Adicionar mensagem de confirmação
    setTimeout(async () => {
      await responderComLog(
        msg,
        "Quando finalizar o pagamento, por favor me envie o comprovante para que eu possa liberar seu acesso 😊"
      );
    }, 2000);
  } else {
    session.invalidCount = (session.invalidCount || 0) + 1;
    if (session.invalidCount < 3) {
      await responderComLog(
        msg,
        "Por favor, escolha uma forma de pagamento:\n\n" +
          "1️⃣ Cartão de crédito\n" +
          "2️⃣ PIX\n\n" +
          "_Obs: No cartão tem taxa da operadora de cerca de 1 real_"
      );
    }
  }
}

// HANDLER DE EVENTOS DE MENSAGENS
client.on("message", async (msg) => {
  if (msg.from.endsWith("@g.us") || msg.from === "status@broadcast") return;

  const chatId = msg.from;
  const contatoSalvo = await isContactSaved(chatId);
  const statusContato = contatoSalvo ? "YES" : "NO";
  const session = userSessions.get(chatId) || { step: "sem_sessao" };
  const etapaAtual = session.step;
  
  // Verificar se o usuário está no mapa antes de chamar a função
  if (testesPendentes && testesPendentes.has(chatId)) {
    // Só marca como respondido se realmente estiver no mapa
    marcarTesteRespondido(chatId);
    console.log(`Usuário ${chatId} respondeu após receber teste`);
  }

  // Log de mensagem recebida
  const logMensagem = `[MENSAGEM RECEBIDA] [${etapaAtual}] De: ${msg.from} [${statusContato}]`;
  //console.log(logMensagem);
  registrarLogLocal(logMensagem, "INFO", "messageReceived", chatId);

  // Atualizar timestamp de última atividade
  ultimaAtividadeTempo = Date.now();

  // Incrementar contador apenas se não for contato salvo
  if (!contatoSalvo) {
    // Verificar se está em modo humano antes de incrementar
    const session = userSessions.get(chatId);
    if (!session || session.step !== "humano") {
      mensagensRecebidas++;
    }
  }

  try {
    await handleMessage(msg);
  } catch (error) {
    const erroMensagem = `[ERRO] Ao processar mensagem de ${msg.from}: ${error.message}`;
    console.error(erroMensagem);
    registrarLogLocal(erroMensagem, "ERROR", "messageHandler", chatId);
  }
});

// Tratamento de erros global
process.on("unhandledRejection", (reason, promise) => {
  if (
    reason &&
    reason.message &&
    reason.message.includes("Execution context was destroyed")
  ) {
    console.log(
      "⚠️ Detectado erro de contexto destruído! Tentando recuperar..."
    );
    registrarLogLocal(
      "Erro de contexto destruído detectado, iniciando recuperação",
      "WARN",
      "unhandledRejection",
      null
    );

    setTimeout(() => {
      reinicioSuave().catch((err) => {
        console.error("Falha no reinício suave após erro de contexto:", err);
        registrarLogLocal(
          `Falha no reinício suave após erro de contexto: ${err.message}`,
          "ERROR",
          "unhandledRejection",
          null
        );
        client.initialize();
      });
    }, 5000);
  } else {
    console.error("Unhandled Rejection:", reason);
    registrarLogLocal(
      `Erro não tratado: ${reason?.message || reason}`,
      "ERROR",
      "unhandledRejection",
      null
    );
  }
});

// Inicializa o sistema
(async function inicializar() {
  console.log("Iniciando bot IPTV...");

  try {
    // Criar pastas necessárias
    ["./backups", "./logs", "./assets"].forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
      }
    });

    // Inicializar dados
    inicializarDados();

    // Inicializar cliente
    await client.initialize();

    // Chamada função reinicio
    agendarReinicioPreventivo();

    console.log("Inicialização concluída!");
  } catch (error) {
    console.error("Erro durante inicialização:", error);
    registrarLogLocal(
      `Erro durante inicialização: ${error.message}`,
      "ERROR",
      "inicializar",
      null
    );
  }
})();

/**
 * Gera um PDF com os logs do sistema
 * @param {Array} logs - Array de logs obtidos do Supabase
 * @param {number} dias - Número de dias incluídos no relatório
 * @param {string} nivel - Nível de log filtrado (opcional)
 * @returns {Promise<string>} Caminho do arquivo PDF gerado
 */
async function gerarPDFComLogs(logs, dias, nivel = null) {
  return new Promise((resolve, reject) => {
    try {
      const PDFDocument = require('pdfkit');
      
      // Criar nome do arquivo baseado na data atual
      const timestamp = obterDataBrasilia().toISOString().replace(/[:.]/g, '-');
      const filePath = `./logs/logs_${timestamp}.pdf`;
      
      // Criar um novo documento PDF
      const doc = new PDFDocument({
        margin: 50,
        size: 'A4'
      });
      
      // Pipe do PDF para o arquivo
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);
      
      // Adicionar título
      doc.font('Helvetica-Bold')
         .fontSize(18)
         .text(`Relatório de Logs do Sistema IPTV Bot`, {
           align: 'center'
         });
      
      // Adicionar informações do relatório
      doc.moveDown()
         .fontSize(12)
         .text(`Data de geração: ${obterDataBrasilia().toLocaleDateString('pt-BR')} ${obterDataBrasilia().toLocaleTimeString('pt-BR')}`)
         .text(`Período: Últimos ${dias} dias`)
         .text(`Nível: ${nivel || 'Todos'}`)
         .text(`Total de registros: ${logs.length}`)
         .moveDown();
      
      // Linha divisória
      doc.moveTo(50, doc.y)
         .lineTo(doc.page.width - 50, doc.y)
         .stroke()
         .moveDown();
      
      // Cabeçalhos da tabela
      doc.font('Helvetica-Bold')
         .fontSize(10)
         .text('Data/Hora', 50, doc.y, { width: 120 })
         .text('Nível', 170, doc.y - 12, { width: 50 })
         .text('Origem', 220, doc.y - 12, { width: 80 })
         .text('Mensagem', 300, doc.y - 12)
         .moveDown();
      
      // Linha divisória
      doc.moveTo(50, doc.y - 5)
         .lineTo(doc.page.width - 50, doc.y - 5)
         .stroke()
         .moveDown();
      
      // Adicionar logs
      doc.font('Helvetica');
      
      logs.forEach(log => {
        // Verificar se precisamos de uma nova página
        if (doc.y > doc.page.height - 100) {
          doc.addPage();
        }
        
        // Formato de data
        const dataLog = new Date(log.data_hora);
        const dataFormatada = `${dataLog.toLocaleDateString('pt-BR')} ${dataLog.toLocaleTimeString('pt-BR')}`;
        
        // Definir cor baseada no nível
        if (log.nivel === 'ERROR') {
          doc.fillColor('red');
        } else if (log.nivel === 'WARN') {
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
