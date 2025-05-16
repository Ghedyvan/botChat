const fs = require('fs');
let ultimaAtividadeTempo = Date.now();

function obterDataBrasilia() {
  return new Date(new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }));
}

function registrarLog(mensagem, logFile = "./logs/bot.log") {
  const agora = obterDataBrasilia();
  const dataHora = `[${agora.toLocaleDateString('pt-BR')} - ${agora.toLocaleTimeString('pt-BR', { hour: "2-digit", minute: "2-digit" }).replace(":", "-")}]`;
  const logMensagem = `${dataHora} ${mensagem}\n`;
  fs.appendFileSync(logFile, logMensagem, "utf8");
}

async function isContactSaved(chatId) {
  try {
    const client = require('./bot').client;
    const contact = await client.getContactById(chatId);
    if (contact) {      
      return contact.name !== undefined || contact.isMyContact === true || (contact.pushname && contact.name);
    }
    return false;
  } catch (error) {
    console.error(`Erro ao verificar se o contato ${chatId} está salvo:`, error);
    registrarLog(`Erro ao verificar se o contato ${chatId} está salvo: ${error.message}`);
    return false;
  }
}

async function responderComLog(msg, texto) {
  try {
    // Obter a sessão atual do usuário antes de responder
    const { userSessions } = require('./bot');
    const chatId = msg.from;
    const sessao = userSessions.get(chatId);
    const etapaAtual = sessao ? sessao.step : "sem_sessao";
    
    await msg.reply(texto);
    respostasEnviadas++;
    ultimaAtividadeTempo = Date.now();
    global.respostasEnviadas = (global.respostasEnviadas || 0) + 1;
    
    const textoResumido = texto.length > 50 ? `${texto.substring(0, 50)}...` : texto;
    const logResposta = `[RESPOSTA ENVIADA] [${etapaAtual}] Para: ${msg.from} `;
    console.log(logResposta);
    registrarLog(logResposta);
    return true;
  } catch (error) {
    const erroResposta = `[ERRO AO ENVIAR] Para: ${msg.from}: ${error.message}`;
    console.error(erroResposta);
    registrarLog(erroResposta);
    try {
      const client = require('./bot').client;
      await client.sendMessage(msg.from, texto);
      console.log(`[RECUPERADO] Mensagem enviada usando método alternativo para: ${msg.from}`);
      registrarLog(`[RECUPERADO] Mensagem enviada usando método alternativo para: ${msg.from}`);
      respostasEnviadas++;
      return true;
    } catch (secondError) {
      console.error(`[FALHA TOTAL] Não foi possível enviar mensagem para: ${msg.from}`);
      registrarLog(`[FALHA TOTAL] Não foi possível enviar mensagem para: ${msg.from}`);
      return false;
    }
  }
}

function isNumeric(str) {
  return /^\d+$/.test(str);
}

module.exports = {
  isContactSaved,
  responderComLog,
  isNumeric,
  registrarLog,
  obterDataBrasilia
};