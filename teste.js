const readline = require('readline');
const { client, handleMessage } = require('./bot.js');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const usuarioTeste = `5511${Math.floor(10000000 + Math.random() * 90000000)}@c.us`;

console.log('=== BOT TESTE INTERATIVO ===');
console.log('Digite suas mensagens (Ctrl+C para sair)\n');

function enviarParaBot(mensagem) {
  const mensagemFake = {
    from: usuarioTeste,
    body: mensagem,
    reply: (resposta) => console.log('\n[BOT]:', resposta),
    getChat: () => ({ sendMessage: () => {} }),
    getContact: () => ({ pushname: "Usuário Teste" })
  };
  
  handleMessage(mensagemFake);
}

function aguardarMensagem() {
  rl.question('\n[VOCÊ]: ', (resposta) => {
    enviarParaBot(resposta);
    aguardarMensagem();
  });
}

// Inicia o cliente fake
client.initialize = () => {
  console.log('(Cliente de teste inicializado)');
  aguardarMensagem();
};

client.initialize();

rl.on('close', () => {
  console.log('\nTeste finalizado');
  process.exit(0);
});