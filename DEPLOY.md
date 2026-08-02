# Publicação segura do Ritmo

Este documento descreve a arquitetura FastAPI + React. As instruções antigas de
Netlify, MySQL e URLs presumidas não se aplicam a esta migração.

## Produção atual

Em 1º de agosto de 2026, a última produção confirmada usava:

- frontend: `https://habitos-base.vercel.app`;
- backend: `https://supportive-warmth-production-dd70.up.railway.app`;
- banco: PostgreSQL gerenciado no Railway;
- frontend Vercel: deployment `dpl_CrRMC1Wo3B8TrFiUYV9aVAsanCRw`, estado
  `Ready`;
- backend Railway: deployment `3e4557c0-9ac2-4e7c-93a1-5acf02c458d6`, estado
  `SUCCESS`;
- aplicação: commit `3d9d7b3`.

As mudanças de estabilização descritas em `STATUS.md` ainda precisam passar por
staging antes de substituir essa versão. Não confunda validação local com código
publicado.

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

## Proteção e recuperação dos dados

O workflow `Daily PostgreSQL backup` executa todos os dias, cria um dump do
PostgreSQL de produção, restaura esse dump em um PostgreSQL efêmero e só então
publica o arquivo criptografado como artefato privado por 30 dias.

Crie o ambiente GitHub `database-backups`, sem aprovação manual para execuções
agendadas, e adicione estes secrets:

| Secret | Conteúdo |
| --- | --- |
| `DATABASE_BACKUP_URL` | URL pública de conexão ao PostgreSQL de produção, exclusiva para backup quando o provedor permitir |
| `BACKUP_AGE_RECIPIENT` | Chave pública `age` usada para criptografar o dump antes do upload |

A chave privada `age` correspondente deve ficar fora do GitHub, em local
seguro e acessível aos responsáveis pela recuperação. Sem ela, o artefato não
pode ser restaurado. Depois de cadastrar os secrets, execute manualmente
**Actions > Daily PostgreSQL backup > Run workflow** e confirme que as etapas
de dump, restauração isolada, criptografia e upload foram aprovadas.

Para exportar também os documentos JSON portáteis dos dois perfis:

```powershell
$env:RITMO_API_URL = "https://<host-real-da-api>/api"
$env:RITMO_ACCESS_TOKEN = "<chave-configurada-no-backend>"
python backend/scripts/export_profile_backups.py
Remove-Item Env:RITMO_ACCESS_TOKEN
```

Os arquivos são gravados em `.ritmo-backups/`, que é ignorado pelo Git. Eles
contêm dados pessoais e devem ser movidos para armazenamento criptografado.

Para validar esses JSONs em uma API local ou staging isolado, use o diretório
que contém `manifest.json`; destinos remotos exigem também `--allow-remote`:

```powershell
$env:RITMO_API_URL = "http://127.0.0.1:8001/api"
$env:RITMO_ACCESS_TOKEN = "<chave-do-ambiente-isolado>"
python backend/scripts/restore_profile_backups.py ".ritmo-backups\<data>" --confirm-profile-replacement
Remove-Item Env:RITMO_ACCESS_TOKEN
```

Para uma recuperação manual, baixe o artefato mais recente, valide o arquivo
`.sha256`, descriptografe o `.age` com a chave privada e restaure o dump em um
banco PostgreSQL vazio. Nunca teste restauração apontando para produção:

```powershell
age --decrypt --identity "<arquivo-da-chave-privada>" --output ritmo.dump ritmo.dump.age
createdb --host "<host-de-staging>" --username "<usuario>" ritmo_restore_test
pg_restore --host "<host-de-staging>" --username "<usuario>" --dbname ritmo_restore_test --exit-on-error --no-owner --no-acl ritmo.dump
```

O workflow `Production health monitor` consulta o diagnóstico `/health` a cada
15 minutos, abre uma issue quando API, banco ou notificações não estão saudáveis
e a fecha após a recuperação. O Railway e o smoke de publicação usam `/ready`,
que retorna HTTP 503 enquanto o banco estiver indisponível ou o scheduler
embutido ainda não estiver pronto.
Defina a variável de repositório `HEALTHCHECK_URL` apenas se a URL canônica
mudar. O workflow `Monthly restore reminder` abre no primeiro dia de cada mês
uma issue com o checklist de recuperação.

