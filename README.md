<p align="center">
  <img src="frontend/public/ritmo-icon-192.png" width="112" alt="Ícone do Ritmo">
</p>

<h1 align="center">Ritmo</h1>

<p align="center">
  Um organizador pessoal para hábitos, tarefas, compras, finanças, leitura e treinos.
</p>

<p align="center">
  <a href="https://habitos-base.vercel.app">Abrir o aplicativo</a>
</p>

## Recursos

- Rotina diária com hábitos, tarefas, lembretes e check-ins.
- Lista de compras com preços, orçamento e histórico mensal de gastos.
- Treinos guiados com séries, cargas, cronômetros e descanso.
- Biblioteca pessoal com progresso de leitura, anotações e Pomodoro.
- Assistente ANAHÍ, capaz de responder sobre informações registradas no app.
- Tema claro/escuro, PWA instalável, funcionamento offline e notificações.
- Backup e restauração por perfil.

## Tecnologias

- Frontend: React, TypeScript e Vite.
- Backend: FastAPI e SQLAlchemy.
- Banco de dados: SQLite no desenvolvimento e PostgreSQL em produção.
- Hospedagem: Vercel (app) e Railway (API).

## Executar localmente

Pré-requisitos: Node.js 20+ e Python 3.12+.

```powershell
# Terminal 1 — API
Set-Location backend
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m uvicorn main:app --reload
```

```powershell
# Terminal 2 — interface
Set-Location frontend
Copy-Item .env.example .env
npm ci
npm run dev
```

Abra `http://localhost:5173` no navegador. A API local fica em
`http://localhost:8000`.

Para usar a ANAHÍ localmente, defina `GEMINI_API_KEY` somente em
`backend/.env`. Nunca exponha chaves em variáveis `VITE_*` ou no repositório.

## Testes

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m pytest -q

Set-Location ..\frontend
npm test
npm run build
```

## Privacidade

Os dados do Ritmo pertencem ao perfil que os criou. A ANAHÍ recebe apenas o
contexto necessário para responder à pergunta; chaves e dados sensíveis ficam
no servidor e não são versionados.
