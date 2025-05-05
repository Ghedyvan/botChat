const { Client, LocalAuth } = require("whatsapp-web.js");
const { MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { obterJogosParaWhatsApp } = require("./scrapper.js");
const iptvstreamplayer = MessageMedia.fromFilePath("./streamplayer.png");
const ibo = MessageMedia.fromFilePath("./ibo.png");
const tabelaprecos = MessageMedia.fromFilePath("./tabelaprecos.png");
const bannerIndicacao = MessageMedia.fromFilePath("./bannerIndicacao.png");
const fs = require("fs");
const indicacoesFile = "./indicacoes.json";
const adminNumber = "558282371442";
const logFile = "./bot.log";

function registrarLog(mensagem) {
  const agora = new Date();
  const dataHora = `[${agora.toLocaleDateString("pt-BR")} - ${agora
    .toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    .replace(":", "-")}]`; 
  const logMensagem = `${dataHora} ${mensagem}\n`;

  fs.appendFileSync(logFile, logMensagem, "utf8");
}

let indicacoes = {};

// Carrega os dados de indicações do arquivo JSON
if (fs.existsSync(indicacoesFile)) {
  try {
    const data = fs.readFileSync(indicacoesFile, "utf8");
    indicacoes = data ? JSON.parse(data) : {};
  } catch (error) {
    console.error("Erro ao carregar o arquivo indicacoes.json:", error);
    indicacoes = {};
  }
} else {
  fs.writeFileSync(indicacoesFile, JSON.stringify(indicacoes, null, 2));
}

function salvarIndicacoes() {
  fs.writeFileSync(indicacoesFile, JSON.stringify(indicacoes, null, 2));
}


const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    executablePath: "/usr/bin/chromium-browser",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--single-process",
      "--no-zygote",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--max-old-space-size=256",
    ],
  },
});

const userSessions = new Map();
// Eventos do cliente WhatsApp
client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
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
});

let modoAusente = false; 
const avisosEnviados = new Set(); 

