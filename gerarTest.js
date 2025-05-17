const axios = require("axios");
const fs = require("fs");
const supabaseClient = require('./supabase');
const { obterDataBrasilia } = require('./utils');

const testesPendentes = new Map();

async function gerarTeste(msg, app) {
  try {
    console.log(`Tentando gerar teste para ${msg.from} com app ${app}...`);
    
    const userId = msg.from;
    
    const verificacao = await supabaseClient.podeRealizarTeste(userId);
    
    if (!verificacao.permitido) {
      const dataFormatada = new Date(verificacao.dataDesbloqueio).toLocaleDateString('pt-BR');
      await msg.reply(
        `⚠️ Você já utilizou seu teste gratuito recentemente.\n\n` +
        `Será possível fazer um novo teste em ${verificacao.diasRestantes} dias (${dataFormatada}).\n\n` +
        `Caso queira contratar agora sem precisar esperar, digite /planos para ver nossas opções.`
      );
      return;
    }
    
    let dispositivo = "Desconhecido";
    if (app === "iptvstream") dispositivo = "Android/TV Box";
    else if (app === "smarters") dispositivo = "iPhone/iPad";
    else if (app === "xcloud") dispositivo = "Smart TV";
    
    console.log(`Enviando requisição para API de testes...`);
    
    const postData = {
      appName: "com.whatsapp",
      messageDateTime: obterDataBrasilia().toISOString(),
      devicePhone: "",
      deviceName: "",
      senderName: msg._data?.notifyName || "Nome Desconhecido",
      senderMessage: msg.body,
      userAgent: "BotBot.Chat",
    };

    const response = await axios.post(
      "https://goldplay.sigma.st/api/chatbot/mVLl9vYDQw/rlKWO3Wzo7",
      postData
    );

    if (response.data) {
      const tempFilePath = "./temp_response.json";

      fs.writeFileSync(
        tempFilePath,
        JSON.stringify(response.data, null, 2),
        "utf8"
      );

      const { username, password } = response.data;

      if (username && password) {
        console.log(`Enviando credenciais para o usuário: ${username}`);
        
        await supabaseClient.registrarTesteUsuario(userId, app, dispositivo);
        
        if (app === "xcloud") {
          await msg.reply(
            `✅ Preencha os 3 campos na ordem abaixo:\n\n` +
              `🛜 *Provedor:* goldplaybr\n` +
              `👤 *Usuário:* ${username}\n` +
              `🔑 *Senha:* ${password}\n\n` +
              'Seu teste tem duração de 3h, fique a vontade para testar e conhecer nossos conteúdos 😉'
          );
        } else if (app === "iptvstream") {
          await msg.reply(
            `✅ Preencha os 3 campos na ordem abaixo:\n\n` +
              `👤 *Usuário:* ${username}\n` +
              `🔑 *Senha:* ${password}\n` +
              `🛜 *Servidor:* http://gbbrtk.online\n\n` +
              'Seu teste tem duração de 3h, fique a vontade para testar e conhecer nossos conteúdos 😉'
          );
        } else if (app === "smarters") {
          await msg.reply(
            `✅ Preencha os 4 campos na ordem abaixo:\n\n` +
              `👤 *Nome:* gold\n` +
              `👤 *Usuário:* ${username}\n` +
              `🔑 *Senha:* ${password}\n` +
              `🛜 *Servidor:* http://gpthzhx.top\n\n` +
              'Seu teste tem duração de 3h, fique a vontade para testar e conhecer nossos conteúdos 😉'
          );
        } else {
          await msg.reply(
            `✅ Preencha os seus dados de acesso\n\n` +
              `🔑 *Username:* ${username}\n` +
              `🔒 *Password:* ${password}\n\n` +
              'Seu teste tem duração de 3h, fique a vontade para testar e conhecer nossos conteúdos 😉'
          );
        }
        
        testesPendentes.set(userId, {
          timestamp: Date.now(),
          app: app,
          dispositivo: dispositivo,
          username: username,
          respondido: false
        });
        
        setTimeout(() => {
          verificarAcompanhamentoTeste(userId, msg.reply.bind(msg));
        }, 2 * 60 * 60 * 1000);
        
      } else {
        console.error("API não retornou credenciais");
        await msg.reply(
          "⚠️ Não foi possível gerar teste. Por favor, aguarde alguns instantes e tente novamente."
        );
      }
      
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } else {
      console.error("API não retornou dados");
      await msg.reply("⚠️ A API não retornou dados. Por favor, tente novamente mais tarde.");
    }
  } catch (error) {
    console.error("Erro ao fazer a requisição para a API:", error);
    await msg.reply("⚠️ Ocorreu um erro ao tentar obter as informações. Por favor, tente novamente em alguns instantes.");
  }
}

async function verificarAcompanhamentoTeste(userId, replyFunction) {
  try {
    const testePendente = testesPendentes.get(userId);
    if (!testePendente || testePendente.respondido) {
      console.log(`Teste de ${userId} já foi respondido ou não existe mais`);
      return;
    }
    
    console.log(`Enviando mensagem de acompanhamento para ${userId}`);
    
    const mensagem = 
      `Olá! Seu acesso de teste encerrará em breve. Era isso que você estava buscando?\n\n` +
      `Se você gostou e deseja ativar um plano, é só digitar /planos para ver nossas opções! 😊\n\n` +
      `_Se teve algum problema ou dúvida, me avise que posso te ajudar._ `;
    
    await replyFunction(mensagem);
    
    testesPendentes.delete(userId);
    
  } catch (error) {
    console.error(`Erro ao enviar mensagem de acompanhamento para ${userId}:`, error);
  }
}

function marcarTesteRespondido(userId) {
  if (testesPendentes.has(userId)) {
    const teste = testesPendentes.get(userId);
    teste.respondido = true;
    testesPendentes.set(userId, teste);
    console.log(`Teste de ${userId} marcado como respondido`);
  }
}

module.exports = {
  gerarTeste,
  marcarTesteRespondido
};