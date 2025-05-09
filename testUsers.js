const fs = require('fs');

// Caminho para o arquivo que armazenará os usuários que já fizeram teste
const testeUsersFile = './testeUsers.json';

// Objeto para armazenar os dados
let testeUsers = {};

// Carrega os dados do arquivo JSON
function carregarTesteUsers() {
  if (fs.existsSync(testeUsersFile)) {
    try {
      const data = fs.readFileSync(testeUsersFile, 'utf8');
      testeUsers = data ? JSON.parse(data) : {};
    } catch (error) {
      console.error('Erro ao carregar o arquivo testeUsers.json:', error);
      testeUsers = {};
    }
  } else {
    console.log('Arquivo testeUsers.json não encontrado. Criando um novo arquivo.');
    salvarTesteUsers();
  }
  return testeUsers;
}

// Salva os dados no arquivo JSON
function salvarTesteUsers() {
  fs.writeFileSync(testeUsersFile, JSON.stringify(testeUsers, null, 2), 'utf8');
  console.log('Dados salvos em testeUsers.json');
}

// Verifica se um usuário já fez teste
function jaFezTeste(userId) {
  return testeUsers.hasOwnProperty(userId);
}

// Adiciona um usuário à lista de quem já fez teste
function adicionarUsuarioTeste(userId, app) {
  const agora = new Date();
  
  testeUsers[userId] = {
    dataHora: agora.toISOString(),
    app: app,
    ultimoTeste: agora.toISOString()
  };
  
  salvarTesteUsers();
}

// Atualiza informações de um usuário que já fez teste
function atualizarUsuarioTeste(userId, app) {
  const agora = new Date();
  
  if (testeUsers[userId]) {
    testeUsers[userId].ultimoTeste = agora.toISOString();
    testeUsers[userId].app = app;
  } else {
    adicionarUsuarioTeste(userId, app);
  }
  
  salvarTesteUsers();
}

// Lista todos os usuários que já fizeram teste
function listarUsuariosTeste() {
  return testeUsers;
}

// Carrega os dados ao inicializar
carregarTesteUsers();

module.exports = {
  jaFezTeste,
  adicionarUsuarioTeste,
  atualizarUsuarioTeste,
  listarUsuariosTeste,
  testeUsers
};