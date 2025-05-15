const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");

// Módulos internos
const { obterJogosParaWhatsApp } = require("./scrapper.js");
const { loadSessions, saveSessions } = require("./sessionHandler.js");
const { isContactSaved, responderComLog } = require("./utils.js");
const config = require("./config.js");

// Banco de dados
const supabaseClient = require("./supabase");

// Configurações
const adminNumber = config.ADMIN_NUMBER;
const logFile = config.LOG_FILE;
const sessionTimeout = config.SESSION_TIMEOUT || 12 * 60 * 60 * 1000; // 12 horas por padrão
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
let respostasEnviadas = 0;
let ultimaAtividadeTempo = Date.now();
let monitoramentoAtivo = true;
const userSessions = new Map();

// Carregar dados persistentes
async function inicializarDados() {
  // Inicializar conexão com Supabase
  await supabaseClient.inicializarSupabase();

  // Tentar migrar dados do JSON para o Supabase (apenas na primeira vez)
  if (fs.existsSync(indicacoesFile)) {
    await supabaseClient.migrarDoJSON(indicacoesFile);
  }

  // Carregar sessões (mantém como estava)
  const sessions = loadSessions();
  if (sessions && sessions.length > 0) {
    sessions.forEach(([id, userData]) => {
      userSessions.set(id, userData);
    });
    console.log(`${userSessions.size} sessões carregadas com sucesso.`);
  }
}

// Salvar dados de indicações
function salvarIndicacoes() {
  try {
    fs.writeFileSync(indicacoesFile, JSON.stringify(indicacoes, null, 2));
    return true;
  } catch (error) {
    console.error("Erro ao salvar indicações:", error);
    registrarLog(`Erro ao salvar indicações: ${error.message}`);
    return false;
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
function registrarLog(mensagem) {
  const agora = new Date();
  const dataHora = `[${agora.toLocaleDateString("pt-BR")} - ${agora
    .toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    .replace(":", "-")}]`;
  const logMensagem = `${dataHora} ${mensagem}\n`;

  fs.appendFileSync(logFile, logMensagem, "utf8");
}

// Inicializar cliente WhatsApp
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    //executablePath: "/usr/bin/chromium-browser",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--single-process",
      "--no-zygote",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--disable-extensions",
      "--disable-component-extensions-with-background-pages",
      "--disable-backgrounding-occluded-windows",
      "--max-old-space-size=512",
    ],
    defaultViewport: null,
  },
});

// Função para reinício suave
async function reinicioSuave() {
  console.log("Realizando reinício suave do bot...");
  registrarLog("Realizando reinício suave do bot");

  try {
    // 1. Salvar sessões de usuários
    saveSessions(userSessions);

    // 2. Resetar contadores e variáveis de estado
    mensagensRecebidas = 0;
    respostasEnviadas = 0;
    ultimaAtividadeTempo = Date.now();

    // 3. Limpar caches com tratamento de erro específico
    try {
      if (client.pupPage && !client.pupPage.isClosed()) {
        await client.pupPage
          .evaluate(() => {
            if (window.caches) {
              return caches.keys().then((names) => {
                for (let name of names) caches.delete(name);
                return true;
              });
            }
            return false;
          })
          .catch((err) => {
            if (err.message.includes("Execution context was destroyed")) {
              console.log(
                "Contexto destruído durante limpeza de cache, prosseguindo com reinicialização"
              );
              return false;
            }
            throw err;
          });
      }
    } catch (cacheClearError) {
      console.log(
        "Erro ao limpar cache, mas continuando com reinício:",
        cacheClearError.message
      );
    }

    // 4. Forçar coleta de lixo (se disponível)
    if (global.gc) global.gc();

    console.log("Reinício suave concluído com sucesso!");
    registrarLog("Reinício suave concluído com sucesso");
    return true;
  } catch (error) {
    console.error("Erro durante reinício suave:", error);
    registrarLog(`Erro durante reinício suave: ${error.message}`);
    return false;
  }
}

