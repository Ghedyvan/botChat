let respostasEnviadas = 0;
let ultimaAtividadeTempo = Date.now();

/**
 * Verifica se um contato está salvo
 * @param {string} chatId - ID do chat no formato "XXXXXXXXXXXX@c.us"
 * @returns {Promise<boolean>} True se o contato estiver salvo
 */
async function isContactSaved(chatId) {
  try {
    const client = require('./bot').client;
    const contacts = await client.getContacts();
    const contact = contacts.find((c) => c.id._serialized === chatId);

    if (contact) {
      return contact.isMyContact; // Verifica se o contato está salvo
    }
    return false; 
  } catch (error) {
    console.error("Erro ao verificar se o contato está salvo:", error);
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
    require('./bot').registrarLog(logResposta);
    return true;
  } catch (error) {
    const erroResposta = `[ERRO AO ENVIAR] Para: ${msg.from}: ${error.message}`;
    console.error(erroResposta);
    require('./bot').registrarLog(erroResposta);
    
    // Tentar novamente com método alternativo
    try {
      const client = require('./bot').client;
      await client.sendMessage(msg.from, texto);
      console.log(`[RECUPERADO] Mensagem enviada usando método alternativo para: ${msg.from}`);
      require('./bot').registrarLog(`[RECUPERADO] Mensagem enviada usando método alternativo para: ${msg.from}`);
      respostasEnviadas++;
      return true;
    } catch (secondError) {
      console.error(`[FALHA TOTAL] Não foi possível enviar mensagem para: ${msg.from}`);
      require('./bot').registrarLog(`[FALHA TOTAL] Não foi possível enviar mensagem para: ${msg.from}`);
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
  isNumeric
};