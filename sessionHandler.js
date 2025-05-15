const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, 'sessions.json');

/**
 * Carrega as sessões do arquivo
 * @returns {Array} Um array de sessões no formato [id, dados]
 */
function loadSessions() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const data = fs.readFileSync(SESSION_FILE, 'utf8');
      return JSON.parse(data);
    }
    return [];
  } catch (error) {
    console.error('Erro ao carregar sessões:', error);
    return [];
  }
}

/**
 * Salva as sessões em um arquivo
 * @param {Map} sessions - Mapa de sessões
 * @param {string} filePath - Caminho do arquivo (opcional)
 * @returns {boolean} True se for bem-sucedido
 */
function saveSessions(sessions, filePath = SESSION_FILE) {
  try {
    const data = JSON.stringify([...sessions]);
    fs.writeFileSync(filePath, data, 'utf8');
    return true;
  } catch (error) {
    console.error('Erro ao salvar sessões:', error);
    return false;
  }
}

module.exports = {
  loadSessions,
  saveSessions
};