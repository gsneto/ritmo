# 🚀 Guia de Deploy - Ritmo

## Opção 1: Deploy Manual (Mais Rápido)

### Passo 1: Criar Repositório no GitHub

1. Acesse [github.com](https://github.com)
2. Clique em **"+"** → **"New repository"**
3. Nome: `ritmo`
4. **NÃO** marque "Add a README file" (já temos)
5. Clique **"Create repository"**
6. Na próxima tela, copie a URL do repositório

### Passo 2: Enviar Código para GitHub

Abra o terminal na pasta do projeto e execute:

```bash
# Inicializar git (se não existir)
git init

# Adicionar todos os arquivos
git add .

# Commit
git commit -m "Ritmo - Assistente de Hábitos"

# Adicionar remote (substitua pela URL do seu repositório)
git remote add origin https://github.com/SEU_USUARIO/ritmo.git

# Enviar
git branch -M main
git push -u origin main
```

### Passo 3: Deploy Backend no Railway

1. Acesse [railway.app](https://railway.app)
2. Clique **"Login"** → **"Login with GitHub"**
3. Autorize o acesso
4. Clique **"New Project"** → **"Deploy from GitHub repo"**
5. Selecione o repositório `ritmo`
6. **Adicionar MySQL:**
   - Clique no projeto → **"Add Plugin"** → **"MySQL"**
   - Aguarde criar o banco
7. **Configurar variáveis:**
   - Clique em **"Variables"**
   - O Railway já preencheu `MYSQL_*` automaticamente
   - Adicione (ou edite) estas variáveis:
     ```
     DB_HOST = ${MYSQL_HOST}
     DB_PORT = 3306
     DB_USER = ${MYSQL_USER}
     DB_PASSWORD = ${MYSQL_PASSWORD}
     DB_NAME = ${MYSQL_DATABASE}
     ```
8. Aguarde o deploy terminar (~$2-3 min)
9. Copie a URL do deploy (ex: `https://ritmo.railway.app`)

### Passo 4: Deploy Frontend no Netlify

1. Acesse [netlify.com](https://netlify.com)
2. Clique **"Login"** → **"Login with GitHub"**
3. Autorize o acesso
4. Clique **"Add new site"** → **"Import from Git"**
5. Selecione `ritmo/frontend`
6. Configure:
   - **Base directory:** `frontend` (já deve estar)
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
7. Clique **"Deploy site"**
8. **Variáveis de ambiente:**
   - Vá em **Site settings** → **Environment variables**
   - Clique **"New variable"**:
     ```
     Key: VITE_API_URL
     Value: https://ritmo.railway.app  (substitua pela sua URL)
     ```
9. **Redeploy:**
   - Vá em **Deploys**
   - Clique **"Trigger deploy"** → **"Deploy site"**
10. Copie a URL do site (ex: `https://ritmo.netlify.app`)

### Passo 5: Atualizar Frontend com URL correta

1. No Netlify, vá em **Site settings** → **General**
2. Copie a **Netlify subdomain URL**
3. No Railway, copie a URL do backend
4. Atualize a variável `VITE_API_URL` com a URL do Railway

---

## Opção 2: Teste Local (Sem Deploy)

Se quiser testar antes de fazer deploy:

### Backend
```bash
cd backend
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt

# Criar banco MySQL (você precisa ter MySQL instalado)
mysql -u root -p
CREATE DATABASE ritmo_db;
EXIT

# Rodar
uvicorn main:app --reload
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

---

## URLs após deploy

```
Frontend:  https://seu-app.netlify.app
Backend:   https://seu-app.railway.app
API Docs:  https://seu-app.railway.app/docs
```

---

## Solução de Problemas

### "Cannot connect to database"
- Verifique as variáveis `DB_*` no Railway
- Verifique se o MySQL está rodando

### "CORS error"
- O backend já tem CORS configurado para `localhost:5173` e Netlify
- Se usar outra URL, adicione em `main.py` → `allow_origins`

### "Build failed"
- Verifique se o `package.json` tem as dependências corretas
- No Netlify, verifique se o Node version é 18+

---

## Custos

| Serviço | Plano | Preço |
|---------|-------|-------|
| Railway | Starter | $5/mês (ou $500 créditos grátis) |
| Netlify | Starter | FREE |
| MySQL (Railway) | Starter | $5/mês (ou incluído nos créditos) |

**Alternativa gratuita:** Use PlanetScale (MySQL serverless) + Railway free tier.

---

Precisa de ajuda com algum passo específico?
