const axios = require("axios");
const fs = require("fs");
const supabaseClient = require('./supabase');

async function gerarTeste(msg, app) {
  try {
    console.log(`Tentando gerar teste para ${msg.from} com app ${app}...`);
    
    const userId = msg.from;
    
    // Verificar se o usuário já fez teste antes
    const verificacao = await supabaseClient.podeRealizarTeste(userId);
    
    if (!verificacao.permitido) {
      // Usuário não pode fazer teste agora
      const dataFormatada = new Date(verificacao.dataDesbloqueio).toLocaleDateString('pt-BR');
      await msg.reply(
        `⚠️ Você já utilizou seu teste gratuito recentemente.\n\n` +
        `Será possível fazer um novo teste em ${verificacao.diasRestantes} dias (${dataFormatada}).\n\n` +
        `Caso queira contratar agora sem precisar esperar, digite /planos para ver nossas opções.`
      );
      return;
    }
    
    // Definir o tipo de dispositivo com base no app
    let dispositivo = "Desconhecido";
    if (app === "iptvstream") dispositivo = "Android/TV Box";
    else if (app === "smarters") dispositivo = "iPhone/iPad";
    else if (app === "xcloud") dispositivo = "Smart TV";
    
    // Se chegou aqui, pode gerar o teste
    console.log(`Enviando requisição para API de testes...`);
    
    const postData = {
      appName: "com.whatsapp",
      messageDateTime: new Date().toISOString(),
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

    console.log(`Resposta da API recebida: ${JSON.stringify(response.data)}`);

    if (response.data) {
      const tempFilePath = "./temp_response.json";

      // Salva os dados retornados no arquivo JSON
      fs.writeFileSync(
        tempFilePath,
        JSON.stringify(response.data, null, 2),
        "utf8"
      );

      const { username, password } = response.data;

      if (username && password) {
        console.log(`Enviando credenciais para o usuário: ${username}`);
        
        // Registrar o teste no banco de dados
        await supabaseClient.registrarTesteUsuario(userId, app, dispositivo);
        
        // Envia os dados com a ordem baseada no valor de `app`
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
        
        // Após o teste, adicionar um lembrete sobre o tempo de bloqueio
        setTimeout(async () => {
          await msg.reply(
            '⚠️ *Lembrete importante:* Após este teste gratuito, você só poderá solicitar outro após 30 dias. ' +
            'Se gostar do serviço, recomendamos contratar um plano para acesso contínuo. Digite /planos para conhecer nossas opções.'
          );
        }, 15000); // 15 segundos após o envio das credenciais
        
      } else {
        console.error("API não retornou credenciais");
        await msg.reply(
          "⚠️ Não foi possível gerar teste. Por favor, aguarde alguns instantes e tente novamente."
        );
      }
      
      // Limpar arquivo temporário
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

module.exports = gerarTeste;