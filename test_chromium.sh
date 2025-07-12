#!/bin/bash

echo "=== TESTE DE CHROMIUM PARA VPS ==="
echo "Data: $(date)"
echo "Sistema: $(uname -a)"
echo ""

echo "1. Verificando caminhos de navegadores..."
BROWSER_PATHS=(
    "/usr/bin/chromium-browser"
    "/usr/bin/chromium"
    "/usr/bin/google-chrome"
    "/usr/bin/google-chrome-stable"
    "/snap/bin/chromium"
    "/usr/local/bin/chromium"
    "/opt/google/chrome/chrome"
)

for path in "${BROWSER_PATHS[@]}"; do
    if [ -f "$path" ]; then
        echo "✓ Encontrado: $path"
        echo "  Permissões: $(ls -la "$path" | awk '{print $1}')"
        echo "  Proprietário: $(ls -la "$path" | awk '{print $3":"$4}')"
    else
        echo "✗ Não encontrado: $path"
    fi
done

echo ""
echo "2. Testando execução do Chromium..."
if [ -f "/usr/bin/chromium-browser" ]; then
    echo "Testando /usr/bin/chromium-browser --version"
    /usr/bin/chromium-browser --version 2>&1 || echo "Erro ao executar chromium-browser"
    
    echo ""
    echo "Testando /usr/bin/chromium-browser --headless --disable-gpu --no-sandbox --version"
    timeout 10s /usr/bin/chromium-browser --headless --disable-gpu --no-sandbox --version 2>&1 || echo "Erro no teste headless"
fi

echo ""
echo "3. Verificando dependências..."
echo "Verificando libxss1:"
dpkg -l | grep libxss1 || echo "libxss1 não instalado"

echo "Verificando libgconf:"
dpkg -l | grep libgconf || echo "libgconf não instalado"

echo "Verificando libxrandr2:"
dpkg -l | grep libxrandr2 || echo "libxrandr2 não instalado"

echo "Verificando libasound2:"
dpkg -l | grep libasound2 || echo "libasound2 não instalado"

echo "Verificando libpangocairo:"
dpkg -l | grep libpangocairo || echo "libpangocairo não instalado"

echo "Verificando libatk:"
dpkg -l | grep libatk || echo "libatk não instalado"

echo "Verificando libcairo-gobject2:"
dpkg -l | grep libcairo-gobject2 || echo "libcairo-gobject2 não instalado"

echo "Verificando libgtk-3:"
dpkg -l | grep libgtk-3 || echo "libgtk-3 não instalado"

echo "Verificando libgdk-pixbuf2.0:"
dpkg -l | grep libgdk-pixbuf2.0 || echo "libgdk-pixbuf2.0 não instalado"

echo ""
echo "4. Verificando espaço em disco..."
df -h /tmp
df -h /

echo ""
echo "5. Verificando processos do Chrome/Chromium..."
ps aux | grep -E "(chrome|chromium)" | grep -v grep || echo "Nenhum processo Chrome/Chromium em execução"

echo ""
echo "6. Testando criação de diretórios temporários..."
mkdir -p /tmp/chrome-test-user-data
if [ $? -eq 0 ]; then
    echo "✓ Diretório temporário criado com sucesso"
    rm -rf /tmp/chrome-test-user-data
else
    echo "✗ Erro ao criar diretório temporário"
fi

echo ""
echo "=== FIM DO TESTE ==="