// Verificar estado da conexão regularmente
async function verificarEstadoConexao() {
  try {
    const estado = await client.getState();
    console.log(`Estado atual do cliente: ${estado}`);

    if (estado !== "CONNECTED") {
      console.log("Cliente não está conectado, tentando reconectar...");
      registrarLog(`Cliente em estado ${estado}, tentando reconectar`);
      client.initialize();
    }

    if (client.pupBrowser) {
      const pages = await client.pupBrowser.pages().catch(() => null);
      if (!pages) {
        console.log("Navegador não está respondendo, tentando reiniciar...");
        registrarLog("Navegador não está respondendo, tentando reiniciar");
        await reinicioSuave();
      }
    }
  } catch (error) {
    console.error("Erro ao verificar estado da conexão:", error);
    registrarLog(`Erro ao verificar estado da conexão: ${error.message}`);

    if (error.message.includes("Execution context was destroyed")) {
      console.log(
        "Contexto destruído detectado em verificação de estado, reiniciando..."
      );
      registrarLog("Contexto destruído detectado em verificação periódica");
      setTimeout(() => {
        client.initialize();
      }, 5000);
    }
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
        registrarLog(
          "PROBLEMA DETECTADO: Bot recebendo mensagens mas não respondendo."
        );

        // Evita reinícios múltiplos
        monitoramentoAtivo = false;

        // Tenta reinício suave
        reinicioSuave().then((sucesso) => {
          if (sucesso) {
            console.log("Reinício automático bem sucedido!");
            registrarLog("Reinício automático bem sucedido");
          } else {
            console.error("Reinício automático falhou");
            registrarLog("Reinício automático falhou");
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
  registrarLog(mensagem);
});

client.on("ready", () => {
  const mensagem = "Bot está pronto!";
  console.log(mensagem);
  registrarLog(mensagem);

  // Iniciar monitoramento
  setInterval(monitorarSaudeBot, 60000); // Verificar a cada minuto
  setInterval(verificarEstadoConexao, 15 * 60 * 1000); // A cada 15 minutos

  // Backup diário
  const agora = new Date();
  const proximaMeiaNoite = new Date(agora);
  proximaMeiaNoite.setHours(24, 0, 0, 0);
  const tempoAteBackup = proximaMeiaNoite - agora;

  setTimeout(() => {
    fazerBackupIndicacoes();
    setInterval(fazerBackupIndicacoes, 24 * 60 * 60 * 1000);
  }, tempoAteBackup);
});

client.on("disconnected", async (reason) => {
  console.log("Cliente desconectado:", reason);
  registrarLog(`Cliente desconectado: ${reason}`);

  setTimeout(() => {
    console.log("Tentando reconectar...");
    registrarLog("Tentando reconectar após desconexão");
    client.initialize();
  }, 10000);
});

// Processador de mensagens principal
async function handleMessage(msg) {
  if (msg.from.endsWith("@g.us")) return;

  const chatId = msg.from;
  const contatoSalvo = await isContactSaved(chatId);

  // COMANDOS UNIVERSAIS (funcionam para todos)
  // =======================================

  // Comando para limpar sessão
  if (
    msg.body.toLowerCase() === "/clear" ||
    msg.body.toLowerCase() === "/reiniciar_conversa"
  ) {
    userSessions.set(chatId, {
      step: "menu",
      timestamp: Date.now(),
      invalidCount: 0,
    });
    saveSessions(userSessions);

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
    registrarLog(`Sessão reiniciada pelo usuário: ${chatId}`);

    return;
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
        saveSessions(userSessions);

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
    // Se for um contato salvo que não está na lista de comandos, não processamos mais nada
    return;
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
    userSessions.set(chatId, { step: "menu", timestamp: now, invalidCount: 0 });
    saveSessions(userSessions);

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
      await responderComLog(
        msg,
        "Percebi que você está tentando conversar. Ativei o modo de atendimento humano. Um atendente responderá sua mensagem assim que possível."
      );
      console.log(`Atendimento humano ativado automaticamente para: ${chatId}`);
      registrarLog(
        `Atendimento humano ativado automaticamente para: ${chatId}`
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

  // Impede processamento se tiver muitas mensagens inválidas
  if (session.invalidCount >= 3) return;

  // Menu inicial
  if (session.step === "menu" || session.step === "menuRecovery") {
    // Processamento do menu principal
    processarMenuPrincipal(msg, session);
  } else if (session.step === "testar") {
    // Processamento da etapa de teste
    processarTestar(msg, session);
  } else if (session.step === "celular") {
    // Processamento da etapa de celular
    processarCelular(msg, session);
  } else if (session.step === "smarttv") {
    // Processamento da etapa de smart TV
    processarSmartTV(msg, session);
  } else if (session.step === "planos") {
    // Processamento da etapa de planos
    processarPlanos(msg, session);
  } else if (session.step === "ativar") {
    // Processamento da etapa de ativação
    processarAtivar(msg, session);
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
  }
}

// PROCESSADORES DE ETAPAS

// Menu principal
async function processarMenuPrincipal(msg, session) {
  if (msg.body === "1") {
    session.step = "planos";
    session.invalidCount = 0;
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
    await responderComLog(
      msg,
      "Em qual dispositivo gostaria de realizar o teste?\n\n1️⃣ Celular\n2️⃣ TV Box\n3️⃣ Smart TV\n4️⃣ Computador\n\n0️⃣ Menu inicial"
    );
  } else if (msg.body === "3") {
    session.step = "comoFunciona";
    session.invalidCount = 0;
    await responderComLog(
      msg,
      "O IPTV é um serviço de streaming que permite assistir a canais de TV ao vivo, filmes, séries e novelas pela internet. Você pode acessar uma variedade de canais e programas em diferentes dispositivos, como TVs, smartphones e computadores.\n\n" +
        "0️⃣ Menu inicial"
    );
  } else if (msg.body === "4") {
    session.step = "ativar";
    session.invalidCount = 0;
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
    await responderComLog(
      msg,
      "Digite abaixo o que deseja, um atendente humano irá responder suas mensagens o mais rápido possível 😊"
    );
  } else {
    session.invalidCount = (session.invalidCount || 0) + 1;
    if (session.invalidCount < 3) {
      await responderComLog(
        msg,
        "Por favor, escolha uma opção válida:\n\n" +
          "1️⃣ Conhecer nossos planos de IPTV\n" +
          "2️⃣ Testar o serviço gratuitamente\n" +
          "3️⃣ Saber mais sobre como funciona o IPTV\n" +
          "4️⃣ Já testei e quero ativar\n" +
          "5️⃣ Falar com um atendente\n\n" +
          "⚠️ Um humano não verá suas mensagens até que uma opção válida do robô seja escolhida."
      );
    }
  }
}

// Testar
async function processarTestar(msg, session) {
  if (msg.body === "1" || msg.body.toLowerCase().includes("celular")) {
    session.step = "celular";
    session.invalidCount = 0;
    await responderComLog(
      msg,
      "Seu celular é:\n\n1️⃣ Android\n2️⃣ iPhone\n\n0️⃣ Menu inicial"
    );
  } else if (msg.body === "2" || msg.body.toLowerCase().includes("tvbox")) {
    session.step = "tvbox";
    session.invalidCount = 0;
    await client.sendMessage(msg.from, iptvstreamplayer, {
      caption:
        "✅ Siga os passos abaixo para configurar:\n\n" +
        "📲 Procura na PlayStore e baixa um aplicativo chamado *IPTV STREAM PLAYER*.\n\n" +
        "📌 Depois, pode abrir, irá aparecer uma tela com 3 botões, você seleciona o primeiro e ele irá te direcionar à página onde pede os dados de login.\n" +
        "🚀 Quando chegar nessa tela, me informe.",
    });
  } else if (msg.body === "3" || msg.body.toLowerCase().includes("smarttv")) {
    session.step = "smarttv";
    session.invalidCount = 0;
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
    await client.sendMessage(msg.from, iptvstreamplayer, {
      caption:
        "✅ Siga os passos abaixo para configurar:\n\n" +
        "📲 Procura na PlayStore e baixa um aplicativo chamado *IPTV STREAM PLAYER*.\n\n" +
        "📌 Depois, pode abrir, irá aparecer uma tela com 3 botões, você seleciona o primeiro e ele irá te direcionar à página onde pede os dados de login.\n" +
        "🚀 Quando chegar nessa tela, me informe.",
    });
  } else if (msg.body === "2") {
    session.step = "iphone";
    session.invalidCount = 0;
    await responderComLog(
      msg,
      "✅ Siga os passos abaixo para configurar:\n\n" +
        "1. Baixe o *Smarters Player Lite* na AppStore\n" +
        "2. Abra o app e aceite os termos (Se ele pedir)\n" +
        "3. Selecione *Xtreme Codes* na tela\n\n" +
        "🔑 Quando chegar na tela de login, me avise que te envio seus dados!"
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
    await responderComLog(
      msg,
      "✅ Siga os passos abaixo para configurar:\n\n" +
        "▸ Abra a loja de apps da TV (*APP* ou *LG Content Store*)\n" +
        "▸ Instale o *IPTVSmartersPRO*\n" +
        "▸ Abra o app > aceite os termos\n\n" +
        "📩 Quando chegar na tela de login, me avise que te envio seus dados!"
    );
  } else if (msg.body === "2") {
    session.step = "samsung";
    session.invalidCount = 0;
    await responderComLog(
      msg,
      "✅ Siga os passos abaixo para configurar:\n\n" +
        "1️⃣ *Abra* a loja de aplicativos da sua TV\n" +
        "2️⃣ *Procure* pelo aplicativo *xCloud TV* e instale\n" +
        "3️⃣ *Abra* o aplicativo e me informe para eu te enviar os dados de acesso\n\n" +
        "⚠️ *Obs:* Se não encontrar o xCloud TV, me avise que te ajudo a baixar outro app."
    );
  } else if (msg.body === "3") {
    session.step = "android";
    session.invalidCount = 0;
    await client.sendMessage(msg.from, iptvstreamplayer, {
      caption:
        "✅ Siga os passos abaixo para configurar:\n\n" +
        "📲 Procura na PlayStore e baixa um aplicativo chamado *IPTV STREAM PLAYER*.\n\n" +
        "📌 Depois, pode abrir, irá aparecer uma tela com 3 botões, você seleciona *LOGIN WITH NEW USER ACCOUNT* e ele irá te direcionar à página onde pede os dados de login.\n" +
        "🚀 Quando chegar nessa tela, me informe para eu te enviar os dados.",
    });
  } else if (msg.body === "4") {
    session.step = "roku";
    session.invalidCount = 0;
    await responderComLog(
      msg,
      "✅ Siga os passos abaixo para configurar:\n\n" +
        "1️⃣ *Abra* a loja de aplicativos da sua TV\n" +
        "2️⃣ *Procure* pelo aplicativo *xCloud TV* e instale\n" +
        "3️⃣ *Abra* o aplicativo e me informe para eu te enviar os dados de acesso\n\n" +
        "⚠️ *Obs:* _Se não encontrar o xCloud TV, me avise que te ajudo a baixar outro app._"
    );
  } else if (msg.body === "5") {
    session.step = "outro";
    session.invalidCount = 0;
    await responderComLog(
      msg,
      "📱 Abre a loja de aplicativos e me manda uma foto da tela, por favor!"
    );
  } else {
    session.invalidCount = (session.invalidCount || 0) + 1;
    if (session.invalidCount < 3) {
      await responderComLog(
        msg,
        "Qual a marca da sua TV?\n\n1️⃣ LG\n2️⃣ Samsung\n3️⃣ Outra com Android\n4️⃣ Outra com Roku\n5️⃣ Não sei se é Roku ou Android\n\n0️⃣ Menu inicial"
      );
    }
  }
}

// Planos
async function processarPlanos(msg, session) {
  if (msg.body === "1") {
    session.step = "testar";
    session.invalidCount = 0;
    await responderComLog(
      msg,
      "Em qual dispositivo gostaria de realizar o teste?\n\n1️⃣ Celular\n2️⃣ TV Box\n3️⃣ Smart TV\n4️⃣ Computador\n\n0️⃣ Menu inicial"
    );
  } else if (msg.body === "2") {
    session.step = "ativar";
    session.invalidCount = 0;
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

  // Log de mensagem recebida
  const logMensagem = `[MENSAGEM RECEBIDA] De: ${msg.from} [${statusContato}]`;
  console.log(logMensagem);
  registrarLog(logMensagem);

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
    registrarLog(erroMensagem);
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
    registrarLog("Erro de contexto destruído detectado, iniciando recuperação");

    setTimeout(() => {
      reinicioSuave().catch((err) => {
        console.error("Falha no reinício suave após erro de contexto:", err);
        registrarLog(
          `Falha no reinício suave após erro de contexto: ${err.message}`
        );
        client.initialize();
      });
    }, 5000);
  } else {
    console.error("Unhandled Rejection:", reason);
    registrarLog(`Erro não tratado: ${reason?.message || reason}`);
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

    console.log("Inicialização concluída!");
  } catch (error) {
    console.error("Erro durante inicialização:", error);
    registrarLog(`Erro durante inicialização: ${error.message}`);
  }
})();

module.exports = {
  client,
  handleMessage,
  reinicioSuave,
};
