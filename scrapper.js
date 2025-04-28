const puppeteer = require("puppeteer");
const moment = require("moment-timezone");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");

async function obterJogosParaWhatsApp() {
  const url =
    "https://trivela.com.br/onde-assistir/futebol-ao-vivo-os-jogos-de-hoje-na-tv/";
  const cacheFilePath = path.join(__dirname, "jogos_hoje.json");
  const dataHoje = moment().tz("America/Sao_Paulo").format("DD/MM/YYYY");

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
        
          const jogosFiltrados = cacheData.jogos.filter((jogo) => {
            const horarioJogo = moment(jogo.horario, "HH:mm").tz("America/Sao_Paulo");
            return (
              horarioJogo.isAfter(agora.clone().subtract(2, "hours")) && // Inclui jogos que começaram há no máximo 2 horas
              horarioJogo.isBefore(fimDoDia) // Inclui jogos que ainda vão acontecer até o fim do dia
            );
          });
        
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
          console.error("Cache inválido ou corrompido. Recriando o arquivo...");
        }
      }
    } catch (error) {
      console.error("Erro ao ler o cache. Recriando o arquivo...", error);
    }
  }

  // Se o cache não existir ou estiver desatualizado, recria o cache
  // const browser = await puppeteer.launch({ headless: true });

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: "/usr/bin/chromium-browser", // Caminho do executável do Chromium
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--single-process",
      "--no-zygote",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--max-old-space-size=256",
    ],
  });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });

    const jogos = await page.evaluate(() => {
      const tabela = document.querySelector(
        "figure:nth-of-type(1) table.large-only"
      );
      if (!tabela) return [];

      const linhas = tabela.querySelectorAll("tbody tr");
      const dados = [];

      linhas.forEach((linha) => {
        const colunas = linha.querySelectorAll("td");
        if (colunas.length >= 4) {
          dados.push({
            horario: colunas[0].innerText.trim(),
            campeonato: colunas[1].innerText.trim(),
            jogo: colunas[2].innerText.trim(),
            transmissao: colunas[3].innerText.trim(),
          });
        }
      });

      return dados;
    });

    await browser.close();

    if (!jogos || jogos.length === 0) {
      return "⚠️ Nenhum jogo encontrado no momento.";
    }

    // Filtra os jogos que começaram há no máximo 2 horas ou que ainda vão acontecer até 23:59
    const agora = moment().tz("America/Sao_Paulo");
    console.log("Horário atual:", agora.format("HH:mm"));
    console.log("Data de hoje:", dataHoje);
    const fimDoDia = moment().tz("America/Sao_Paulo").endOf("day");
    const jogosFiltrados = jogos.filter((jogo) => {
      const horarioJogo = moment(jogo.horario, "HH:mm").tz("America/Sao_Paulo");
      return (
        horarioJogo.isAfter(agora.clone().subtract(2, "hours")) &&
        horarioJogo.isBefore(fimDoDia)
      );
    });

    if (jogosFiltrados.length === 0) {
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
    await browser.close();
    console.error("Erro ao obter jogos:", error);
    return "⚠️ Ocorreu um erro ao buscar os jogos. Tente novamente mais tarde.";
  }
}

// Agendamento para executar a função todos os dias às 7h20 da manhã no timezone de São Paulo
cron.schedule(
  "20 7 * * *",
  async () => {
    console.log(
      "Executando scraping para atualizar o cache às 7h20 no timezone de São Paulo..."
    );
    await obterJogosParaWhatsApp();
  },
  {
    timezone: "America/Sao_Paulo", // Define o timezone explicitamente
  }
);

module.exports = { obterJogosParaWhatsApp };