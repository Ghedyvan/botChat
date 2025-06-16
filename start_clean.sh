#!/bin/bash
# filepath: /Users/ghedyvanvinicius/Documents/Projetos/botChat/start_clean.sh

echo "Iniciando limpeza e configuração do ambiente..."

# Parar todos os processos PM2
pm2 stop all
pm2 delete all

# Limpar processos órfãos
sudo pkill -f "chromium" 2>/dev/null || true
sudo pkill -f "chrome" 2>/dev/null || true

# Aguardar limpeza
sleep 10

# Limpar sessões antigas (opcional - descomente se necessário)
# rm -rf ./session/.wwebjs_*

# Criar diretórios necessários
mkdir -p ./logs
mkdir -p ./session
mkdir -p ./backups

# Verificar dependências
if ! command -v chromium-browser &> /dev/null; then
    echo "Instalando Chromium..."
    sudo apt-get update
    sudo apt-get install -y chromium-browser
fi

# Configurar variáveis de ambiente
export NODE_OPTIONS="--max-old-space-size=512 --expose-gc"
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Iniciar com PM2
echo "Iniciando aplicação..."
pm2 start ecosystem.config.js
pm2 save

echo "Bot iniciado! Use 'pm2 logs' para ver os logs."