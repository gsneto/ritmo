# Ritmo - Assistente Pessoal de Hábitos

Sistema completo de gerenciamento de hábitos com **FastAPI + React + MySQL**.

## Estrutura do Projeto

```
habitos-base/
├── backend/           # API FastAPI
│   ├── Dockerfile     # Para deploy
│   ├── railway.toml  # Config Railway
│   └── ...
│
├── frontend/         # Aplicação React
│   ├── netlify.toml  # Config Netlify
│   └── ...
│
└── README.md
```

## Deploy no Railway (Backend + MySQL)

### 1. Criar projeto no Railway

1. Acesse [railway.app](https://railway.app)
2. Login com GitHub
3. New Project → "Deploy from GitHub repo"
4. Selecione este repositório
5. Configure as variáveis de ambiente:

```
DB_HOST = <host do MySQL>
DB_PORT = 3306
DB_USER = <usuario>
DB_PASSWORD = <senha>
DB_NAME = ritmo_db
```

### 2. Adicionar MySQL

1. No Railway dashboard, clique no projeto
2. "Add Plugin" → "MySQL"
3. O Railway cria automaticamente e fornece as credenciais
4. Copie o `MYSQLHOST`, `MYSQLPASSWORD`, etc para as variáveis acima

### 3. Configurar o deploy

O backend está configurado para:
- Build: Dockerfile
- Health check: `/health`
- Porta: 8000

O deploy inicia automaticamente quando você faz push no GitHub.

## Deploy no Netlify (Frontend)

### 1. Conectar ao Netlify

1. Acesse [netlify.com](https://netlify.com)
2. Login com GitHub
3. "Add new site" → "Import from Git"
4. Selecione o repositório
5. Configure:
   - Build command: `npm run build`
   - Publish directory: `dist`

### 2. Configurar variável de ambiente

1. Site Settings → Environment Variables
2. Adicione: `VITE_API_URL=https://<seu-railway-app>.railway.app`

### 3. Configurar redirects

O `netlify.toml` já está configurado para redirecionar `/api/*` para o backend.

## Deploy Local

### Backend
```bash
cd backend
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt

# Criar banco MySQL
mysql -u root -p
CREATE DATABASE ritmo_db;

# Rodar
uvicorn main:app --reload
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Funcionalidades

- ✅ Hábitos com check-in diário
- ✅ Tarefas com datas/horários
- ✅ Timer Pomodoro para leitura
- ✅ Treinos de academia (7 dias)
- ✅ Gráficos de progresso
- ✅ Perfis múltiplos (Antonio/Itayna)
- ✅ Tema claro/escuro
- ✅ Persistência em MySQL
- ✅ Notificações do navegador
- ✅ Reset de dados

## Perfis Padrão

Ao iniciar, o sistema cria automaticamente:
- **Antonio** (A)
- **Itayna** (I)

Cada perfil tem seus próprios hábitos, tarefas e treinos.
