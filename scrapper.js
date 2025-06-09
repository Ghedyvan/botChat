const puppeteer = require("puppeteer");
const moment = require("moment-timezone");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");

let browserInstance = null;

async function getBrowserInstance() {
  if (!browserInstance || browserInstance.disconnected) {
    try {
      browserInstance = await puppeteer.launch({
        headless: true,
        executablePath: "/usr/bin/chromium-browser",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--single-process",
          "--no-zygote",
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--max-old-space-size=256",
          `--user-data-dir=/tmp/chromium-scrapper-${process.pid}`, 
          "--no-first-run",
          "--disable-extensions",
          "--disable-web-security",
          "--disable-features=VizDisplayCompositor"
        ],
      });
      console.log("Browser instance criada com sucesso");
    } catch (error) {
      console.error("Erro ao criar browser instance:", error);
      throw error;
    }
  }
  return browserInstance;
}

async function obterJogosParaWhatsApp() {
  const url = "https://trivela.com.br/onde-assistir/futebol-ao-vivo-os-jogos-de-hoje-na-tv/";
  const cacheFilePath = path.join(__dirname, "jogos_hoje.json");
  const dataHoje = moment().tz("America/Sao_Paulo").format("DD/MM/YYYY");

  console.log(`Buscando jogos para ${dataHoje}`);

  // Verifica se o cache existe e está atualizado
  if (fs.existsSync(cacheFilePath)) {
    try {
      const cacheContent = fs.readFileSync(cacheFilePath, "utf-8");
      if (cacheContent.trim()) {
        const cacheData = JSON.parse(cacheContent);
  
        // Verifica se a data do cache é a mesma de hoje
        if (cacheData.data === dataHoje && Array.isArray(cacheData.jogos)) {
          console.log("Usando dados do cache.");
        
          // Filtra os jogos do cache com base no horário atual
          const agora = moment().tz("America/Sao_Paulo");
          const fimDoDia = moment().tz("America/Sao_Paulo").endOf("day");
          console.log("Horário atual:", agora.format("HH:mm"));
          console.log("Data de hoje:", dataHoje);
          console.log(`Total de jogos no cache: ${cacheData.jogos.length}`);
        
          const jogosFiltrados = cacheData.jogos.filter((jogo) => {
            const horarioJogo = moment(jogo.horario, "HH:mm").tz("America/Sao_Paulo");
            const incluir = horarioJogo.isAfter(agora.clone().subtract(2, "hours")) && 
                           horarioJogo.isBefore(fimDoDia);
            
            console.log(`Jogo: ${jogo.jogo} (${jogo.horario}) - ${incluir ? 'Incluído' : 'Filtrado'}`);
            return incluir;
          });
        
          console.log(`Jogos filtrados: ${jogosFiltrados.length}`);
        
          if (jogosFiltrados.length === 0) {
            return "⚠️ Nenhum jogo começou há no máximo 2 horas ou está programado para hoje.";
          }
        
          // Formata a resposta com os jogos filtrados
          let resposta = `⚽ *Jogos de hoje (${dataHoje})*\n\n`;
          jogosFiltrados.forEach((jogo) => {
            resposta += `*${jogo.jogo}*\n`;
            resposta += `⏰ ${jogo.horario} - 🏆 ${jogo.campeonato}\n`;
            resposta += `📺 ${jogo.transmissao}\n\n`;
          });
        
          return resposta.trim();
        } else {
          console.log("Cache inválido ou de data diferente. Fazendo novo scraping...");
        }
      }
    } catch (error) {
      console.error("Erro ao ler o cache:", error);
    }
  } else {
    console.log("Cache não existe. Fazendo novo scraping...");
  }

  // Se chegou aqui, precisa fazer scraping
  let browser = null;
  let page = null;

  try {
    console.log("Iniciando scraping...");
    browser = await getBrowserInstance();
    page = await browser.newPage();
    
    // Adicionar user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    console.log(`Navegando para: ${url}`);
    await page.goto(url, { 
      waitUntil: "domcontentloaded",
      timeout: 30000 
    });

    console.log("Página carregada, extraindo dados...");

    const jogos = await page.evaluate(() => {
      console.log("Executando evaluate no browser...");
      
      // Tentar diferentes seletores
      let tabela = document.querySelector("figure:nth-of-type(1) table.large-only");
      
      if (!tabela) {
        tabela = document.querySelector("table.large-only");
      }
      
      if (!tabela) {
        tabela = document.querySelector("table");
      }
      
      console.log("Tabela encontrada:", !!tabela);
      
      if (!tabela) return [];

      const linhas = tabela.querySelectorAll("tbody tr");
      console.log("Número de linhas encontradas:", linhas.length);
      
      const dados = [];

      linhas.forEach((linha, index) => {
        const colunas = linha.querySelectorAll("td");
        console.log(`Linha ${index}: ${colunas.length} colunas`);
        
        if (colunas.length >= 4) {
          const jogo = {
            horario: colunas[0].innerText.trim(),
            campeonato: colunas[1].innerText.trim(),
            jogo: colunas[2].innerText.trim(),
            transmissao: colunas[3].innerText.trim(),
          };
          console.log(`Jogo extraído:`, jogo);
          dados.push(jogo);
        }
      });

      console.log("Total de jogos extraídos:", dados.length);
      return dados;
    });

    await page.close();
    console.log(`Scraping concluído. ${jogos.length} jogos encontrados.`);

    if (!jogos || jogos.length === 0) {
      console.log("Nenhum jogo encontrado no scraping");
      return "⚠️ Nenhum jogo encontrado no momento.";
    }

    // Filtra os jogos que começaram há no máximo 2 horas ou que ainda vão acontecer até 23:59
    const agora = moment().tz("America/Sao_Paulo");
    console.log("Horário atual:", agora.format("HH:mm"));
    console.log("Data de hoje:", dataHoje);
    
    const fimDoDia = moment().tz("America/Sao_Paulo").endOf("day");
    const jogosFiltrados = jogos.filter((jogo) => {
      const horarioJogo = moment(jogo.horario, "HH:mm").tz("America/Sao_Paulo");
      const incluir = horarioJogo.isAfter(agora.clone().subtract(2, "hours")) &&
                     horarioJogo.isBefore(fimDoDia);
      
      console.log(`Filtro: ${jogo.jogo} (${jogo.horario}) - ${incluir ? 'Incluído' : 'Filtrado'}`);
      return incluir;
    });

    console.log(`Jogos após filtro: ${jogosFiltrados.length}`);

    if (jogosFiltrados.length === 0) {
      // Salvar o cache mesmo sem jogos filtrados
      fs.writeFileSync(
        cacheFilePath,
        JSON.stringify({ data: dataHoje, jogos }, null, 2),
        "utf-8"
      );
      
      return "⚠️ Nenhum jogo começou há no máximo 2 horas ou está programado para hoje.";
    }

    let resposta = `⚽ *Jogos de hoje (${dataHoje})*\n\n`;

    jogosFiltrados.forEach((jogo) => {
      resposta += `*${jogo.jogo}*\n`;
      resposta += `⏰ ${jogo.horario} - 🏆 ${jogo.campeonato}\n`;
      resposta += `📺 ${jogo.transmissao}\n\n`;
    });

    resposta = resposta.trim();

    // Salva os dados no arquivo de cache
    fs.writeFileSync(
      cacheFilePath,
      JSON.stringify({ data: dataHoje, jogos }, null, 2),
      "utf-8"
    );

    console.log("Cache atualizado com sucesso.");
    return resposta;
    
  } catch (error) {
    console.error("Erro durante o scraping:", error);
    
    if (page) {
      try {
        await page.close();
      } catch (e) {
        console.error("Erro ao fechar página:", e);
      }
    }
    
    return "⚠️ Ocorreu um erro ao buscar os jogos. Tente novamente mais tarde.";
  }
}

// Agendamento para executar a função todos os dias às 7h20 da manhã no timezone de São Paulo
cron.schedule(
  "20 7 * * *",
  async () => {
    console.log("Executando scraping agendado às 7h20...");
    try {
      await obterJogosParaWhatsApp();
    } catch (error) {
      console.error("Erro no scraping agendado:", error);
    }
  },
  {
    timezone: "America/Sao_Paulo",
  }
);

module.exports = { obterJogosParaWhatsApp };