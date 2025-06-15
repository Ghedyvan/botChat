const puppeteer = require("puppeteer");
const moment = require("moment-timezone");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");

const browserManager = require("./browserManager");

async function getBrowserInstance() {
  return await browserManager.getBrowser("scrapper");
}

async function obterJogosParaWhatsApp() {
  const url =
    "https://trivela.com.br/onde-assistir/futebol-ao-vivo-os-jogos-de-hoje-na-tv/";
  const cacheFilePath = path.join(__dirname, "jogos_hoje.json");
  const dataHoje = moment().tz("America/Sao_Paulo").format("DD/MM/YYYY");

  console.log(`Buscando jogos para ${dataHoje}`);

  // Verifica se o cache existe e está atualizado
  if (fs.existsSync(cacheFilePath)) {
    try {
      const cacheContent = fs.readFileSync(cacheFilePath, "utf-8");
      if (cacheContent.trim()) {
        const cacheData = JSON.parse(cacheContent);

        // **CORREÇÃO**: Agora só usa o cache se ele for de hoje E se tiver jogos.
        if (
          cacheData.data === dataHoje &&
          Array.isArray(cacheData.jogos) &&
          cacheData.jogos.length > 0
        ) {
          console.log("Usando dados do cache, pois é válido e contém jogos.");

          // Filtra os jogos do cache com base no horário atual
          const agora = moment().tz("America/Sao_Paulo");
          const fimDoDia = moment().tz("America/Sao_Paulo").endOf("day");
          console.log("Horário atual:", agora.format("HH:mm"));
          console.log(`Total de jogos no cache: ${cacheData.jogos.length}`);

          const jogosFiltrados = cacheData.jogos.filter((jogo) => {
            const horarioJogo = moment(jogo.horario, "HH:mm").tz(
              "America/Sao_Paulo"
            );
            const incluir =
              horarioJogo.isAfter(agora.clone().subtract(2, "hours")) &&
              horarioJogo.isBefore(fimDoDia);

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
          console.log(
            "Cache inválido, de data diferente ou vazio. Fazendo novo scraping..."
          );
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

    // Configurar timeout e User-Agent específicos para scraping
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    );

    console.log(`Navegando para: ${url}`);
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    console.log("Página carregada, extraindo dados...");

    const jogos = await page.evaluate(() => {
      let tabela = document.querySelector(
        "figure:nth-of-type(1) table.large-only"
      );
      if (!tabela) tabela = document.querySelector("table.large-only");
      if (!tabela) tabela = document.querySelector("table");
      if (!tabela) return [];

      const linhas = tabela.querySelectorAll("tbody tr");
      const dados = [];

      linhas.forEach((linha) => {
        const colunas = linha.querySelectorAll("td");
        if (colunas.length >= 4) {
          const jogo = {
            horario: colunas[0].innerText.trim(),
            campeonato: colunas[1].innerText.trim(),
            jogo: colunas[2].innerText.trim(),
            transmissao: colunas[3].innerText.trim(),
          };
          dados.push(jogo);
        }
      });
      return dados;
    });

    await page.close();
    console.log(`Scraping concluído. ${jogos.length} jogos encontrados.`);

    if (!jogos || jogos.length === 0) {
      return "⚠️ Nenhum jogo encontrado no momento.";
    }

    const agora = moment().tz("America/Sao_Paulo");
    const fimDoDia = moment().tz("America/Sao_Paulo").endOf("day");
    const jogosFiltrados = jogos.filter((jogo) => {
      const horarioJogo = moment(jogo.horario, "HH:mm").tz("America/Sao_Paulo");
      return (
        horarioJogo.isAfter(agora.clone().subtract(2, "hours")) &&
        horarioJogo.isBefore(fimDoDia)
      );
    });

    console.log(`Jogos após filtro: ${jogosFiltrados.length}`);

    if (jogosFiltrados.length === 0) {
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

    fs.writeFileSync(
      cacheFilePath,
      JSON.stringify({ data: dataHoje, jogos }, null, 2),
      "utf-8"
    );

    console.log("Cache atualizado com sucesso.");
    return resposta;
  } catch (error) {
    console.error("Erro durante o scraping:", error);
    if (page)
      await page
        .close()
        .catch((e) => console.error("Erro ao fechar página:", e));
    return "⚠️ Ocorreu um erro ao buscar os jogos. Tente novamente mais tarde.";
  }
}

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

// --- PARA TESTE IMEDIATO ---
// Este bloco executa a função uma vez para teste direto no terminal.
// Para usar o bot em produção, comente (/* ... */) ou apague este bloco.
// (async () => {
//   console.log("Iniciando teste manual do script de scraping...");
//   const resultado = await obterJogosParaWhatsApp();
//   console.log("\n--- RESULTADO DO TESTE ---\n");
//   console.log(resultado);
//   console.log("\n--- FIM DO TESTE ---");
//   // O cron e o browser podem manter o processo aberto, então forçamos o encerramento.
//   process.exit(0);
// })();
