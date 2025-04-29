const { Client, LocalAuth } = require("whatsapp-web.js");
const { MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { obterJogosParaWhatsApp } = require("./scrapper.js");
const iptvstreamplayer = MessageMedia.fromFilePath("./streamplayer.png");
const ibo = MessageMedia.fromFilePath("./ibo.png");
const tabelaprecos = MessageMedia.fromFilePath("./tabelaprecos.png");

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
client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
});

client.on("authenticated", () => {
  console.log("Autenticado com sucesso!");
});

client.on("ready", () => {
  console.log("Bot está pronto!");
});

let modoAusente = false; 
const avisosEnviados = new Set(); 

async function handleMessage(msg) {
  if (msg.from.endsWith("@g.us")) return; // Ignora mensagens de grupos

  const chatId = msg.from;

  // Verifica se o contato está salvo
  const isSaved = await isContactSaved(chatId);

  // Inicializa a sessão do usuário, se não existir
  if (!userSessions.has(chatId)) {
    userSessions.set(chatId, { step: "menu", timestamp: Date.now(), invalidCount: 0 });
  }

  // Obtém a sessão do usuário
  const session = userSessions.get(chatId);

  // Respostas avulsas (independente de estar salvo ou não)
  if (
    msg.body.toLowerCase().includes("obrigado") ||
    msg.body.toLowerCase().includes("obrigada") ||
    msg.body.toLowerCase().includes("vlw") ||
    msg.body.toLowerCase().includes("obg")
  ) {
    await msg.reply("Disponha 🤝");
    return;
  }

  if (msg.body.toLowerCase() === "/limpar") {
    userSessions.clear();
    await msg.reply("Todas as sessões foram limpas com sucesso!");
    return;
  }

  if (msg.body.toLowerCase() === "bom dia") {
    await msg.reply("Bom dia!");
    return;
  }

  if (msg.body.toLowerCase() === "boa tarde") {
    await msg.reply("Boa tarde!");
    return;
  }

  if (msg.body.toLowerCase() === "boa noite") {
    await msg.reply("Boa noite!");
    return;
  }

  // Envia o menu apenas para contatos não salvos
  if (!isSaved) {
    const now = Date.now();
    console.log("Entrou na linha 93");

    // Verifica se a sessão expirou (12 horas)
    if (!session || now - session.timestamp > 12 * 60 * 60 * 1000) {
      console.log("Entrou na linha 97");
      userSessions.set(chatId, { step: "menu", timestamp: now, invalidCount: 0 });
      await msg.reply(
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
  } else {
    console.log(`[INFO] Contato ${chatId} está salvo. Menu não será enviado.`);
  }

  // Verifica se o modo ausente está ativado
  if (modoAusente && !avisosEnviados.has(chatId)) {
    await msg.reply(
      "No momento estamos ausentes, então o atendimento humano pode demorar um pouco mais que o normal."
    );
    avisosEnviados.add(chatId);
  }

  if (session.invalidCount >= 3) return;

  // Processa as etapas do menu
  if (session.step === "menu" || session.step === "menuRecovery") {
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
      session.step = "comoFunciona";
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
      const isSaved = contact.isMyContact; // Verifica se o contato está salvo
      console.log(`[VERIFICAÇÃO] O contato ${chatId} está salvo? ${isSaved}`);
      return isSaved;
    }

    console.log(
      `[VERIFICAÇÃO] O contato ${chatId} não foi encontrado na lista de contatos.`
    );
    return false; // Retorna false se o contato não foi encontrado
  } catch (error) {
    console.error("Erro ao verificar se o contato está salvo:", error);
    return false; // Em caso de erro, assume que o contato não está salvo
  }
}

client.on("message", async (msg) => {
  console.log(`[MENSAGEM RECEBIDA] De: ${msg.from}`);
  try {
    await handleMessage(msg);
  } catch (error) {
    console.error(`[ERRO] Ao processar mensagem de ${msg.from}:`, error);
  }
});

client.initialize();

module.exports = {
  client,
  handleMessage,
};