async function handleMessage(msg) {
  if (msg.from.endsWith("@g.us")) return;

  const chatId = msg.from;

  if (msg.body.toLowerCase() === "/pontos" || msg.body.toLowerCase() === "/recompensas") {
    const chatId = msg.from;
  
    if (!indicacoes[chatId]) {
      await msg.reply("📊 Você ainda não possui nenhuma indicação registrada.");
      return;
    }
  
    const { nome, indicacoes: totalIndicacoes } = indicacoes[chatId];
    const pontos = totalIndicacoes * 10; // Calcula os pontos com base nas indicações
  
    await client.sendMessage(chatId, bannerIndicacao, {
      caption: `📊 ${nome}, você possui ${totalIndicacoes} indicação(ões), o que equivale a ${pontos} ponto(s).`,
    });
    return;
  }

  if (msg.body.toLowerCase() === "/indicacoes_todos") {

    if (msg.from !== `${adminNumber}@c.us`) {
      await msg.reply("⚠️ Você não tem permissão para usar este comando.");
      return;
    }
    if (Object.keys(indicacoes).length === 0) {
      await msg.reply("📊 Nenhuma indicação registrada até o momento.");
      return;
    }
  
    let resposta = "📋 *Lista de Indicações:*\n\n";
    for (const [numero, dados] of Object.entries(indicacoes)) {
      resposta += `📞 *${dados.nome || "Contato Desconhecido"}* (${numero}): ${dados.indicacoes} indicação(ões)\n`;
    }
  
    await msg.reply(resposta);
    return;
  }

  if (msg.body.toLowerCase() === "/indiquei") {
    const chatId = msg.from;
  
    const contato = await client.getContactById(chatId);
    const nomeContato = contato.pushname || contato.name || "Contato Desconhecido";
  
    if (!indicacoes[chatId]) {
      indicacoes[chatId] = { nome: nomeContato, indicacoes: 0 };
    }
  
    indicacoes[chatId].indicacoes += 1;
    const pontos = indicacoes[chatId].indicacoes * 10; 
  
    salvarIndicacoes();
    fazerBackupIndicacoes();

    await msg.reply(
      `✅ Indicação registrada com sucesso! ${indicacoes[chatId].nome}, você agora possui ${indicacoes[chatId].indicacoes} indicação(ões), o que equivale a ${pontos} ponto(s).\n\n` +
      'Se desejar ver a tabela de recompensas, envie a mensagem abaixo para mim:\n\n' +
      '/recompensas'
    );
    return;
  }

  function fazerBackupIndicacoes() {
    const agora = new Date();
    const dataHora = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}_${String(agora.getHours()).padStart(2, "0")}-${String(agora.getMinutes()).padStart(2, "0")}`;
    const backupFile = `./backups/indicacoes_backup_${dataHora}.json`;
  
    try {
      if (!fs.existsSync("./backups")) {
        fs.mkdirSync("./backups");
      }
      fs.copyFileSync(indicacoesFile, backupFile);
      console.log(`Backup criado: ${backupFile}`);
      registrarLog(`Backup criado: ${backupFile}`);
    } catch (error) {
      console.error("Erro ao criar backup:", error);
      registrarLog(`Erro ao criar backup: ${error.message}`);
    }
  }

  if (msg.body.toLowerCase().startsWith("/ajustar")) {
    const [_, quantidade] = msg.body.split(" ");
    const chatId = msg.from;
  
    if (!quantidade || isNaN(quantidade)) {
      await msg.reply("⚠️ Uso correto: /ajustar <quantidade>");
      return;
    }
  
    const contato = await client.getContactById(chatId);
    const nomeContato = contato.pushname || contato.name || "Contato Desconhecido";
  
    indicacoes[chatId] = {
      nome: nomeContato,
      indicacoes: parseInt(quantidade, 10),
    };
  
    salvarIndicacoes(); 
    await msg.reply(
      `✅ O número de indicações foi ajustado para ${indicacoes[chatId].indicacoes} para o contato ${indicacoes[chatId].nome}.`
    );
    return;
  }

  const contatoSalvo = await isContactSaved(chatId);
  
  if (
    msg.body.toLowerCase().includes("obrigado") ||
    msg.body.toLowerCase().includes("obrigada") ||
    msg.body.toLowerCase().includes("vlw") ||
    msg.body.toLowerCase().includes("obg") ||
    msg.body.toLowerCase().includes("obrigada")
  ) {
    await msg.reply("Disponha 🤝");
    return;
  }

  if (
    msg.body.toLowerCase() === "bom dia") {
    await msg.reply("Bom dia!");
    return;
  }
  if (
    msg.body.toLowerCase() === "boa tarde") {
    await msg.reply("Boa tarde!");
    return;
  }
  if (
    msg.body.toLowerCase() === "boa noite") {
    await msg.reply("Boa noite!");
    return;
  }
  if (msg.body.toLowerCase() === "/ausente") {
    modoAusente = true;
    avisosEnviados.clear();
    await msg.reply("Modo ausente ativado.");
    return;
  }

  if (msg.body.toLowerCase() === "/admin") {
    if (msg.from !== `${adminNumber}@c.us`) {
      await msg.reply("⚠️ Você não tem permissão para usar este comando.");
      return;
    }
  
    await msg.reply(
      "*Lista de comandos do BOT* \n\n" +
        "📋 *Comandos gerais:*\n" +
        "*/indicacoes -* Exibe o número de indicações do cliente\n" +
        "*/indicacoes_todos -* Lista o número de indicações de todos os clientes (somente admin)\n" +
        "*/indiquei -* Incrementa manualmente o número de indicações do cliente\n" +
        "*/ajustar <quantidade> -* Ajusta manualmente o número de indicações do cliente\n" +
        "*/jogos -* Exibe os jogos do dia\n\n" +
        "📋 *Comandos de status:*\n" +
        "*/ausente -* Ativa o modo ausente\n" +
        "*/ativo -* Desativa o modo ausente\n\n" +
        "📋 *Outros comandos:*\n" +
        "*/comandos -* Exibe esta lista de comandos\n" +
        "*/admin -* Exibe comandos administrativos\n\n" +
        "⚠️ _Alguns comandos são restritos ao administrador._"
    );
    return;
  }

  if (msg.body.toLowerCase() === "/comandos") {
    await msg.reply(
      "*Lista de comandos do BOT* \n\n" +
        "📋 *Comandos gerais:*\n" +
        "*/indicacoes -* Exibe o número de indicações que você fez\n" +
        "*/jogos -* Exibe os jogos do dia\n\n" +
        "📋 *Outros comandos:*\n" +
        "*/comandos -* Exibe esta lista de comandos\n" 
    );
    return;
  }

  if (msg.body.toLowerCase() === "/jogos") {
    const resposta = await obterJogosParaWhatsApp();
    if (typeof resposta === "string" && resposta.length > 0) {
      await msg.reply(resposta);
    } else {
      await msg.reply(
        "⚠️ Nenhum jogo foi encontrado ou houve erro ao obter os dados."
      );
    }
    return;
  }

  // Comando para desativar o modo ausente
  if (msg.body.toLowerCase() === "/ativo") {
    modoAusente = false;
    avisosEnviados.clear(); // Limpa os avisos enviados ao desativar o modo ausente
    await msg.reply("Modo ausente desativado.");
    return;
  }

  if (msg.body.toLowerCase().includes("chave") && msg.body.toLowerCase().includes("envia") || msg.body.toLowerCase().includes("manda") && msg.body.toLowerCase().includes("chave") ) {
    await msg.reply("Segue abaixo a chave pix do tipo aleatória:");
    await msg.reply("c366c9e3-fb7c-431f-957e-97287f4f964f");
    return;
  }

  // Verifica se o modo ausente está ativado
  if (modoAusente && !avisosEnviados.has(chatId)) {
    // Envia o aviso apenas se ainda não foi enviado para este usuário
    await msg.reply(
      "No momento estamos ausentes, então o atendimento humano pode demorar um pouco mais que o normal."
    );
    avisosEnviados.add(chatId); // Marca o usuário como já avisado
  }

  const now = Date.now();

  if (
    !userSessions.has(chatId) ||
    now - userSessions.get(chatId).timestamp > 12 * 60 * 60 * 1000
  ) {
    if (contatoSalvo) return;
    userSessions.set(chatId, { step: "menu", timestamp: now, invalidCount: 0 });
    await msg.reply(
      "Olá! Como posso te ajudar? Responda com o número da opção que deseja:\n\n" +
        "1️⃣ Conhecer nossos planos de IPTV\n" +
        "2️⃣ Testar o serviço gratuitamente\n" +
        "3️⃣ Saber mais sobre como funciona o IPTV\n" +
        "4️⃣ Já testei e quero pagar agora\n" +
        "5️⃣ Falar com um atendente\n\n" +
        "⚠️ Um humano não verá suas mensagens até que uma opção válida do robô seja escolhida."
    );
    return;
  }

  const session = userSessions.get(chatId);

  if (msg.body === "0") {
    session.step = "menuRecovery";
    session.invalidCount = 0;
    await msg.reply(
      "Bem vindo de volta ao menu\n\n" +
        "1️⃣ Conhecer nossos planos de IPTV\n" +
        "2️⃣ Testar o serviço gratuitamente\n" +
        "3️⃣ Saber mais sobre como funciona o IPTV\n" +
        "4️⃣ Já testei e quero pagar agora\n" +
        "5️⃣ Falar com um atendente"
    );
    return;
  }

  if (session.invalidCount >= 3) return;

  if (session.step === "menu" || session.step === "menuRecovery") {
    if (msg.body === "1") {
      session.step = "planos";
      session.invalidCount = 0;
      await client.sendMessage(msg.from, tabelaprecos, {
        caption:
          "📌 Escolha o que deseja fazer agora:\n\n" +
          "1️⃣ Testar o serviço gratuitamente\n" +
          "2️⃣ Escolhi meu plano, já fiz o teste e quero pagar agora\n" +
          "3️⃣ Saber mais sobre como funciona o IPTV\n\n" +
          "0️⃣ Menu inicial",
      });
    } else if (msg.body === "2") {
      session.step = "testar";
      session.invalidCount = 0;
      await msg.reply(
        "Em qual dispositivo gostaria de realizar o teste?\n\n1️⃣ Celular\n2️⃣ TV Box\n3️⃣ Smart TV\n4️⃣ Computador\n\n0️⃣ Menu inicial"
      );
    } else if (msg.body === "3") {
      session.step = "comoFunciona";
      session.invalidCount = 0;
      await msg.reply(
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
      await msg.reply(
        "Digite abaixo o que deseja, um atendente humano irá responder suas mensagens o mais rápido possível 😊"
      );
    }
  } else if (session.step === "testar") {
    if (msg.body === "1" || msg.body.toLowerCase().includes("celular")) {
      session.step = "celular";
      session.invalidCount = 0;
      await msg.reply(
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
      await msg.reply(
        "Qual a marca da sua TV?\n\n1️⃣ LG\n2️⃣ Samsung\n3️⃣ Outra com Android\n4️⃣ Outra com Roku\n5️⃣ Não sei se é Roku ou Android\n\n0️⃣ Menu inicial"
      );
    } else if (
      msg.body === "4" ||
      msg.body.toLowerCase().includes("computador")
    ) {
      session.step = "computador";
      session.invalidCount = 0;
      await msg.reply(
        "🌐 No seu computador, acesse o site: applime.cc\n\n" +
          "👤 Me informe quando acessar para te enviar os dados de acesso"
      );
    } else {
      session.invalidCount = (session.invalidCount || 0) + 1;
      if (session.invalidCount < 3) {
        await msg.reply(
          "Escolha um dispositivo válido:\n\n1️⃣ Celular\n2️⃣ TV Box\n3️⃣ Smart TV\n4️⃣ Computador\n\n0️⃣ Menu inicial"
        );
      }
    }
  } else if (session.step === "celular") {
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
      await msg.reply(
        "✅ Siga os passos abaixo para configurar:\n\n" +
          "1. Baixe o *Smarters Player Lite* na AppStore\n" +
          "2. Abra o app e aceite os termos (Se ele pedir)\n" +
          "3. Selecione *Xtreme Codes* na tela\n\n" +
          "🔑 Quando chegar na tela de login, me avise que te envio seus dados!"
      );
    } else {
      session.invalidCount = (session.invalidCount || 0) + 1;
      if (session.invalidCount < 3) {
        await msg.reply(
          "Escolha uma opção válida:\n\n1️⃣ Android\n2️⃣ iPhone\n\n0️⃣ Menu inicial"
        );
      }
    }
  } else if (session.step === "smarttv") {
    if (msg.body === "1") {
      session.step = "lg";
      session.invalidCount = 0;
      await msg.reply(
        "✅ Siga os passos abaixo para configurar:\n\n" +
          "▸ Abra a loja de apps da TV (*APP* ou *LG Content Store*)\n" +
          "▸ Instale o *IPTVSmartersPRO*\n" +
          "▸ Abra o app > aceite os termos\n\n" +
          "📩 Quando chegar na tela de login, me avise que te envio seus dados!"
      );
    } else if (msg.body === "2") {
      session.step = "samsung";
      session.invalidCount = 0;
      await msg.reply(
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
      await msg.reply(
        "✅ Siga os passos abaixo para configurar:\n\n" +
          "1️⃣ *Abra* a loja de aplicativos da sua TV\n" +
          "2️⃣ *Procure* pelo aplicativo *xCloud TV* e instale\n" +
          "3️⃣ *Abra* o aplicativo e me informe para eu te enviar os dados de acesso\n\n" +
          "⚠️ *Obs:* _Se não encontrar o xCloud TV, me avise que te ajudo a baixar outro app._"
      );
    } else if (msg.body === "5") {
      session.step = "outro";
      session.invalidCount = 0;
      await msg.reply(
        "📱 Abre a loja de aplicativos e me manda uma foto da tela, por favor!"
      );
    } else {
      session.invalidCount = (session.invalidCount || 0) + 1;
      if (session.invalidCount < 3) {
        await msg.reply(
          "Qual a marca da sua TV?\n\n1️⃣ LG\n2️⃣ Samsung\n3️⃣ Outra com Android\n4️⃣ Outra com Roku\n5️⃣ Não sei se é Roku ou Android\n\n0️⃣ Menu inicial"
        );
      }
    }
  } else if (session.step === "planos") {
    if (msg.body === "1") {
      session.step = "testar";
      session.invalidCount = 0;
      await msg.reply(
        "Em qual dispositivo gostaria de realizar o teste?\n\n1️⃣ Celular\n2️⃣ TV Box\n3️⃣ Smart TV\n4️⃣ Computador\n\n0️⃣ Menu inicial"
      );
    } else if (msg.body === "2") {
      session.step = "ativar";
      session.invalidCount = 0;
      await msg.reply(
        "📌 Escolha o plano que deseja:\n\n" +
          "1️⃣ Plano CINEMA (R$ 18,00 por mês)\n" +
          "2️⃣ Plano COMPLETO (R$ 20,00 por mês)\n" +
          "3️⃣ Plano DUO (R$ 35,00 por mês)\n\n" +
          "0️⃣ Menu inicial\n\n" +
          "_O plano completo tem acréscimo de 5$ caso seja pago após o vencimento_"
      );
    } else if (msg.body === "3") {
      session.step = "comoFunciona2";
      session.invalidCount = 0;
      await msg.reply(
        "O IPTV é um serviço de streaming que permite assistir a canais de TV ao vivo, filmes, séries e novelas pela internet. Você pode acessar uma variedade de canais e programas em diferentes dispositivos, como TVs, smartphones e computadores.\n\n" +
          "0️⃣ Menu inicial"
      );
    }
  } else if (session.step === "ativar") {
    if (msg.body === "1") {
      session.step = "cinema";
      await msg.reply(
        "Perfeito, o plano escolhido custa apenas R$ 18,00 por mês, você deseja efetuar o pagamento via cartão ou pix?\n\n" +
          "1️⃣ Cartão de crédito\n" +
          "2️⃣ PIX\n\n" +
          "_Obs: No cartão tem taxa da operadora de cerca de 1 real_"
      );
    } else if (msg.body === "2") {
      session.step = "completo";
      await msg.reply(
        "Perfeito, o plano escolhido custa apenas R$ 20,00 por mês, você deseja efetuar o pagamento via cartão ou pix?\n\n" +
          "1️⃣ Cartão de crédito\n" +
          "2️⃣ PIX\n\n" +
          "_Obs: No cartão tem taxa da operadora de cerca de 1 real_"
      );
    } else if (msg.body === "3") {
      session.step = "duo";
      await msg.reply(
        "Perfeito, o plano escolhido custa apenas R$ 35,00 por mês, você deseja efetuar o pagamento via cartão ou pix?\n\n" +
          "1️⃣ Cartão de crédito\n" +
          "2️⃣ PIX\n\n" +
          "_Obs: No cartão tem taxa da operadora de cerca de 1 real_"
      );
    }
  } else if (session.step = "cinema") {
    if (msg.body === "1") {
      session.step = "pagamentoCinemaCartao";
      await msg.reply(
        "Combinado, você pode efetuar o pagamento com cartão através do link abaixo:\n\n" +
          "https://pay.infinitepay.io/servico-suportetv/VC1D-MOItUPj43-18,00"
      );
    } else if (msg.body === "2") {
      session.step = "pagamentoCinemaPix";
      await msg.reply(
        "Combinado, você pode efetuar o pagamento por PIX através da chave pix aleatória abaixo:"
      );
      await msg.reply("c366c9e3-fb7c-431f-957e-97287f4f964f");
    }
  } else if (session.step = "completo") {
    if (msg.body === "1") {
      session.step = "pagamentoCompletoCartao";
      await msg.reply(
        "Combinado, você pode efetuar o pagamento com cartão através do link abaixo:\n\n" +
          "https://pay.infinitepay.io/servico-suportetv/VC1D-cYyPbKeF-20,00"
      );
    } else if (msg.body === "2") {
      session.step = "pagamentoCompletoPix";
      await msg.reply(
        "Combinado, você pode efetuar o pagamento por PIX através da chave pix aleatória abaixo:"
      );
      await msg.reply("c366c9e3-fb7c-431f-957e-97287f4f964f");
    }
  } else if (session.step = "duo") {
    if (msg.body === "1") {
      session.step = "pagamentoDuoCartao";
      await msg.reply(
        "Combinado, você pode efetuar o pagamento com cartão através do link abaixo:\n\n" +
          "https://pay.infinitepay.io/servico-suportetv/VC1D-5PscvMd79r-35,00"
      );
    } else if (msg.body === "2") {
      session.step = "pagamentoDuoPix";
      await msg.reply(
        "Combinado, você pode efetuar o pagamento por PIX através da chave pix aleatória abaixo:"
      );
      await msg.reply("c366c9e3-fb7c-431f-957e-97287f4f964f");
    }
  }
}

async function isContactSaved(chatId) {
  try {
    const contacts = await client.getContacts();
    const contact = contacts.find((c) => c.id._serialized === chatId);

    if (contact) {
      const isSaved = contact.isMyContact;
      return isSaved;
    }
    return false; 
  } catch (error) {
    console.error("Erro ao verificar se o contato está salvo:", error);
    return false; 
  }
}

client.on("message", async (msg) => {
  if (msg.from.endsWith("@g.us")) return;

  const logMensagem = `[MENSAGEM RECEBIDA] De: ${msg.from}`;
  console.log(logMensagem);
  registrarLog(logMensagem);
  try {
    await handleMessage(msg);
  } catch (error) {
    const erroMensagem = `[ERRO] Ao processar mensagem de ${msg.from}: ${error.message}`;
    console.error(erroMensagem);
    registrarLog(erroMensagem);
  }
});

client.initialize();

module.exports = {
  client,
  handleMessage, 
};
