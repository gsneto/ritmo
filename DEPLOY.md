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

Em 17 de outubro de 2026, uma verificação direta encontrou:

- o frontend responde HTTP 200, mas o bundle publicado referencia a API antiga;
- a API antiga responde HTTP 404 com `{"message":"Application not found"}` e
  cabeçalho `x-railway-fallback: true`, indicando domínio sem serviço associado;
- a estabilização está commitada em `676c1f3`, mas a produção continua em
  `3d9d7b3`.

Trate o endpoint Railway antigo como indisponível até que um novo deploy seja
verificado. Não presuma que o host responde porque a documentação antiga o cita.

Os segredos permanecem somente nos provedores. O teste em viewport mobile foi
aprovado; instalação e notificação em um iPhone físico ainda precisam ser
confirmadas no próprio aparelho.

## Arquitetura gratuita pretendida (não provisionada)

Esta seção registra a direção planejada e os limites verificados em 17 de
outubro de 2026. Nenhum recurso foi criado, alterado ou publicado nesta fase.

| Camada | Escolha pretendida | Limite gratuito verificado |
| --- | --- | --- |
| Frontend | Vercel Hobby | 100 GB de transferência/mês e 100 deployments/dia; uso pessoal não comercial |
| API | Render Free web service | 750 horas de instância/mês por workspace; suspensão após 15 minutos sem tráfego; filesystem efêmero; sem disco persistente |
| Banco | Neon Free PostgreSQL | 100 CU-hours por projeto/mês; 1 GB por projeto (20 GB no total); 5 GB de transferência pública; scale-to-zero após 5 minutos; 6 horas de restore; 1 snapshot manual |
| Código e CI | GitHub Free | 2.000 minutos/mês em repositório privado (repositórios públicos não consomem minutos); workflows agendados podem ser desativados após 60 dias sem atividade, como já ocorreu neste repositório |
| Backup | GitHub Actions com artefato criptografado | depende da franquia de Actions e da retenção de artefatos |

O Render Free Postgres não é adequado: o banco gratuito expira 30 dias após a
criação e não oferece backup. Por isso o banco pretendido é o Neon.

O projeto Neon Free `ritmo-pessoal-staging` já existe e teve o esquema validado
em PostgreSQL 18. Plano, região, limites verificados e pendências estão em
`docs/NEON_STAGING.md`.

Consequências obrigatórias para o desenho:

- Uma instância gratuita com filesystem efêmero não pode depender de SQLite
  local. Os dados precisam ficar em um PostgreSQL gerenciado e a `DATABASE_URL`
  precisa ser configurada no provedor, fora do Git.
- A primeira requisição depois da suspensão pode levar cerca de um minuto. A
  interface precisa tolerar esse tempo de inicialização.
- Lembretes agendados não podem depender de uma instância que pode estar
  suspensa. É necessário aceitar atraso ou acordar o serviço com um gatilho
  externo, respeitando as 750 horas/mês.
- O Render pode suspender um serviço gratuito que gere volume incomum de tráfego
  de saída; o acesso ao banco externo conta nesse limite.
- A conexão com o Neon deve usar SSL (`sslmode=require`). O endpoint com pooler
  opera em modo transação; com psycopg 3, avalie `prepare_threshold=None` para
  evitar conflito de prepared statements.
- Limites, cotas e termos dos planos gratuitos podem mudar. Revalide as páginas
  oficiais antes de qualquer publicação.

A migração do SQLite legado exige backup verificado, estratégia de importação,
validação em banco isolado e rollback. O banco real não pode ser usado como
ambiente genérico de testes.

## Backend em Render Free (staging)

O serviço de staging **não foi criado**. O MCP do Render não está exposto neste
ambiente e não há credencial disponível, então nenhum recurso Render foi
provisionado, consultado ou publicado. O que segue são as condições verificadas
na documentação oficial em 17 de outubro de 2026 e o roteiro para execução
manual.

### Condições de custo zero

- Web services aceitam o plano `Free` com Docker.
- 750 horas de instância por workspace por mês; serviços suspensos não consomem
  horas.
- Suspensão após 15 minutos sem tráfego de entrada; retomada leva cerca de um
  minuto.
- Sem disco persistente no plano Free; o sistema de arquivos é efêmero.
- Sem método de pagamento, o esgotamento de banda ou de minutos de build
  **suspende** os serviços gratuitos em vez de cobrar. Com método de pagamento
  cadastrado, há cobrança por excedente.
- Antes de criar o serviço, confirme no painel que o workspace não possui método
  de pagamento. Se possuir, não crie o serviço sem antes definir um limite de
  gastos efetivo.

### Configuração do serviço

O blueprint está versionado em `render.yaml` na raiz. Ele declara um único web
service, plano `free`, região `virginia`, sem disco persistente e sem workers.

