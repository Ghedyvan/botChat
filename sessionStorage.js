const fs = require('fs');

// Caminho para o arquivo que armazenará as sessões
const sessionsFile = './userSessions.json';

// Converte o Map para um objeto que pode ser salvo em JSON
function mapToObject(map) {
  const obj = {};
  for (const [key, value] of map.entries()) {
    obj[key] = value;
  }
  return obj;
}

// Converte um objeto de volta para Map
function objectToMap(obj) {
  const map = new Map();
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      map.set(key, obj[key]);
    }
  }
  return map;
}

// Salva o Map de sessões em um arquivo JSON
function saveSessions(userSessions) {
  try {
    const sessionsObj = mapToObject(userSessions);
    fs.writeFileSync(sessionsFile, JSON.stringify(sessionsObj, null, 2), 'utf8');
    console.log('Sessões de usuários salvas com sucesso.');
  } catch (error) {
    console.error('Erro ao salvar as sessões de usuários:', error);
  }
}

// Carrega as sessões de um arquivo JSON para um Map
function loadSessions() {
  let userSessions = new Map();
  
  if (fs.existsSync(sessionsFile)) {
    try {
      const data = fs.readFileSync(sessionsFile, 'utf8');
      if (data) {
        const sessionsObj = JSON.parse(data);
        userSessions = objectToMap(sessionsObj);
        console.log('Sessões de usuários carregadas com sucesso.');
      }
    } catch (error) {
      console.error('Erro ao carregar as sessões de usuários:', error);
    }
  } else {
    console.log('Arquivo de sessões não encontrado. Criando um novo Map vazio.');
    saveSessions(userSessions); // Cria o arquivo vazio
  }
  
  return userSessions;
}

module.exports = {
  saveSessions,
  loadSessions
};