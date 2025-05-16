const { createClient } = require('@supabase/supabase-js');
const { obterDataBrasilia } = require('./utils');

// Configurações do Supabase
const supabaseUrl = 'https://htnshycvsxfwebsjatbi.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0bnNoeWN2c3hmd2Vic2phdGJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcyODIyNTIsImV4cCI6MjA2Mjg1ODI1Mn0.hryjkz90pKzAO1UV1bSB1K1CGF_Pyt6s6dx59RpUZxo';

// Criar cliente Supabase
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Inicializa as tabelas necessárias no Supabase (executar apenas uma vez)
 * Obs: A criação de tabelas é melhor feita diretamente na interface do Supabase
 */
async function inicializarSupabase() {
  console.log('Verificando conexão com Supabase...');
  
  try {
    const { data, error } = await supabase.from('indicacoes').select('count');
    
    if (error) throw error;
    
    console.log('Conexão com Supabase estabelecida com sucesso!');
    return true;
  } catch (error) {
    console.error('Erro ao conectar com Supabase:', error.message);
    return false;
  }
}

/**
 * Obter todas as indicações
 * @returns {Promise<Array>} Lista de indicações
 */
async function getAllIndicacoes() {
  const { data, error } = await supabase
    .from('indicacoes')
    .select('*')
    .order('quantidade', { ascending: false });
    
  if (error) {
    console.error('Erro ao buscar indicações:', error);
    return [];
  }
  
  return data || [];
}

/**
 * Obter indicações de um número específico
 * @param {string} numero - Número do WhatsApp com sufixo @c.us
 * @returns {Promise<Object|null>} Dados da indicação ou null
 */
async function getIndicacoesByNumero(numero) {
  const { data, error } = await supabase
    .from('indicacoes')
    .select('*')
    .eq('numero', numero)
    .single();
    
  if (error) {
    // Se for erro 'não encontrado', retornamos null sem log de erro
    if (error.code === 'PGRST116') return null;
    
    console.error('Erro ao buscar indicação:', error);
    return null;
  }
  
  return data;
}

/**
 * Incrementar indicação de um usuário
 * @param {string} numero - Número do WhatsApp com sufixo @c.us
 * @param {string} nome - Nome do contato
 * @returns {Promise<Object|null>} Dados atualizados da indicação
 */
async function incrementIndicacao(numero, nome) {
  const indicacao = await getIndicacoesByNumero(numero);
  
  if (indicacao) {
    const { data, error } = await supabase
      .from('indicacoes')
      .update({ 
        quantidade: indicacao.quantidade + 1, 
        nome: nome,
        data_atualizacao: obterDataBrasilia().toISOString()
      })
      .eq('numero', numero)
      .select()
      .single();
      
    if (error) {
      console.error('Erro ao incrementar indicação:', error);
      return null;
    }
    
    return data;
  } else {
    const { data, error } = await supabase
      .from('indicacoes')
      .insert([
        { 
          numero, 
          nome, 
          quantidade: 1,
          data_criacao: obterDataBrasilia().toISOString(),
          data_atualizacao: obterDataBrasilia().toISOString()
        }
      ])
      .select()
      .single();
      
    if (error) {
      console.error('Erro ao criar indicação:', error);
      return null;
    }
    
    return data;
  }
}

/**
 * Ajustar quantidade de indicações manualmente
 * @param {string} numero - Número do WhatsApp com sufixo @c.us
 * @param {string} nome - Nome do contato
 * @param {number} quantidade - Nova quantidade de indicações
 * @returns {Promise<Object|null>} Dados atualizados da indicação
 */