| Campo | Valor |
| --- | --- |
| Nome | `ritmo-api-staging` |
| Runtime | Docker |
| Dockerfile | `backend/Dockerfile` |
| Contexto de build | `backend` |
| Região | `virginia` (a mesma de `aws-us-east-1` no Neon) |
| Plano | `free` |
| Disco persistente | nenhum |
| Health check | `/ready` |
| Auto-deploy | desligado (`autoDeployTrigger: 'off'`) |

O `Dockerfile` escuta em `0.0.0.0` e respeita `${PORT:-8000}`. O `CMD` **não**
executa migrations: subir a instância nunca altera o schema.

### Serviço criado (18 de outubro de 2026)

O serviço existe e está no ar:

| Campo | Valor |
| --- | --- |
| Nome | `ritmo-api-staging` |
| ID | `srv-dbaa28rncjis73cpk0mg` |
| Blueprint | `ritmo-staging` (`exs-dbaa1d6q1p3s73at540g`) |
| URL | `https://ritmo-api-staging.onrender.com` |
| Plano / região | Free / `virginia` |
| Commit | `fe6ba1f` |
| Health check | `/ready` |

Criado pelo Blueprint do dashboard, a partir do repositório público
`gsneto/ritmo` na branch `feat/ritmo-staging-deploy`. O workspace não tem cartão
cadastrado (`No card on file`), então excedente suspende o serviço em vez de
cobrar.

`DATABASE_URL` **não** foi criada automaticamente: o campo `sync: false` ficou
vazio no formulário. Foi adicionada depois em Environment, com o endpoint direto
do Neon (sem `-pooler`). Sem ela o primeiro deploy caiu no SQLite efêmero e
falhou com `no such table: users`; a correção está em `fe6ba1f`.

### Provisionamento manual (histórico)



O MCP do Render não está exposto neste ambiente, então o serviço **não foi
criado**. Antes de criar, confirme no dashboard que o workspace **não** tem
método de pagamento: com cartão cadastrado, excedente de banda ou de minutos de
build vira cobrança; sem cartão, o Render suspende os serviços gratuitos até o
próximo ciclo.

1. Abra `https://dashboard.render.com/blueprints` e clique em **New Blueprint
   Instance**.
2. Selecione o repositório `gsneto/ritmo` e a branch `feat/ritmo-staging-deploy`.
3. Confirme o arquivo `render.yaml` e o plano `free`.
4. No momento do sync, o Render pedirá `DATABASE_URL` e `CORS_ORIGINS`
   (`sync: false`). Informe a URL da branch de validação do Neon e a origem exata
   do preview da Vercel.
5. Confirme que `APP_ACCESS_TOKEN` foi gerado pelo próprio Render e que
   `SESSION_COOKIE_SECURE=true`.
6. Anote a URL pública `https://<nome>.onrender.com`.

Se o dashboard não oferecer o plano `free` para o workspace, interrompa: não
prossiga com plano pago.

### Variáveis de ambiente

| Nome | Origem |
| --- | --- |
| `DATABASE_URL` | informada no dashboard, endpoint direto com `sslmode=require` |
| `APP_ACCESS_TOKEN` | gerada pelo Render (`generateValue: true`) |
| `RITMO_DEBUG` | `false` |
| `ALLOW_INSECURE_NO_ACCESS_TOKEN` | `false` |
| `SESSION_COOKIE_SECURE` | `true` |
| `SESSION_COOKIE_SAMESITE` | `lax` |
| `TIMEZONE` | `America/Sao_Paulo` |
| `CORS_ORIGINS` | origem exata do preview da Vercel |

Nenhum valor secreto é versionado. Não configure `SENTRY_DSN`, `GEMINI_API_KEY`
nem chaves VAPID nesta fase.

### Migrations são explícitas

Depois que o serviço existir, aplique o schema uma única vez, de forma
controlada, a partir de um shell confiável:

```powershell
Set-Location backend
.\scripts\alembic_online.ps1
```

O helper exige que o host seja o da branch de validação e redige a URL em
qualquer saída. Não habilite `preDeployCommand` com `alembic upgrade head` em
produção: cada restart reaplicaria a cadeia.

### Autenticação do navegador

O frontend usa sessão em cookie, não a chave de API. No serviço publicado:

| Nome | Conteúdo |
| --- | --- |
| `SESSION_COOKIE_SECURE` | `true` |
| `SESSION_COOKIE_SAMESITE` | `lax` (ou `none` apenas se a API ficar em outro site) |
| `SESSION_TTL_HOURS` | opcional, padrão `720` |

Depois da primeira subida, provisione a senha de cada perfil dentro do ambiente:

```powershell
python -m scripts.set_profile_password --profile-id <perfil>
```

