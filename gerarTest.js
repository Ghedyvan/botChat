const axios = require("axios");
const fs = require("fs");

async function gerarTeste(msg, app) {
  try {
    const postData = {
      appName: "com.whatsapp",
      messageDateTime: new Date().toISOString(),
      devicePhone: "",
      deviceName: "",
      senderName: msg._data.notifyName || "Nome Desconhecido",
      senderMessage: msg.body,
      userAgent: "BotBot.Chat",
    };

    const response = await axios.post(
      "https://goldplay.sigma.st/api/chatbot/mVLl9vYDQw/rlKWO3Wzo7",
      postData
    );

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
      } else {
        await msg.reply(
          "⚠️ A API não retornou os campos 'username' e 'password'."
        );
      }
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } else {
      await msg.reply("⚠️ A API não retornou dados.");
    }
  } catch (error) {
    console.error("Erro ao fazer a requisição para a API:", error);
    await msg.reply("⚠️ Ocorreu um erro ao tentar obter as informações.");
  }
}

module.exports = gerarTeste;
