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
- Briefing matinal opcional da ANAHÍ por notificação push.
- Selos de sequência e insights determinísticos após histórico suficiente.
- Exportação de calendário `.ics` e cartão de progresso de treino em PNG.
- Entrada por voz opcional em tarefas e itens de compra, quando o navegador suporta.
- Compras compartilhadas entre dois perfis por código de convite.
- Tema claro/escuro, PWA instalável, atalhos rápidos, funcionamento offline e notificações.
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

## Monitoramento de erros

O Sentry é opcional e permanece desativado quando o DSN correspondente está
vazio. Use projetos separados para não misturar erros da API e do navegador:

- backend: configure `SENTRY_DSN` e `SENTRY_ENVIRONMENT` no Railway;
- frontend: configure `VITE_SENTRY_DSN` nos ambientes Preview e Production da
  Vercel. O prefixo `VITE_` é necessário para disponibilizar o DSN público ao
  bundle do navegador.

As integrações não enviam PII por padrão. DSNs, tokens de upload de sourcemap e
outras credenciais nunca devem ser commitados em `.env`.

## Testes

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m mypy config.py main.py rate_limit.py security.py time_utils.py services/anahi.py schemas

Set-Location ..\frontend
npm test
npm run lint
npm run test:coverage
npm run build
```

## Decisões de arquitetura da auditoria

- O schema de produção é versionado em `backend/alembic/versions/`; o container
  aplica `alembic upgrade head` antes de iniciar a API.
- Workouts, Pomodoro, timers de treino e o formulário de compras usam hooks
  dedicados, permitindo continuar a extração dos componentes grandes por partes.
- TanStack Query foi avaliado, mas ficou para uma etapa posterior: primeiro os
  hooks de domínio precisam estabilizar os contratos de carregamento e mutação;
  adicionar cache global agora aumentaria o risco de alterar esses fluxos.
- TypeScript 7 foi avaliado na branch `chore/typescript-7-evaluation`; build e
  testes passaram, mas o lint não passou porque `typescript-eslint` ainda não
  suporta TS 7. A branch principal permanece em TypeScript 6.

## Privacidade

Os dados do Ritmo pertencem ao perfil que os criou. A ANAHÍ recebe apenas o
contexto necessário para responder à pergunta; chaves e dados sensíveis ficam
no servidor e não são versionados. Quando dois perfis ativam o compartilhamento
de compras, somente listas, itens e histórico desse domínio passam a aparecer
para ambos; hábitos, tarefas, treinos e leitura continuam isolados. O orçamento
mensal geral permanece configurado por perfil.
