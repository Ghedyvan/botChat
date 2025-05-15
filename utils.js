const fs = require('fs');
let respostasEnviadas = 0;
let ultimaAtividadeTempo = Date.now();

// Log local para evitar importação circular
function registrarLog(mensagem, logFile = "./logs/bot.log") {
  const agora = new Date();
  const dataHora = `[${agora.toLocaleDateString("pt-BR")} - ${agora
    .toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    .replace(":", "-")}]`;
  const logMensagem = `${dataHora} ${mensagem}\n`;

  fs.appendFileSync(logFile, logMensagem, "utf8");
}

/**
 * Verifica se um contato está salvo
 * @param {string} chatId - ID do chat no formato "XXXXXXXXXXXX@c.us"
 * @returns {Promise<boolean>} True se o contato estiver salvo
 */
async function isContactSaved(chatId) {
  try {
    const client = require('./bot').client;
    
    // Obter o contato diretamente pelo ID
    const contact = await client.getContactById(chatId);
    
    // Verificar se o contato existe e está salvo
    if (contact) {
      // Log para depuração
      console.log(`[DEBUG] Verificando contato ${chatId}: 
        - Nome: ${contact.name || 'N/A'}
        - PushName: ${contact.pushname || 'N/A'} 
        - isMyContact: ${contact.isMyContact || false}`);
      
      // Verificação mais confiável usando nome do contato ou isMyContact
      return contact.name !== undefined || 
             contact.isMyContact === true || 
             (contact.pushname && contact.name);
    }
    
    return false; 
  } catch (error) {
    console.error(`Erro ao verificar se o contato ${chatId} está salvo:`, error);
    registrarLog(`Erro ao verificar se o contato ${chatId} está salvo: ${error.message}`);
    // Em caso de erro, é mais seguro assumir que não está salvo
    return false; 
  }
}

/**
 * Envia uma resposta ao usuário e registra no log
 * @param {Object} msg - Objeto de mensagem do WhatsApp
 * @param {string} texto - Texto a ser enviado
 * @returns {Promise<boolean>} True se bem-sucedido
 */
async function responderComLog(msg, texto) {
  try {
    await msg.reply(texto);
    respostasEnviadas++;
    ultimaAtividadeTempo = Date.now();

    const textoResumido = texto.length > 50 ? `${texto.substring(0, 50)}...` : texto;
    const logResposta = `[RESPOSTA ENVIADA] Para: ${msg.from}`;
    console.log(logResposta);
    registrarLog(logResposta);
    return true;
  } catch (error) {
    const erroResposta = `[ERRO AO ENVIAR] Para: ${msg.from}: ${error.message}`;
    console.error(erroResposta);
    registrarLog(erroResposta);
    
    // Tentar novamente com método alternativo
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

/**
 * Verifica se uma string é um número válido
 * @param {string} str - String a ser verificada
 * @returns {boolean} True se for um número
 */
function isNumeric(str) {
  return /^\d+$/.test(str);
}

module.exports = {
  isContactSaved,
  responderComLog,
  isNumeric,
  registrarLog
};