# Publicação segura do Ritmo

Este documento descreve a arquitetura FastAPI + React. As instruções antigas de
Netlify, MySQL e URLs presumidas não se aplicam a esta migração.

## Produção atual

Em 29 de julho de 2026, o fluxo abaixo foi concluído com:

- frontend: `https://habitos-base.vercel.app`;
- backend: `https://supportive-warmth-production-dd70.up.railway.app`;
- banco: PostgreSQL gerenciado no Railway;
- frontend Vercel: deployment `dpl_Au6mrpnStvhKN5aAdTzxd3FHVuzE`, estado
  `Ready`;
- aplicação: commit `cf209eb`.

Os segredos permanecem somente nos provedores. O teste em viewport mobile foi
aprovado; instalação e notificação em um iPhone físico ainda precisam ser
confirmadas no próprio aparelho.

## Política de promoção

1. Preservar a versão antiga em produção.
2. Validar backend e frontend localmente e no CI.
3. Publicar o backend em um ambiente controlado.
4. Criar um preview do frontend apontando para essa API.
5. Validar API, persistência, segurança e interface mobile no preview.
6. Somente então promover manualmente o frontend para produção.

Os workflows não publicam em `push`. A publicação acontece apenas por
`workflow_dispatch`, depois do job de testes.

> Atenção: uma integração Git existente no painel da Vercel pode publicar fora
> destes workflows. Antes de enviar esta branch para `main`, confirme no painel
> que a produção não será atualizada automaticamente.

## 1. Validação local

### Backend

```powershell
Set-Location backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m pip_audit -r requirements-dev.txt
.\.venv\Scripts\python.exe -m compileall -q .
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m uvicorn main:app --reload
```

Em outro terminal, faça pelo menos estes smoke tests:

```powershell
Invoke-RestMethod http://localhost:8000/health
Invoke-RestMethod http://localhost:8000/api/users
```

Teste também criação, edição e exclusão de um hábito, uma tarefa e um treino,
além das rotas de estatísticas. Confirme que reiniciar a API não perde os dados.

### Frontend

```powershell
Set-Location frontend
Copy-Item .env.example .env
npm ci
npm test
npm run build
npm run dev
```

Com a API local ativa, valide a interface em:

- mobile: `390 x 844`;
- desktop: `1440 x 1000`;
- sem rolagem horizontal;
- carregamento inicial, troca de perfil, hábitos, tarefas, foco, treinos,
  progresso, configurações e erros de autorização.

## 2. CI

Os dois workflows executam em pull requests e em pushes para `main` quando os
arquivos correspondentes mudam:

- `deploy-backend.yml`: instala dependências, compila, executa `pytest` e
  constrói a imagem Docker;
- `deploy-frontend.yml`: usa o lockfile, executa os testes e gera o build Vite.

Não prossiga se qualquer job falhar.

## 3. Backend

O workflow oferece publicação manual no Railway porque o repositório já contém
um Dockerfile do backend. Isso não significa que um projeto, serviço, domínio,
banco ou credencial já exista.

Crie o ambiente protegido `backend-production` no GitHub e configure:

| Tipo | Nome | Conteúdo |
| --- | --- | --- |
| Secret | `RAILWAY_TOKEN` | token de projeto com acesso ao ambiente |
| Secret | `RAILWAY_PROJECT_ID` | ID do projeto escolhido |
| Variable | `RAILWAY_ENVIRONMENT` | nome ou ID do ambiente |
| Variable | `RAILWAY_SERVICE` | nome ou ID do serviço do backend |

No provedor, configure o diretório raiz do serviço como `/backend` e selecione
`/backend/railway.toml` como arquivo de configuração quando necessário.

Antes de publicar:

- use um banco persistente e configure a `DATABASE_URL`; SQLite em disco
  efêmero não é adequado para produção;
- use `RITMO_DEBUG=false`;
- configure uma chave forte em `APP_ACCESS_TOKEN`;
- configure `CORS_ORIGINS` apenas com as origens reais do preview e da produção,
  separadas por vírgula e sem caminhos;
- mantenha `TIMEZONE=America/Sao_Paulo`, salvo decisão explícita em contrário;
- gere um par VAPID exclusivo e configure `VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` para lembretes com a PWA fechada;
- não salve segredos em `.env` versionado;
- mantenha uma forma de restaurar ou exportar os dados.

Para publicar, abra **Actions > Backend CI and manual release > Run workflow**.
Primeiro execute com `publish = false`. Use `publish = true` apenas depois de
aprovar o job de testes e revisar o ambiente `backend-production`.

Após a publicação, copie a URL real fornecida pelo provedor e valide:

```powershell
$env:RITMO_API_URL = "https://<host-real-da-api>"
$env:RITMO_ACCESS_TOKEN = "<chave-configurada-no-backend>"
Invoke-RestMethod "$env:RITMO_API_URL/health"
Invoke-RestMethod `
  -Uri "$env:RITMO_API_URL/api/users" `
  -Headers @{ "X-Ritmo-Key" = $env:RITMO_ACCESS_TOKEN }
```

Use a chave configurada para testar as rotas protegidas. Não continue se o
health check, a autenticação ou a persistência falharem.

## 4. Preview do frontend

Crie os ambientes protegidos `preview` e `production` no GitHub. Em ambos,
configure:

| Tipo | Nome | Conteúdo |
| --- | --- | --- |
| Secret | `VERCEL_TOKEN` | token autorizado a publicar |
| Secret | `VERCEL_ORG_ID` | ID da conta ou equipe |
| Secret | `VERCEL_PROJECT_ID` | ID do projeto existente |
| Variable | `VITE_API_URL` | URL HTTPS completa da API, terminando em `/api` |

Configure `VITE_API_URL` também nos ambientes Preview e Production do projeto
na Vercel. Não use `localhost` em builds remotos.

No projeto Vercel, mantenha **Root Directory** na raiz do repositório. O
`vercel.json` já executa instalação e build dentro de `frontend/`; configurar
`frontend` novamente no painel faria a raiz e os caminhos divergirem.

Abra **Actions > Frontend CI and Vercel release > Run workflow** e escolha
`preview`. O workflow só publica depois de `npm test` e `npm run build`.

No endereço de preview retornado pelo workflow:

- repita os smoke tests da API;
- crie dados e confirme a persistência após recarregar;
- confira que uma chave inválida é recusada;
- valide as larguras mobile e desktop;
- teste uma rota interna aberta diretamente no navegador.

## 5. Promoção

Somente com todos os itens anteriores aprovados:

1. execute novamente **Frontend CI and Vercel release**;
2. escolha `production`;
3. marque a confirmação de que preview e mobile foram aprovados;
4. aguarde testes, build e deploy;
5. confirme o status final no provedor e faça smoke test da URL pública.

Se a validação final falhar, não altere o backend nem apague dados para
“acompanhar” o erro. Restaure a implantação anterior do frontend no painel da
Vercel e investigue a nova versão separadamente.
