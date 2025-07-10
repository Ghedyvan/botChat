#!/bin/bash
# Script para preparar VPS Ubuntu/Debian para o bot WhatsApp

echo "=== Preparando VPS para Bot WhatsApp ==="
echo "Este script instala todas as dependências necessárias para VPS headless"
echo ""

# Verificar se é root
if [ "$EUID" -ne 0 ]; then
    echo "Este script precisa ser executado como root (use sudo)"
    exit 1
fi

# Atualizar sistema
echo "1. Atualizando sistema..."
apt-get update -y
apt-get upgrade -y

# Instalar dependências básicas
echo "2. Instalando dependências básicas..."
apt-get install -y \
    curl \
    wget \
    gnupg \
    software-properties-common \
    apt-transport-https \
    ca-certificates \
    lsb-release

# Instalar Node.js (versão LTS)
echo "3. Instalando Node.js..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
    apt-get install -y nodejs
fi

# Verificar versão do Node.js
NODE_VERSION=$(node --version)
echo "Node.js instalado: $NODE_VERSION"

# Instalar PM2 globalmente
echo "4. Instalando PM2..."
npm install -g pm2

# Instalar Chromium e dependências para VPS headless
echo "5. Instalando Chromium e dependências para VPS..."
apt-get install -y \
    chromium-browser \
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
    libgconf-2-4 \
    libxtst6 \
    libxrender1 \
    libxi6 \
    libglib2.0-0 \
    libnss3-dev \
    libatk1.0-0 \
    libdrm-common \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxkbcommon-x11-0

# Configurar permissões do chrome-sandbox
echo "6. Configurando permissões do Chromium..."
if [ -f "/usr/lib/chromium-browser/chrome-sandbox" ]; then
    chmod 4755 /usr/lib/chromium-browser/chrome-sandbox
    echo "Permissões do chrome-sandbox configuradas"
fi

# Verificar se Chromium funciona
echo "7. Testando Chromium..."
sudo -u $SUDO_USER timeout 15s chromium-browser \
    --headless \
    --no-sandbox \
    --disable-gpu \
    --disable-dev-shm-usage \
    --virtual-time-budget=2000 \
    --dump-dom \
    https://www.google.com > /dev/null 2>&1

if [ $? -eq 0 ]; then
    echo "✓ Chromium funcionando corretamente"
else
    echo "⚠ Aviso: Teste do Chromium falhou"
fi

# Configurar limites do sistema para o bot
echo "8. Configurando limites do sistema..."

# Aumentar limites de arquivos abertos
cat >> /etc/security/limits.conf << EOF

# Limites para bot WhatsApp
* soft nofile 65536
* hard nofile 65536
* soft nproc 32768
* hard nproc 32768
EOF

# Configurar swap se necessário (para VPS com pouca RAM)
echo "9. Verificando memória e swap..."
TOTAL_MEM=$(free -m | awk 'NR==2{printf "%.0f", $2}')
SWAP_SIZE=$(free -m | awk 'NR==3{printf "%.0f", $2}')

echo "Memória total: ${TOTAL_MEM}MB"
echo "Swap atual: ${SWAP_SIZE}MB"

if [ "$TOTAL_MEM" -lt 2048 ] && [ "$SWAP_SIZE" -lt 1024 ]; then
    echo "Criando arquivo de swap (recomendado para VPS com pouca RAM)..."
    fallocate -l 1G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "Swap de 1GB criado"
fi

# Configurar PM2 para iniciar automaticamente
echo "10. Configurando PM2 para inicialização automática..."
if [ -n "$SUDO_USER" ]; then
    sudo -u $SUDO_USER pm2 startup
    echo "Configure o PM2 startup executando o comando mostrado acima"
fi

# Criar script de monitoramento de recursos
echo "11. Criando script de monitoramento..."
cat > /usr/local/bin/bot-monitor.sh << 'EOF'
#!/bin/bash
# Monitor de recursos para o bot WhatsApp

echo "=== Monitor do Bot WhatsApp ==="
echo "Data: $(date)"
echo ""

echo "=== Uso de Memória ==="
free -h
echo ""

echo "=== Uso de CPU ==="
top -bn1 | head -5
echo ""

echo "=== Espaço em Disco ==="
df -h /
df -h /tmp
echo ""

echo "=== Processos do Bot ==="
pm2 status
echo ""

echo "=== Processos do Chromium ==="
ps aux | grep -i chromium | grep -v grep || echo "Nenhum processo do Chromium ativo"
echo ""

echo "=== Últimas linhas do log ==="
pm2 logs bot --lines 10 --nostream
EOF

chmod +x /usr/local/bin/bot-monitor.sh

# Limpeza final
echo "12. Limpeza final..."
apt-get autoremove -y
apt-get autoclean

echo ""
echo "=== Instalação Concluída ==="
echo ""
echo "✓ Node.js: $(node --version)"
echo "✓ NPM: $(npm --version)"
echo "✓ PM2: $(pm2 --version)"
echo "✓ Chromium: $(chromium-browser --version | head -1)"
echo ""
echo "Próximos passos:"
echo "1. Navegue até o diretório do seu bot"
echo "2. Execute: npm install"
echo "3. Execute: ./start_clean.sh"
echo ""
echo "Comandos úteis:"
echo "- Monitorar recursos: /usr/local/bin/bot-monitor.sh"
echo "- Logs do bot: pm2 logs bot"
echo "- Status: pm2 status"
echo "- Monitoramento: pm2 monit"
echo ""
echo "A VPS está pronta para executar o bot WhatsApp em modo headless!"
