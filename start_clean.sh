#!/bin/bash

echo "Iniciando limpeza e configuração do ambiente VPS headless..."

# Parar todos os processos PM2
pm2 stop all 2>/dev/null || true
pm2 delete all 2>/dev/null || true

# Limpar processos órfãos específicos para VPS
sudo pkill -f "chromium" 2>/dev/null || true
sudo pkill -f "chrome" 2>/dev/null || true
sudo pkill -f "Xvfb" 2>/dev/null || true

# Aguardar limpeza
sleep 5

# Executar script de configuração do ambiente VPS
echo "Configurando ambiente VPS headless..."
chmod +x ./setup_environment.sh
./setup_environment.sh

if [ $? -ne 0 ]; then
    echo "Erro na configuração do ambiente VPS, tentando continuar..."
fi

# Limpar sessões antigas (opcional - descomente se necessário)
# rm -rf ./session/.wwebjs_*

# Criar diretórios necessários
mkdir -p ./logs ./session ./backups

# Configurar variáveis de ambiente para VPS headless
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
export XDG_CONFIG_HOME=/tmp/.config
export XDG_CACHE_HOME=/tmp/.cache
export NODE_OPTIONS="--max-old-space-size=512 --expose-gc"
export CHROME_DEVEL_SANDBOX=/usr/lib/chromium-browser/chrome-sandbox

# IMPORTANTE: Remover DISPLAY para VPS sem interface gráfica
unset DISPLAY

# Verificar se chromium está funcionando
echo "Verificando Chromium..."
if ! command -v chromium-browser &> /dev/null; then
    echo "Erro: Chromium não encontrado!"
    exit 1
fi

# Teste rápido do Chromium
timeout 10s chromium-browser --headless --no-sandbox --disable-gpu --dump-dom https://www.google.com > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "✓ Chromium funcionando corretamente"
else
    echo "⚠ Aviso: Teste do Chromium falhou, mas continuando..."
fi

# Exibir informações do sistema
echo "=== Informações do Sistema ==="
echo "Memória disponível:"
free -h
echo "Espaço em /tmp:"
df -h /tmp

# Iniciar com PM2
echo "Iniciando aplicação no ambiente VPS..."
pm2 start ecosystem.config.js
pm2 save

echo ""
echo "Bot iniciado em ambiente VPS headless!"
echo "Use 'pm2 logs' para ver os logs."
echo "Para verificar status: pm2 status"
echo "Para parar: pm2 stop bot"
echo ""
echo "Monitoramento:"
echo "- Logs do bot: pm2 logs bot"
echo "- Status: pm2 monit"
echo "- Reiniciar: pm2 restart bot"