O Sentry já está integrado no código. Para ativá-lo, crie projetos separados e
configure `SENTRY_DSN` e `SENTRY_ENVIRONMENT=production` no Railway, além de
`VITE_SENTRY_DSN` nos ambientes Preview e Production da Vercel. Depois force um
erro controlado em cada ambiente e confirme o recebimento antes de considerar
o monitoramento concluído.

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
.\.venv\Scripts\alembic.exe upgrade head
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m mypy config.py main.py push_worker.py rate_limit.py security.py time_utils.py services/anahi.py schemas
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m uvicorn main:app --reload
```

Esse `alembic upgrade head` pressupõe banco novo ou já versionado. Se um SQLite
local antigo tiver tabelas e não tiver revisão Alembic, não use `stamp head`
sem validar o schema. Exporte os JSONs dos perfis e teste a restauração em um
banco novo antes de substituir ou arquivar o arquivo legado.

Em outro terminal, faça pelo menos estes smoke tests:

```powershell
Invoke-RestMethod http://localhost:8000/health
Invoke-RestMethod http://localhost:8000/ready
Invoke-RestMethod http://localhost:8000/api/users
```

Teste também criação, edição e exclusão de um hábito, uma tarefa e um treino,
além das rotas de estatísticas. Confirme que reiniciar a API não perde os dados.

### Frontend

```powershell
Set-Location frontend
Copy-Item .env.example .env
npm ci
npm run lint
npm test
npm run test:coverage
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

- `deploy-backend.yml`: instala dependências, valida o grafo Alembic, compila,
  executa `pytest` e constrói a imagem Docker;
- `deploy-frontend.yml`: usa o lockfile, executa lint, testes com cobertura e
  gera o build Vite.

Não prossiga se qualquer job falhar.

## 3. Backend

O workflow oferece publicação manual no Railway porque o repositório já contém
um Dockerfile do backend. Isso não significa que um projeto, serviço, domínio,
banco ou credencial já exista.

Crie os ambientes protegidos `backend-staging` e `backend-production` no
GitHub. Configure em cada um os valores do ambiente Railway correspondente:

| Tipo | Nome | Conteúdo |
| --- | --- | --- |
| Secret | `RAILWAY_TOKEN` | token de projeto com acesso ao ambiente |
| Secret | `RAILWAY_PROJECT_ID` | ID do projeto escolhido |
| Secret | `APP_ACCESS_TOKEN` | mesma chave forte configurada no serviço |
| Variable | `RAILWAY_ENVIRONMENT` | nome ou ID do ambiente |
| Variable | `RAILWAY_SERVICE` | nome ou ID do serviço do backend |
| Variable | `BACKEND_BASE_URL` | origem HTTPS pública, sem `/api` |

No provedor, configure o diretório raiz do serviço como `/backend` e selecione
`/backend/railway.toml` como arquivo de configuração quando necessário.

### Migrações Alembic

O schema novo é criado pela revisão inicial em `backend/alembic/versions/`.
O `Dockerfile` executa `alembic upgrade head` antes de iniciar a API. Para um
banco Railway que já existia antes do Alembic, faça um backup e confira o schema
no staging. Se ele já corresponde ao schema atual, registre o baseline uma única
vez com `alembic stamp head`; se não corresponder, aplique a revisão em staging
e planeje a atualização de produção com janela de manutenção. Não use
`stamp head` em um banco que ainda precise de colunas ou índices.

### Ambiente de staging do backend

Crie esse ambiente manualmente no Railway antes de testar qualquer migração de
schema em produção:

1. no mesmo projeto Railway, crie o ambiente `staging` sem copiar referências
   de banco da produção;
2. adicione uma instância PostgreSQL exclusiva e confirme que a
   `DATABASE_URL` do serviço de staging aponta somente para ela;
3. crie um serviço de API e domínio próprios, mantendo `/backend` como raiz e
   `backend/railway.toml` como configuração;
4. configure `RITMO_DEBUG=false`, uma `APP_ACCESS_TOKEN` exclusiva,
   `SENTRY_ENVIRONMENT=staging` e `CORS_ORIGINS` apenas com o preview do
   frontend; use chaves VAPID separadas ou mantenha push desativado;
5. crie no GitHub o ambiente protegido `backend-staging`, com os mesmos nomes
   de secret e variable de `backend-production`, mas todos apontando para os
   recursos de staging;
6. publique primeiro no serviço de staging, aplique as migrações versionadas e
   execute `/health`, `/ready`, `/api`, um CRUD descartável e um reinício com
   conferência de persistência;
7. aponte um preview da Vercel para a URL `/api` de staging e valide os fluxos
   principais antes de repetir a migração em produção.

O workflow permite selecionar `backend-staging` ou `backend-production`.
Produção exige a confirmação literal `PRODUCTION`. Não selecione staging antes
que o ambiente, o banco isolado e as proteções do GitHub existam de fato.

### Processador durável de lembretes

O modo padrão usa uma única réplica da API com `PUSH_SCHEDULER_IN_API=true`. Se
as duas chaves VAPID estiverem configuradas, o lifespan inicia imediatamente o
scheduler em uma thread. A outbox `push_deliveries`, seus estados `pending`,
`sent` e `failed` e os retries persistidos continuam sendo a fonte de verdade.
Sem VAPID, a API inicia normalmente e informa notificações desativadas em
`/health` e `/ready`.