Para manter o cookie first-party, sirva a API na mesma origem do frontend com um
rewrite na Vercel, declarado antes do catch-all:

```json
{ "source": "/api/:path*", "destination": "https://<api-host>/api/:path*" }
```

Nesse cenário `VITE_API_URL` fica vazio. Se a API ficar em outro domínio, o
cookie passa a ser de terceiros e pode ser bloqueado pelo navegador; nesse caso
`SESSION_COOKIE_SAMESITE=none` e `SESSION_COOKIE_SECURE=true` são obrigatórios.

A chave `APP_ACCESS_TOKEN` continua necessária para scripts e backups, mas não é
usada pelo navegador nem entra no bundle. Detalhes em `docs/ADR-AUTH-WEB.md`.

### Limitações conhecidas

- A instância dorme e a primeira requisição após a suspensão é lenta.
- Lembretes agendados não são confiáveis em uma instância que pode estar
  suspensa.
- O staging não contém dados pessoais e não substitui a migração do aplicativo.


### Proxy same-origin na Vercel

Enquanto o serviço Render não existir, **não** adicione uma destination
fictícia. Quando a URL real estiver confirmada, insira a regra **antes** do
catch-all da SPA em `vercel.json`:

```json
{
  "source": "/api/:path*",
  "destination": "https://<nome>.onrender.com/api/:path*"
}
```

O prefixo `/api` aparece dos dois lados de propósito: as rotas do FastAPI já
começam em `/api`, então a destination precisa preservá-lo. Uma regra
`/api/:path*` para `https://host/:path*` produziria 404.

Com esse rewrite e `VITE_API_URL` vazio, o navegador fala apenas com a origem do
preview. O cookie `__Host-ritmo_session` passa a ser host-only da Vercel, que é
exatamente o requisito do prefixo `__Host-`.

Não habilite cache para `/api/*`: as respostas carregam sessão e dados pessoais.
O `main.py` já envia `Cache-Control: no-store` para todo caminho `/api`.

### Preview validado

O projeto Vercel `habitos-base` foi reconectado ao repositório `gsneto/ritmo`
(estava sem Git desde agosto) e passou a gerar previews por branch.

| Item | Valor |
| --- | --- |
| Preview de staging | `https://habitos-base-4vtbdep9m-gsneto.vercel.app` |
| Branch | `feat/ritmo-staging-deploy` |
| Commit | `258d76d` |

O preview exige autenticação da Vercel (Deployment Protection padrão do Hobby),
então só o dono da conta acessa. Para liberar publicamente seria necessário
desligar essa proteção, o que não foi feito.

`CORS_ORIGINS` no Render contém a origem exata do preview e a de produção,
separadas por vírgula. Sem a origem do preview, o login falha com
`Origin not allowed` — foi exatamente o erro observado na primeira tentativa.

### Aviso sobre o rewrite no vercel.json

O rewrite `/api/:path*` aponta para a API de **staging**. Ele existe apenas para
validar a integração a partir de um Preview Deployment.

**Antes de publicar o frontend em produção, essa destination precisa apontar
para a API de produção.** Caso contrário o site público enviaria todo o tráfego
de `/api` para o ambiente de staging.

### Preview da Vercel

O preview é gerado a partir da branch `feat/ritmo-staging-deploy`. Não promova
para produção nesta fase e não altere variáveis do ambiente Production.

Se o push disparar um preview automático, acompanhe apenas esse preview. A
Vercel Hobby é para uso pessoal não comercial; o Ritmo se enquadra nisso.

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

O passo a passo reproduzível, incluindo a verificação de variáveis sem expor
segredos, está em `docs/LOCAL_SETUP.md`.

### Backend

```powershell
Set-Location backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
.\.venv\Scripts\python.exe -m pip_audit -r requirements-dev.txt
.\.venv\Scripts\python.exe -m compileall -q .
.\.venv\Scripts\alembic.exe upgrade head
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m mypy config.py main.py push_worker.py rate_limit.py security.py time_utils.py services/anahi.py schemas
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m uvicorn main:app --reload
```

Não sobrescreva um `backend/.env` existente: ele pode conter chaves locais. Se
`RITMO_DEBUG` estiver ausente, a API recusa a combinação
`ALLOW_INSECURE_NO_ACCESS_TOKEN=true` com SQLite e comandos como
`alembic current` falham na validação de `config.py`.

Esse `alembic upgrade head` pressupõe banco novo ou já versionado. Se um SQLite
local antigo tiver tabelas e não tiver revisão Alembic, não use `stamp head`
sem validar o schema. Exporte os JSONs dos perfis e teste a restauração em um
banco novo antes de substituir ou arquivar o arquivo legado. `backend/ritmo.db`
não deve ser migrado, recriado nem usado como banco de testes.

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
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
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