async function ajustarIndicacao(numero, nome, quantidade) {
  const indicacao = await getIndicacoesByNumero(numero);
  
  if (indicacao) {
    // Atualiza registro existente
    const { data, error } = await supabase
      .from('indicacoes')
      .update({ 
        quantidade: quantidade, 
        nome: nome,
        data_atualizacao: new Date().toISOString()
      })
      .eq('numero', numero)
      .select()
      .single();
      
    if (error) {
      console.error('Erro ao ajustar indicação:', error);
      return null;
    }
    
    return data;
  } else {
    // Cria novo registro
    const { data, error } = await supabase
      .from('indicacoes')
      .insert([
        { 
          numero, 
          nome, 
          quantidade,
          data_criacao: new Date().toISOString(),
          data_atualizacao: new Date().toISOString()
        }
      ])
      .select()
      .single();
      
    if (error) {
      console.error('Erro ao criar indicação:', error);
      return null;
    }
    
    return data;
  }
}

/**
 * Migra dados de JSON para o Supabase
 * @param {string} jsonPath - Caminho para o arquivo JSON
 * @returns {Promise<boolean>} Sucesso da migração
 */
async function migrarDoJSON(jsonPath) {
  try {
    const fs = require('fs');
    
    if (!fs.existsSync(jsonPath)) {
      console.log('Arquivo JSON não encontrado. Nada para migrar.');
      return false;
    }
    
    const rawData = fs.readFileSync(jsonPath, 'utf8');
    const indicacoes = JSON.parse(rawData);
    
    // Preparar dados para inserção
    const dadosParaInserir = [];
    
    for (const [numero, dados] of Object.entries(indicacoes)) {
      dadosParaInserir.push({
        numero: numero,
        nome: dados.nome || 'Desconhecido',
        quantidade: dados.indicacoes,
        data_criacao: new Date().toISOString(),
        data_atualizacao: new Date().toISOString()
      });
    }
    
    if (dadosParaInserir.length === 0) {
      console.log('Nenhum dado para migrar.');
      return true;
    }
    
    // Inserir em lotes de 100 para evitar problemas com limites da API
    for (let i = 0; i < dadosParaInserir.length; i += 100) {
      const lote = dadosParaInserir.slice(i, i + 100);
      
      const { data, error } = await supabase
        .from('indicacoes')
        .upsert(lote, {
          onConflict: 'numero',
          ignoreDuplicates: false
        });
        
      if (error) {
        console.error(`Erro ao migrar lote ${i/100 + 1}:`, error);
      }
    }
    
    console.log(`Migração concluída: ${dadosParaInserir.length} registros processados.`);
    return true;
  } catch (error) {
    console.error('Erro durante migração:', error);
    return false;
  }
}

/**
 * Obter uma sessão do Supabase pelo número
 * @param {string} numero - Número do WhatsApp com sufixo @c.us
 * @returns {Promise<Object|null>} Dados da sessão ou null
 */
async function getSessaoByNumero(numero) {
  try {
    const { data, error } = await supabase
      .from('sessoes')
      .select('*')
      .eq('numero', numero)
      .single();
      
    if (error) {
      // Se for erro de 'não encontrado', retorna null silenciosamente
      if (error.code === 'PGRST116') return null;
      
      console.error('Erro ao buscar sessão:', error);
      return null;
    }
    
    return data;
  } catch (error) {
    console.error(`Erro ao buscar sessão ${numero}:`, error);
    return null;
  }
}

/**
 * Salvar ou atualizar uma sessão no Supabase
 * @param {string} numero - Número do WhatsApp com sufixo @c.us
 * @param {Object} sessao - Dados da sessão
 * @returns {Promise<boolean>} Sucesso da operação
 */
async function salvarSessao(numero, sessao) {
  try {
    const { error } = await supabase
      .from('sessoes')
      .upsert({
        numero,
        step: sessao.step || 'menu',
        timestamp: sessao.timestamp ? new Date(sessao.timestamp).toISOString() : obterDataBrasilia().toISOString(),
        invalidCount: sessao.invalidCount || 0,
        naoNumericaConsecutivas: sessao.naoNumericaConsecutivas || 0,
        planoSelecionado: sessao.planoSelecionado || null,
        valorPlano: sessao.valorPlano || null,
        metodoPagamento: sessao.metodoPagamento || null,
        ultima_atualizacao: obterDataBrasilia().toISOString()
      }, {
        onConflict: 'numero'
      });
      
    return !error;
  } catch (error) {
    console.error(`Erro ao salvar sessão ${numero}:`, error);
    return false;
  }
}

