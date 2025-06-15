const puppeteer = require('puppeteer');

class BrowserManager {
  constructor() {
    this.browsers = new Map();
    this.maxBrowsers = 2;
    this.browserTimeouts = new Map(); // Para cleanup automático
  }

  async getBrowser(purpose = 'default') {
    // Limpar timeout anterior se existir
    if (this.browserTimeouts.has(purpose)) {
      clearTimeout(this.browserTimeouts.get(purpose));
    }

    if (this.browsers.has(purpose)) {
      const browser = this.browsers.get(purpose);
      if (!browser.disconnected) {
        // Verificar se ainda está funcionando
        try {
          await browser.version(); // Teste rápido de conectividade
          this.setupBrowserTimeout(purpose); // Renovar timeout
          return browser;
        } catch (error) {
          console.log(`Browser ${purpose} não responsivo, criando novo...`);
          this.browsers.delete(purpose);
        }
      } else {
        this.browsers.delete(purpose);
      }
    }

    if (this.browsers.size >= this.maxBrowsers) {
      const [oldestKey] = this.browsers.keys();
      await this.closeBrowser(oldestKey);
    }

    const browser = await this.createBrowser(purpose);
    this.browsers.set(purpose, browser);
    this.setupBrowserTimeout(purpose);
    return browser;
  }

  async createBrowser(purpose) {
    const basePort = purpose === 'scrapper' ? 9223 : 9222;
    
    return await puppeteer.launch({
      headless: true,
      executablePath: "/usr/bin/chromium-browser",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--single-process",
        "--no-zygote",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--disable-extensions",
        "--disable-component-extensions-with-background-pages",
        "--disable-backgrounding-occluded-windows",
        "--max-old-space-size=512",
        "--disable-features=VizDisplayCompositor",
        // Separar diretórios por propósito
        `--user-data-dir=/tmp/${purpose}-browser-session`,
        `--remote-debugging-port=${basePort}`,
      ],
      defaultViewport: null,
    });
  }

  setupBrowserTimeout(purpose) {
    // Auto-cleanup após 30 minutos de inatividade para scrapper
    if (purpose === 'scrapper') {
      const timeout = setTimeout(async () => {
        console.log(`Fechando browser ${purpose} por inatividade`);
        await this.closeBrowser(purpose);
      }, 30 * 60 * 1000); // 30 minutos

      this.browserTimeouts.set(purpose, timeout);
    }
  }

  async closeBrowser(purpose) {
    // Limpar timeout
    if (this.browserTimeouts.has(purpose)) {
      clearTimeout(this.browserTimeouts.get(purpose));
      this.browserTimeouts.delete(purpose);
    }

    if (this.browsers.has(purpose)) {
      const browser = this.browsers.get(purpose);
      try {
        await browser.close();
        console.log(`Browser ${purpose} fechado com sucesso`);
      } catch (error) {
        console.error(`Erro ao fechar browser ${purpose}:`, error);
      }
      this.browsers.delete(purpose);
    }
  }

  async closeAllBrowsers() {
    console.log('Fechando todos os browsers...');
    
    // Limpar todos os timeouts
    for (const timeout of this.browserTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.browserTimeouts.clear();

    // Fechar todos os browsers
    const closePromises = [];
    for (const [purpose] of this.browsers) {
      closePromises.push(this.closeBrowser(purpose));
    }
    
    await Promise.all(closePromises);
    console.log('Todos os browsers foram fechados');
  }

  getBrowserCount() {
    return this.browsers.size;
  }

  // Método para monitoramento
  getStatus() {
    const status = {};
    for (const [purpose, browser] of this.browsers) {
      status[purpose] = {
        connected: !browser.disconnected,
        hasTimeout: this.browserTimeouts.has(purpose)
      };
    }
    return status;
  }
}

const browserManager = new BrowserManager();

// Monitoramento periódico
setInterval(() => {
  const count = browserManager.getBrowserCount();
  if (count > 0) {
    console.log(`Browsers ativos: ${count}`, browserManager.getStatus());
  }
}, 10 * 60 * 1000); // A cada 10 minutos

module.exports = browserManager;