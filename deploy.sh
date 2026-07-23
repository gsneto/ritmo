#!/bin/bash

# ===========================================
# Script de Deploy - Ritmo
# ===========================================

echo "🚀 Ritmo Deploy Script"
echo "========================"

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Verificar se está no diretório correto
if [ ! -f "backend/main.py" ]; then
    echo -e "${RED}❌ Execute este script na pasta raiz do projeto${NC}"
    exit 1
fi

# Verificar Git
if ! command -v git &> /dev/null; then
    echo -e "${RED}❌ Git não está instalado${NC}"
    exit 1
fi

# Inicializar Git se necessário
if [ ! -d ".git" ]; then
    echo -e "${YELLOW}📦 Inicializando Git...${NC}"
    git init
    git add .
    git commit -m "Ritmo - Assistente de Hábitos"
    echo -e "${GREEN}✅ Git inicializado${NC}"
else
    echo -e "${GREEN}✅ Git já está inicializado${NC}"
fi

# Mostrar próximo passos
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  PRONTO PARA DEPLOY!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Próximos passos:"
echo ""
echo "1️⃣  CRIAR REPOSITÓRIO NO GITHUB:"
echo "    → Acesse https://github.com/new"
echo "    → Nome: ritmo"
echo "    → Create repository"
echo ""
echo "2️⃣  CONECTAR AO GITHUB:"
echo "    → git remote add origin https://github.com/SEU_USUARIO/ritmo.git"
echo "    → git push -u origin main"
echo ""
echo "3️⃣  DEPLOY BACKEND NO RAILWAY:"
echo "    → https://railway.app → New Project → Deploy from GitHub"
echo "    → Selecione o repositório ritmo"
echo "    → Add Plugin → MySQL"
echo "    → Configure as variáveis DB_*"
echo ""
echo "4️⃣  DEPLOY FRONTEND NO NETLIFY:"
echo "    → https://netlify.com → Add new site"
echo "    → Selecione ritmo/frontend"
echo "    → Build: npm run build"
echo "    → Publish: dist"
echo "    → Adicione VITE_API_URL=https://seu-railway-app.railway.app"
echo ""
echo -e "${YELLOW}📖 Consulte DEPLOY.md para instruções detalhadas${NC}"
echo ""