/**
 * Carregar todas as sessões do Supabase
 * @returns {Promise<Map>} Mapa de sessões
 */
async function carregarSessoes() {
  try {
    const { data, error } = await supabase
      .from('sessoes')
      .select('*');
      
    if (error) {
      console.error('Erro ao carregar sessões:', error);
      return new Map();
    }
    
    const sessions = new Map();
    
    for (const sessao of data) {
      sessions.set(sessao.numero, {
        step: sessao.step || 'menu',
        timestamp: new Date(sessao.timestamp).getTime(),
        invalidCount: sessao.invalidCount || 0,
        naoNumericaConsecutivas: sessao.naoNumericaConsecutivas || 0,
        planoSelecionado: sessao.planoSelecionado,
        valorPlano: sessao.valorPlano,
        metodoPagamento: sessao.metodoPagamento
      });
    }
    
    console.log(`${sessions.size} sessões carregadas do Supabase`);
    return sessions;
  } catch (error) {
    console.error('Erro ao carregar sessões do Supabase:', error);
    return new Map();
  }
}

/**
 * Remover uma sessão do Supabase
 * @param {string} numero - Número do WhatsApp
 * @returns {Promise<boolean>} Sucesso da operação
 */
async function removerSessao(numero) {
  try {
    const { error } = await supabase
      .from('sessoes')
      .delete()
      .eq('numero', numero);
      
    return !error;
  } catch (error) {
    console.error(`Erro ao remover sessão ${numero}:`, error);
    return false;
  }
}

/**
 * Registrar log no Supabase
 * @param {string} nivel - Nível do log (INFO, WARN, ERROR)
 * @param {string} mensagem - Mensagem de log
 * @param {string} origem - Origem do log (função ou módulo)
 * @param {string} numero - Número do WhatsApp relacionado (opcional)
 * @returns {Promise<boolean>} Sucesso da operação
 */