O workflow padrão publica somente a API e não exige `RAILWAY_WORKER_SERVICE`.
Depois da publicação, ele aguarda `/ready` responder HTTP 200 com estado
`healthy`. Um scheduler embutido sem primeiro ciclo recente deixa `/health`
`degraded` e faz `/ready` responder HTTP 503; falha de banco também retorna 503.

O worker desativa apenas a inscrição que receber rejeição permanente HTTP 400,
401, 403, 404, 410 ou 413. Entregas usam um header `Topic` determinístico e o
shutdown aguarda até 30 segundos pela chamada Web Push atual, sem iniciar a
próxima. No frontend, limpar o `localStorage` não invalida uma inscrição: a chave
VAPID real do navegador é comparada primeiro e o storage é reconstruído quando
ela coincide.

`backend/railway.worker.toml` existe apenas para o modo avançado com serviço
externo. Para adotá-lo, configure `PUSH_SCHEDULER_IN_API=false` na API, crie
manualmente um segundo serviço com esse TOML, compartilhe `DATABASE_URL`,
`TIMEZONE` e VAPID e não exponha domínio HTTP para o worker. Nesse modo a API
informa `delivery_status=external`, pois não possui heartbeat do outro processo;
opere e publique esse serviço fora do workflow padrão. Valide antes com
`python -m push_worker --once` e consulte a outbox.

Antes de publicar:

- use um banco persistente e configure a `DATABASE_URL`; SQLite em disco
  efêmero não é adequado para produção;
- use `RITMO_DEBUG=false`;
- configure uma chave forte em `APP_ACCESS_TOKEN`;
- configure `SENTRY_DSN` e `SENTRY_ENVIRONMENT=production` se o projeto de
  monitoramento do backend já existir;
- configure `CORS_ORIGINS` apenas com as origens reais do preview e da produção,
  separadas por vírgula e sem caminhos;
- mantenha `TIMEZONE=America/Sao_Paulo`, salvo decisão explícita em contrário;
- gere um par VAPID exclusivo e configure `VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` para lembretes com a PWA fechada;
- mantenha `PUSH_SCHEDULER_IN_API=true` quando houver uma única réplica da API;
- não salve segredos em `.env` versionado;
- mantenha uma forma de restaurar ou exportar os dados.

Para publicar, abra **Actions > Backend CI and manual release > Run workflow**.
Primeiro execute com `publish = false`. Depois publique em `backend-staging`.
Use `backend-production` somente após validar staging e informar `PRODUCTION`
no campo de confirmação.

Antes de uma publicação em `backend-production`, o workflow exporta os dois
perfis da API ainda ativa, valida os documentos e cria o artefato privado
`predeploy-profile-backup-<run-id>` com retenção de 30 dias. O conteúdo é
criptografado com AES-256/PBKDF2 usando `APP_ACCESS_TOKEN` como senha. Se a
exportação, validação, criptografia ou upload falhar, a publicação é abortada.

Após a publicação, copie a URL real fornecida pelo provedor e valide:

```powershell
$env:RITMO_API_URL = "https://<host-real-da-api>"
$env:RITMO_ACCESS_TOKEN = "<chave-configurada-no-backend>"
Invoke-RestMethod "$env:RITMO_API_URL/health"
Invoke-RestMethod "$env:RITMO_API_URL/ready"
Invoke-RestMethod `
  -Uri "$env:RITMO_API_URL/api/users" `
  -Headers @{ "X-Ritmo-Key" = $env:RITMO_ACCESS_TOKEN }
```

O workflow aguarda `/ready` e repete automaticamente a verificação autenticada
após o `railway up`; ele falha se o backend não ficar saudável ou se `/api` não
aceitar a chave. Use o roteiro manual acima também para conferir a
persistência antes da promoção. Não continue se qualquer verificação falhar.

## 4. Preview do frontend

Crie os ambientes protegidos `preview` e `production` no GitHub. Em ambos,
configure:

| Tipo | Nome | Conteúdo |
| --- | --- | --- |
| Secret | `VERCEL_TOKEN` | token autorizado a publicar |
| Secret | `VERCEL_ORG_ID` | ID da conta ou equipe |
| Secret | `VERCEL_PROJECT_ID` | ID do projeto existente |
| Variable | `VITE_API_URL` | URL HTTPS completa da API, terminando em `/api` |
| Variable | `VITE_SENTRY_DSN` | DSN público opcional do projeto Sentry frontend |

Configure `VITE_API_URL` e, quando usado, `VITE_SENTRY_DSN` também nos ambientes
Preview e Production do projeto na Vercel. Não use `localhost` em builds
remotos.

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
