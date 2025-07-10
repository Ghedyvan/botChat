#!/bin/bash
# Script para testar o bot em VPS

echo "=== Teste do Bot WhatsApp em VPS ==="

# Verificar se estamos em uma VPS
if [ -z "$DISPLAY" ]; then
    echo "✓ Ambiente headless detectado (VPS)"
else
    echo "⚠ Ambiente com display detectado"
fi

# Verificar Node.js
if command -v node &> /dev/null; then
    echo "✓ Node.js: $(node --version)"
else
    echo "✗ Node.js não encontrado"
    exit 1
fi

# Verificar Chromium
if command -v chromium-browser &> /dev/null; then
    echo "✓ Chromium: $(chromium-browser --version | head -1)"
else
    echo "✗ Chromium não encontrado"
    exit 1
fi

# Verificar sintaxe do bot.js
echo "Verificando sintaxe do bot.js..."
node -c bot.js
if [ $? -eq 0 ]; then
    echo "✓ Sintaxe do bot.js válida"
else
    echo "✗ Erro de sintaxe no bot.js"
    exit 1
fi

# Verificar dependências
echo "Verificando dependências..."
if [ -f "package.json" ]; then
    if [ -d "node_modules" ]; then
        echo "✓ node_modules encontrado"
    else
        echo "⚠ node_modules não encontrado, instalando..."
        npm install
    fi
else
    echo "✗ package.json não encontrado"
    exit 1
fi

# Testar Chromium em modo headless
echo "Testando Chromium headless..."
timeout 15s chromium-browser \
    --headless \
    --no-sandbox \
    --disable-gpu \
    --disable-dev-shm-usage \
    --virtual-time-budget=2000 \
    --dump-dom \
    https://www.google.com > /dev/null 2>&1

if [ $? -eq 0 ]; then
    echo "✓ Chromium headless funcionando"
else
    echo "⚠ Chromium headless com problemas, mas pode funcionar"
fi

# Verificar PM2
if command -v pm2 &> /dev/null; then
    echo "✓ PM2: $(pm2 --version)"
else
    echo "⚠ PM2 não encontrado, instalando..."
    npm install -g pm2
fi

# Verificar memória
echo ""
echo "=== Recursos do Sistema ==="
echo "Memória:"
free -h
echo ""
echo "Espaço em disco:"
df -h /tmp

echo ""
echo "=== Teste Concluído ==="
echo "O bot está pronto para ser executado!"
echo ""
echo "Para iniciar:"
echo "  ./start_clean.sh"
echo ""
echo "Para monitorar:"
echo "  pm2 logs bot"
echo "  pm2 status"
