const puppeteer = require('puppeteer');

class BrowserManager {
  constructor() {
    this.browsers = new Map();
    this.maxBrowsers = 3; // Aumentar para acomodar diferentes tipos
    this.browserTimeouts = new Map();
  }

  async getBrowser(purpose = 'default') {
    // Limpar timeout anterior se existir
    if (this.browserTimeouts.has(purpose)) {
      clearTimeout(this.browserTimeouts.get(purpose));
    }

    if (this.browsers.has(purpose)) {
      const browser = this.browsers.get(purpose);
      if (!browser.disconnected) {
        try {
          await browser.version(); // Teste rápido de conectividade
          this.setupBrowserTimeout(purpose);
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
    // Separar portas por propósito para evitar conflitos
    const portMap = {
      'scrapper': 9230,
      'default': 9231,
      'backup': 9232
    };
    
    const port = portMap[purpose] || 9233;
    
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
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        // Diretório único por propósito e timestamp
        `--user-data-dir=/tmp/browser-${purpose}-${Date.now()}`,
        `--remote-debugging-port=${port}`,
      ],
      defaultViewport: null,
    });
  }

  setupBrowserTimeout(purpose) {
    // Auto-cleanup diferenciado por propósito
    const timeouts = {
      'scrapper': 30 * 60 * 1000, // 30 minutos
      'default': 60 * 60 * 1000,  // 1 hora
      'backup': 15 * 60 * 1000    // 15 minutos
    };
    
    const timeout = timeouts[purpose] || 30 * 60 * 1000;
    
    const timeoutId = setTimeout(async () => {
      console.log(`Fechando browser ${purpose} por inatividade (${timeout/60000} min)`);
      await this.closeBrowser(purpose);
    }, timeout);

    this.browserTimeouts.set(purpose, timeoutId);
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
    console.log('Fechando todos os browsers gerenciados...');
    
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
    console.log('Todos os browsers gerenciados foram fechados');
  }

  getBrowserCount() {
    return this.browsers.size;
  }

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

  // Método para limpar browsers órfãos do sistema
  async cleanupOrphanedBrowsers() {
    console.log('Limpando browsers órfãos do sistema...');
    
    const { exec } = require('child_process');
    
    return new Promise((resolve) => {
      // Matar processos Chromium órfãos
      exec('pkill -f "chromium.*remote-debugging-port"', (error, stdout, stderr) => {
        if (error && error.code !== 1) { // código 1 = nenhum processo encontrado (normal)
          console.error('Erro ao limpar browsers órfãos:', error);
        } else {
          console.log('Browsers órfãos limpos');
        }
        
        // Limpar diretórios temporários antigos
        exec('find /tmp -name "browser-*" -type d -mtime +1 -exec rm -rf {} \\; 2>/dev/null', (cleanError) => {
          if (!cleanError) {
            console.log('Diretórios temporários antigos limpos');
          }
          resolve();
        });
      });
    });
  }
}

const browserManager = new BrowserManager();

// Monitoramento periódico melhorado
setInterval(() => {
  const count = browserManager.getBrowserCount();
  if (count > 0) {
    console.log(`Browsers gerenciados ativos: ${count}`, browserManager.getStatus());
  }
}, 10 * 60 * 1000); // A cada 10 minutos

// Limpeza periódica de órfãos
setInterval(async () => {
  await browserManager.cleanupOrphanedBrowsers();
}, 60 * 60 * 1000); // A cada 1 hora

module.exports = browserManager;