const { createClient } = require('@supabase/supabase-js');

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
  // Verifica se o registro já existe
  const indicacao = await getIndicacoesByNumero(numero);
  
  if (indicacao) {
    // Atualiza registro existente
    const { data, error } = await supabase
      .from('indicacoes')
      .update({ 
        quantidade: indicacao.quantidade + 1, 
        nome: nome,
        data_atualizacao: new Date().toISOString()
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
    // Cria novo registro
    const { data, error } = await supabase
      .from('indicacoes')
      .insert([
        { 
          numero, 
          nome, 
          quantidade: 1,
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

module.exports = {
  inicializarSupabase,
  getAllIndicacoes,
  getIndicacoesByNumero,
  incrementIndicacao,
  ajustarIndicacao,
  migrarDoJSON
};