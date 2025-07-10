const fs = require('fs');
let ultimaAtividadeTempo = Date.now();
let respostasEnviadas = 0;

function obterDataBrasilia() {
  // Cria uma data UTC
  const dataUTC = new Date();
  
  // Obtém a string da data no fuso horário de Brasília
  const brasiliaString = dataUTC.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });
  
  // Converte a string formatada de volta para um objeto Date
  // Mas precisamos especificar que esta string está no formato brasileiro
  const [dia, mes, ano, ...resto] = brasiliaString.split(/[\/,\s:]+/);
  const [hora, minuto, segundo] = resto;
  
  // Criar a data usando os componentes extraídos
  return new Date(ano, mes - 1, dia, hora, minuto, segundo);
}

function registrarLog(mensagem, logFile = "./logs/bot.log") {
  const agora = obterDataBrasilia();
  const dataHora = `[${agora.toLocaleDateString('pt-BR')} - ${agora.toLocaleTimeString('pt-BR', { hour: "2-digit", minute: "2-digit" }).replace(":", "-")}]`;
  const logMensagem = `${dataHora} ${mensagem}\n`;
  fs.appendFileSync(logFile, logMensagem, "utf8");
}

async function isContactSaved(chatId, client) {
  try {
    if (!client) {
      console.error('Cliente WhatsApp não fornecido para isContactSaved');
      return false;
    }
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

async function responderComLog(msg, texto, userSessions, client) {
  try {
    // Obter a sessão atual do usuário antes de responder
    if (!userSessions) {
      console.error('userSessions não fornecido para responderComLog');
      await msg.reply(texto);
      return true;
    }
    
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
      if (!client) {
        console.error('Cliente WhatsApp não fornecido para método alternativo');
        return false;
      }
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

// Wrapper para compatibilidade com versões antigas (detecta dependência circular)
async function responderComLogCompat(msg, texto, userSessions, client) {
  // Se userSessions e client não foram fornecidos, tenta obter via require (compatibilidade)
  if (!userSessions || !client) {
    try {
      const botModule = require('./bot');
      return await responderComLog(msg, texto, botModule.userSessions, botModule.client);
    } catch (error) {
      console.warn('Não foi possível obter client/userSessions via require, usando versão básica');
      try {
        await msg.reply(texto);
        return true;
      } catch (err) {
        console.error('Erro ao enviar mensagem básica:', err);
        return false;
      }
    }
  }
  return await responderComLog(msg, texto, userSessions, client);
}

// Wrapper para compatibilidade com versões antigas
async function isContactSavedCompat(chatId, client) {
  // Se client não foi fornecido, tenta obter via require (compatibilidade)
  if (!client) {
    try {
      const botModule = require('./bot');
      return await isContactSaved(chatId, botModule.client);
    } catch (error) {
      console.warn('Não foi possível obter client via require, retornando false');
      return false;
    }
  }
  return await isContactSaved(chatId, client);
}

module.exports = {
  isContactSaved,
  responderComLog,
  isContactSavedCompat,
  responderComLogCompat,
  isNumeric,
  registrarLog,
  obterDataBrasilia
};