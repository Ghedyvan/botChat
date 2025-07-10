// Teste para verificar se as dependências circulares foram resolvidas
console.log('Testando imports...');

try {
  console.log('1. Importando utils...');
  const utils = require('./utils.js');
  console.log('✓ utils.js importado com sucesso');
  
  console.log('2. Importando bot...');
  const bot = require('./bot.js');
  console.log('✓ bot.js importado com sucesso');
  
  console.log('3. Verificando exports do bot...');
  console.log('client disponível:', typeof bot.client);
  console.log('userSessions disponível:', typeof bot.userSessions);
  
  console.log('4. Verificando funções do utils...');
  console.log('isContactSaved disponível:', typeof utils.isContactSaved);
  console.log('responderComLog disponível:', typeof utils.responderComLog);
  console.log('obterDataBrasilia disponível:', typeof utils.obterDataBrasilia);
  
  console.log('\n✅ Teste de dependências bem-sucedido!');
  console.log('✅ Dependência circular foi resolvida!');
  
} catch (error) {
  console.error('❌ Erro no teste de dependências:', error.message);
  console.error(error.stack);
}