async function registrarLog(nivel, mensagem, origem = null, numero = null) {
  try {
    const agora = obterDataBrasilia();
    const dataHoraFormatada = `[${agora.toLocaleDateString("pt-BR")} - ${agora.toLocaleTimeString("pt-BR")}]`;
    console.log(`${dataHoraFormatada} [${nivel}] ${mensagem}`);
    
    const { error } = await supabase
      .from('logs')
      .insert([{
        nivel,
        mensagem,
        origem,
        numero,
        data_hora: agora.toISOString()
      }]);
      
    if (error) {
      console.error('Erro ao salvar log no Supabase:', error);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Erro ao registrar log:', error);
    return false;
  }
}

/**
 * Consultar logs por período
 * @param {Date} dataInicio - Data inicial
 * @param {Date} dataFim - Data final
 * @param {string} nivel - Nível do log (opcional)
 * @param {number} limite - Limite de registros
 * @returns {Promise<Array>} Registros de log
 */
async function consultarLogs(dataInicio, dataFim, nivel = null, limite = 100) {
  try {
    let query = supabase
      .from('logs')
      .select('*')
      .gte('data_hora', dataInicio.toISOString())
      .lte('data_hora', dataFim.toISOString())
      .order('data_hora', { ascending: false })
      .limit(limite);
      
    if (nivel) {
      query = query.eq('nivel', nivel);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Erro ao consultar logs:', error);
      return [];
    }
    
    return data || [];
  } catch (error) {
    console.error('Erro ao consultar logs:', error);
    return [];
  }
}

/**
 * Consultar logs por número de WhatsApp
 * @param {string} numero - Número do WhatsApp
 * @param {number} limite - Limite de registros
 * @returns {Promise<Array>} Registros de log
 */
async function consultarLogsPorNumero(numero, limite = 50) {
  try {
    const { data, error } = await supabase
      .from('logs')
      .select('*')
      .eq('numero', numero)
      .order('data_hora', { ascending: false })
      .limit(limite);
      
    if (error) {
      console.error('Erro ao consultar logs por número:', error);
      return [];
    }
    
    return data || [];
  } catch (error) {
    console.error('Erro ao consultar logs por número:', error);
    return [];
  }
}

/**
 * Verificar se o usuário já fez teste e está bloqueado
 * @param {string} numero - Número do WhatsApp com sufixo @c.us
 * @returns {Promise<Object|null>} Dados do usuário ou null se nunca fez teste
 */
async function verificarTesteUsuario(numero) {
  try {
    const { data, error } = await supabase
      .from('testes_usuarios')
      .select('*')
      .eq('numero', numero)
      .single();
      
    if (error) {
      // Se for erro de 'não encontrado', significa que nunca fez teste
      if (error.code === 'PGRST116') return null;
      console.error('Erro ao verificar teste de usuário:', error);
      return null;
    }
    
    return data;
  } catch (error) {
    console.error(`Erro ao verificar teste para ${numero}:`, error);
    return null;
  }
}

/**
 * Registrar novo teste para usuário
 * @param {string} numero - Número do WhatsApp
 * @param {string} app - Aplicativo utilizado
 * @param {string} dispositivo - Tipo de dispositivo
 * @returns {Promise<boolean>} Sucesso da operação
 */
async function registrarTesteUsuario(numero, app, dispositivo) {
  try {
    const testeExistente = await verificarTesteUsuario(numero);
    
    if (testeExistente) {
      const { error } = await supabase
        .from('testes_usuarios')
        .update({
          app_utilizado: app,
          dispositivo: dispositivo,
          quantidade_testes: testeExistente.quantidade_testes + 1,
          data_teste: obterDataBrasilia().toISOString(),
          ultima_atualizacao: obterDataBrasilia().toISOString()
        })
        .eq('numero', numero);
        
      return !error;
    } else {
      const dataDesbloqueio = obterDataBrasilia();
      dataDesbloqueio.setDate(dataDesbloqueio.getDate() + 30); // 30 dias no futuro
      
      const { error } = await supabase
        .from('testes_usuarios')
        .insert({
          numero,
          app_utilizado: app,
          dispositivo: dispositivo,
          quantidade_testes: 1,
          data_desbloqueio: dataDesbloqueio.toISOString()
        });
        
      return !error;
    }
  } catch (error) {
    console.error(`Erro ao registrar teste para ${numero}:`, error);
    return false;
  }
}

/**
 * Verificar se usuário pode fazer teste
 * @param {string} numero - Número do WhatsApp
 * @returns {Promise<Object>} Resultado da verificação
 */
async function podeRealizarTeste(numero) {
  try {
    const teste = await verificarTesteUsuario(numero);
    
    if (!teste) {
      return { 
        permitido: true,
        motivo: "Primeiro teste" 
      };
    }
    
    const agora = obterDataBrasilia();
    const dataDesbloqueio = new Date(teste.data_desbloqueio);
    
    if (teste.bloqueado && agora < dataDesbloqueio) {
      const diasRestantes = Math.ceil((dataDesbloqueio - agora) / (1000 * 60 * 60 * 24));
      return {
        permitido: false,
        motivo: "Período de bloqueio",
        diasRestantes,
        dataDesbloqueio: teste.data_desbloqueio
      };
    }
    
    return { 
      permitido: true, 
      motivo: "Período de bloqueio encerrado",
      testeAnterior: {
        app: teste.app_utilizado,
        dispositivo: teste.dispositivo,
        quantidade: teste.quantidade_testes,
        dataUltimoTeste: teste.data_teste
      }
    };
  } catch (error) {
    console.error(`Erro ao verificar disponibilidade de teste para ${numero}:`, error);
    return { permitido: true, motivo: "Erro na verificação" };
  }
}



module.exports = {
  inicializarSupabase,
  getAllIndicacoes,
  getIndicacoesByNumero,
  incrementIndicacao,
  ajustarIndicacao,
  migrarDoJSON,
  getSessaoByNumero,
  salvarSessao,
  carregarSessoes,
  removerSessao,
  registrarLog,
  consultarLogs,
  consultarLogsPorNumero,
  verificarTesteUsuario,
  registrarTesteUsuario,
  podeRealizarTeste
};