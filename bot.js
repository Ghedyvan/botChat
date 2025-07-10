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

// Tratamento global de erros
process.on('unhandledRejection', (reason, promise) => {
  console.error('Erro não tratado:', reason);
  registrarLogLocal(
    `Erro não tratado: ${reason}`,
    "ERROR",
    "unhandledRejection",
    null
  );
});

process.on('uncaughtException', (error) => {
  console.error('Erro não capturado:', error);
  registrarLogLocal(
    `Erro não capturado: ${error.message}`,
    "ERROR",
    "uncaughtException",
    null
  );
});

// Salvar todas as sessões no banco
async function salvarTodasSessoes() {
  try {
    console.log('Salvando todas as sessões...');
    let count = 0;
    for (const [chatId, sessao] of userSessions.entries()) {
      try {
        await supabaseClient.salvarSessao(chatId, sessao);
        count++;
      } catch (error) {
        console.error(`Erro ao salvar sessão ${chatId}:`, error.message);
      }
    }
    console.log(`${count} sessões salvas.`);
    return count;
  } catch (error) {
    console.error('Erro geral ao salvar sessões:', error.message);
    return 0;
  }
}

console.log("Bot inicializando...");

// Inicializar dados
async function inicializarDados() {
  try {
    await supabaseClient.inicializarSupabase();
    const sessions = await supabaseClient.carregarSessoes();
    userSessions.clear();

    for (const [id, userData] of sessions.entries()) {
      userSessions.set(id, userData);
    }
    console.log(`${userSessions.size} sessões carregadas do Supabase.`);
  } catch (error) {
    console.error("Erro ao inicializar dados:", error);
  }
}

// Logging
async function registrarLogLocal(mensagem, nivel = "INFO", origem = null, numero = null) {
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

// Função para reinício suave
async function reinicioSuave() {
  console.log("Realizando reinício suave...");
  registrarLogLocal("Realizando reinício suave do bot", "INFO", "reinicioSuave", null);

  try {
    // Salvar sessões
    await salvarTodasSessoes();

    // Fechar cliente
    if (client && typeof client.destroy === 'function') {
      await client.destroy().catch(err => console.log("Erro ao fechar cliente:", err.message));
    }

    // Limpar processos
    const { exec } = require('child_process');
    exec('pkill -f "chromium" || true', () => {
      exec('pm2 restart bot --update-env', (error) => {
        if (error) {
          console.error('Erro no reinício:', error.message);
        } else {
          console.log('Reinício executado com sucesso');
        }
      });
    });

    return true;
  } catch (error) {
    console.error("Erro durante reinício:", error);
    return false;
  }
}

// Função simplificada para processamento de mensagens
async function processarMensagem(msg) {
  try {
    mensagensRecebidas++;
    ultimaAtividadeTempo = Date.now();

    // Log da mensagem recebida
    console.log(`Mensagem recebida de ${msg.from}: ${msg.body}`);
    
    // Comandos básicos
    if (msg.body.toLowerCase() === "/status" && msg.from === `${adminNumber}@c.us`) {
      await responderComLog(msg, `Bot funcionando! Mensagens recebidas: ${mensagensRecebidas}`, userSessions, client);
      return;
    }

    if (msg.body.toLowerCase() === "/reiniciar" && msg.from === `${adminNumber}@c.us`) {
      await responderComLog(msg, "Reiniciando bot...", userSessions, client);
      await reinicioSuave();
      return;
    }

    // Resposta padrão
    await responderComLog(msg, "Bot em modo de teste. Em breve todas as funcionalidades estarão disponíveis.", userSessions, client);
    global.respostasEnviadas++;

  } catch (error) {
    console.error("Erro ao processar mensagem:", error);
    registrarLogLocal(`Erro ao processar mensagem: ${error.message}`, "ERROR", "processarMensagem", msg.from);
  }
}

// Eventos do cliente
client.on("qr", (qr) => {
  console.log("QR Code gerado:");
  qrcode.generate(qr, { small: true });
});

client.on("authenticated", () => {
  console.log("Autenticado com sucesso!");
  registrarLogLocal("Bot autenticado", "INFO", "clientAuth", null);
});

client.on("ready", async () => {
  console.log("Bot está pronto!");
  registrarLogLocal("Bot está pronto", "INFO", "clientReady", null);
  
  // Inicializar dados
  await inicializarDados();
  
  // Configurar intervalos
  setInterval(salvarTodasSessoes, 5 * 60 * 1000); // A cada 5 minutos
});

client.on("message", processarMensagem);

client.on("disconnected", (reason) => {
  console.log("Cliente desconectado:", reason);
  registrarLogLocal(`Cliente desconectado: ${reason}`, "WARN", "clientEvent", null);
  
  // Tentar reconectar após 30 segundos
  setTimeout(() => {
    const { exec } = require('child_process');
    exec('pm2 restart bot', () => {});
  }, 30000);
});

client.on('auth_failure', (message) => {
  console.error('Falha na autenticação:', message);
  registrarLogLocal(`Falha na autenticação: ${message}`, "ERROR", "authFailure", null);
});

// Inicializar o cliente
console.log("Inicializando cliente WhatsApp...");
client.initialize().catch(error => {
  console.error("Erro ao inicializar cliente:", error);
  registrarLogLocal(`Erro ao inicializar cliente: ${error.message}`, "ERROR", "initialization", null);
  process.exit(1);
});

console.log("Bot inicializado com sucesso!");

// Exportações para evitar dependência circular
module.exports = {
  client,
  userSessions
};
