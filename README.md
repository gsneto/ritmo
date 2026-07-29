# Ritmo

Aplicativo pessoal de hábitos, tarefas, foco, treinos e progresso.

A arquitetura ativa é:

- `backend/`: API FastAPI e persistência SQLAlchemy;
- `frontend/`: SPA React, TypeScript e Vite;
- `vercel.json`: build do `frontend/` e fallback de rotas da SPA;
- `.github/workflows/`: validação contínua e publicações manuais.

O frontend e o backend são aplicações separadas. Em produção, o frontend deve
receber a URL HTTPS completa da API em `VITE_API_URL`, incluindo o prefixo
`/api`. O Vercel não hospeda nem redireciona o backend desta configuração.

## Desenvolvimento local

### Backend

```powershell
Set-Location backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m uvicorn main:app --reload
```

O SQLite local usa:

```env
DATABASE_URL=sqlite:///./ritmo.db
RITMO_DEBUG=true
```

A API estará disponível localmente em `http://localhost:8000`. Rotas úteis:

- `GET /health`
- `GET /api/users`
- `GET /docs`

Em produção, `RITMO_DEBUG=false` exige `APP_ACCESS_TOKEN`. O frontend envia essa chave
no cabeçalho `X-Ritmo-Key`; ela não deve ser versionada.

### Frontend

Em outro terminal:

```powershell
Set-Location frontend
Copy-Item .env.example .env
npm ci
npm run dev
```

Para desenvolvimento local:

```env
VITE_API_URL=http://localhost:8000/api
```

## Validação

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m pip_audit -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q

Set-Location ..\frontend
npm test
npm run build
```

O build não comprova sozinho que a API, o banco e a interface mobile funcionam
juntos. Consulte [DEPLOY.md](DEPLOY.md) para o fluxo de preview, smoke tests e
promoção, e [STATUS.md](STATUS.md) para o estado atual.

## Regra de publicação

Push e pull request executam testes; não promovem automaticamente esta migração
para produção pelos workflows do repositório. Preview e produção exigem execução
manual, e produção exige confirmação explícita. A versão antiga deve permanecer
online até a nova versão passar pelos testes de API e interface mobile.
