#!/bin/bash
# Script para configurar ambiente VPS headless para o bot WhatsApp

echo "Configurando ambiente VPS headless para o bot WhatsApp..."

# Configurar variáveis de ambiente para VPS
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
export HOME=${HOME:-/root}
export XDG_CONFIG_HOME=/tmp/.config
export XDG_CACHE_HOME=/tmp/.cache
export NODE_OPTIONS="--max-old-space-size=512 --expose-gc"
export CHROME_DEVEL_SANDBOX=/usr/lib/chromium-browser/chrome-sandbox

# Remover DISPLAY para VPS sem interface gráfica
unset DISPLAY

echo "Ambiente VPS detectado (headless)"

# Verificar se estamos em uma VPS/servidor
if [ -z "$DISPLAY" ] && [ ! -d "/usr/share/xsessions" ]; then
    echo "✓ Confirmado: ambiente headless"
else
    echo "⚠ Aviso: possível ambiente com interface gráfica"
fi

# Verificar se chromium-browser existe
if ! command -v chromium-browser &> /dev/null; then
    echo "Chromium não encontrado, tentando instalar..."
    
    # Atualizar repositórios
    apt-get update -qq
    
    # Instalar chromium e dependências necessárias
    apt-get install -y \
        chromium-browser \
        ca-certificates \
        fonts-liberation \
        libappindicator3-1 \
        libasound2 \
        libatk-bridge2.0-0 \
        libdrm2 \
        libgtk-3-0 \
        libnspr4 \
        libnss3 \
        libxcomposite1 \
        libxrandr2 \
        xdg-utils \
        libxss1 \
        libgconf-2-4
    
    if [ $? -eq 0 ]; then
        echo "✓ Chromium instalado com sucesso"
    else
        echo "✗ Erro ao instalar Chromium"
        exit 1
    fi
else
    echo "✓ Chromium já está instalado"
fi

# Verificar versão do Chromium
CHROME_VERSION=$(chromium-browser --version 2>/dev/null || echo "Versão não disponível")
echo "Versão do Chromium: $CHROME_VERSION"

# Criar diretórios necessários para VPS
mkdir -p /tmp/.config /tmp/.cache /tmp/chrome-user-data /tmp/chrome-data /tmp/chrome-cache /tmp/chrome-crashes
chmod -R 755 /tmp/.config /tmp/.cache /tmp/chrome-*

# Criar diretórios do projeto
mkdir -p ./logs ./session ./backups

# Limpar processos antigos
pkill -f "chromium" 2>/dev/null || true
pkill -f "chrome" 2>/dev/null || true
pkill -f "Xvfb" 2>/dev/null || true

# Limpar arquivos temporários antigos
rm -rf /tmp/chrome-* /tmp/.X* /tmp/.com.google.Chrome* 2>/dev/null || true

# Aguardar limpeza
sleep 2

# Testar se o chromium funciona em modo headless
echo "Testando Chromium em modo headless..."
timeout 20s chromium-browser \
    --headless \
    --no-sandbox \
    --disable-gpu \
    --disable-dev-shm-usage \
    --virtual-time-budget=1000 \
    --dump-dom \
    https://www.google.com > /dev/null 2>&1

if [ $? -eq 0 ]; then
    echo "✓ Chromium funcionando corretamente em modo headless"
else
    echo "⚠ Aviso: Teste do Chromium em modo headless falhou, mas prosseguindo..."
    
    # Tentar configurações alternativas
    echo "Configurando permissões alternativas..."
    
    # Verificar se chrome-sandbox existe e tem permissões corretas
    if [ -f "/usr/lib/chromium-browser/chrome-sandbox" ]; then
        chmod 4755 /usr/lib/chromium-browser/chrome-sandbox 2>/dev/null || true
        echo "Permissões do chrome-sandbox configuradas"
    fi
fi

# Verificar recursos do sistema
echo ""
echo "=== Informações do Sistema ==="
echo "Memória disponível:"
free -h
echo ""
echo "Espaço em disco:"
df -h /tmp
echo ""
echo "Processos do Chromium ativos:"
ps aux | grep -i chromium | grep -v grep || echo "Nenhum processo do Chromium ativo"
echo ""

echo "Ambiente VPS headless configurado com sucesso!"
echo ""
echo "Variáveis de ambiente configuradas:"
echo "  PUPPETEER_EXECUTABLE_PATH=$PUPPETEER_EXECUTABLE_PATH"
echo "  XDG_CONFIG_HOME=$XDG_CONFIG_HOME"
echo "  XDG_CACHE_HOME=$XDG_CACHE_HOME"
echo "  DISPLAY=$DISPLAY (removido para VPS)"
echo "  NODE_OPTIONS=$NODE_OPTIONS"
