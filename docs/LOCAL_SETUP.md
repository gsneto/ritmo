# Ambiente local do Ritmo

Guia para desenvolver e testar o Ritmo nesta máquina sem tocar nos dados
publicados nem no banco legado. O estado operacional fica em `STATUS.md`; o
runbook de publicação, em `DEPLOY.md`.

## Pré-requisitos

- Python 3.12 ou superior.
- Node.js 20 ou superior.
- Git.

## Backend

```powershell
Set-Location backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
```

### Variáveis de ambiente

Copie o exemplo apenas se ainda não existir um `backend/.env`:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Um `backend/.env` existente pode ter sido criado antes desta documentação e não
conter `RITMO_DEBUG`. Sem `RITMO_DEBUG=true`, a API recusa a combinação
`ALLOW_INSECURE_NO_ACCESS_TOKEN=true` com SQLite e comandos como
`alembic current` falham na validação de `config.py`. Para acrescentar somente o
que falta, sem exibir nem reescrever o conteúdo existente:

```powershell
$envPath = ".env"
$lines = Get-Content $envPath
if (-not ($lines -match '^\s*RITMO_DEBUG\s*=')) { Add-Content $envPath "RITMO_DEBUG=true" }
if (-not ($lines -match '^\s*DATABASE_URL\s*=')) { Add-Content $envPath "DATABASE_URL=sqlite:///./ritmo.db" }
```

Regras:

- `RITMO_DEBUG=true` e `ALLOW_INSECURE_NO_ACCESS_TOKEN=true` existem somente para
  desenvolvimento local com SQLite. Produção exige `RITMO_DEBUG=false` e uma
  `APP_ACCESS_TOKEN` longa e aleatória.
- `DATABASE_URL` aceita `sqlite:///./ritmo.db`, `postgresql://`, `postgres://` e
  `mysql://`. A aplicação troca o prefixo por um driver instalado
  (`postgresql+psycopg://` ou `mysql+pymysql://`).
- Nunca versione `backend/.env`. Ele já está no `.gitignore`.

### Iniciar a API

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m uvicorn main:app --reload
```

A API fica em `http://localhost:8000`. Com `RITMO_DEBUG=true`, a documentação
interativa fica em `http://localhost:8000/docs`.

> Atenção: `DATABASE_URL=sqlite:///./ritmo.db` aponta para o mesmo arquivo do
> banco legado. Com `RITMO_DEBUG=true`, iniciar a API executa o bootstrap de
> compatibilidade e o seed nesse arquivo. Se o banco legado precisa ficar
> intocado, defina outro caminho antes de subir a API, por exemplo
> `$env:DATABASE_URL = "sqlite:///./ritmo-dev.db"`.

### Verificar a API

```powershell
Invoke-RestMethod http://localhost:8000/health
Invoke-RestMethod http://localhost:8000/ready
Invoke-RestMethod http://localhost:8000/api/users
```

Se `APP_ACCESS_TOKEN` estiver definido no `.env`, as rotas `/api` exigem o
cabeçalho correspondente:

```powershell
Invoke-RestMethod `
  -Uri http://localhost:8000/api/users `
  -Headers @{ "X-Ritmo-Key" = "<valor-de-APP_ACCESS_TOKEN>" }
```

### Migrações Alembic

O schema versionado fica em `backend/alembic/versions/`. O container executa
`alembic upgrade head` antes de iniciar a API.

```powershell
.\.venv\Scripts\python.exe -m alembic current
.\.venv\Scripts\python.exe -m alembic upgrade head
```

`upgrade head` só deve ser executado em banco novo, vazio ou já versionado. Não
execute `alembic upgrade`, `alembic stamp` nem `create_all` contra
`backend/ritmo.db`: esse arquivo é anterior ao Alembic, possui uma tabela
`alembic_version` vazia (sem revisão registrada) e é tratado pela camada de
compatibilidade SQLite descrita em `STATUS.md`. Em `backend/ritmo.db`,
`alembic current` termina sem erro, mas não exibe revisão. Para experimentar
migrações, use um caminho temporário:

```powershell
$probe = "$($env:TEMP -replace '\\','/')/ritmo-alembic-probe.db"
$env:DATABASE_URL = "sqlite:///$probe"
.\.venv\Scripts\python.exe -m alembic upgrade head
Remove-Item Env:DATABASE_URL
Remove-Item -LiteralPath $probe -ErrorAction SilentlyContinue
```

### Dados de demonstração (opcional)

O Ritmo não cria perfis nem treinos automaticamente. Se quiser os dois perfis de
exemplo e os sete treinos padrão em um banco local descartável, ative o seed
explicitamente:

```powershell
$env:RITMO_SEED_DEFAULT_DATA = "true"
.\\.venv\\Scripts\\python.exe -m uvicorn main:app --reload
Remove-Item Env:RITMO_SEED_DEFAULT_DATA
```

O seed é idempotente: não duplica registros nem sobrescreve perfis existentes, e
nunca define senha. Nunca habilite essa variável em staging ou produção.

### Senhas dos perfis

O login do navegador usa perfil + senha. O hash é gravado no banco por um
comando de operador; não existe cadastro público nem senha padrão.

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m scripts.set_profile_password --profile-id antonio
```

A senha é pedida no terminal e não aparece no histórico. Use pelo menos 12
caracteres. Para automação, `--stdin` lê a senha da entrada padrão.

No banco legado local o comando funciona, mas evite rodá-lo contra
`backend/ritmo.db` sem antes ter um backup verificado.

### Login no navegador

Depois de subir a API e o frontend, abra `http://localhost:5173`. A tela de
entrada lista os perfis e pede a senha. A sessão fica num cookie `HttpOnly`
chamado `ritmo_session` (sem o prefixo `__Host-` em http local) e expira em 30
dias por padrão.

### Migrations contra o PostgreSQL de staging

`backend/scripts/alembic_online.ps1` aplica a cadeia Alembic em um banco remoto
sem expor a URL:

```powershell
Set-Location backend
.\scripts\alembic_online.ps1 -DryRun   # confere o destino, nao executa
.\scripts\alembic_online.ps1           # executa upgrade head, current e check
```

O helper lê a URL com entrada oculta, exige que o host seja o da branch de
validação (`ep-lucky-unit-b8tr5lts`) e redige qualquer URL na saída. Nunca passe
a URL como argumento.

## Frontend

```powershell
Set-Location frontend
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm ci
npm run dev
```

A interface fica em `http://localhost:5173`. O `vite.config.ts` encaminha `/api`
para `http://localhost:8000`, então `VITE_API_URL` pode ficar vazio no
desenvolvimento. Em builds remotos, `VITE_API_URL` precisa ser a URL completa da
API terminando em `/api`.

Toda variável `VITE_*` é incorporada ao bundle do navegador e é pública. Nunca
coloque segredos nelas.

## Testes isolados

Backend:

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m mypy config.py main.py push_worker.py rate_limit.py security.py time_utils.py services/anahi.py schemas
```

`tests/conftest.py` cria um SQLite temporário por teste em `tmp_path`, define
`APP_ACCESS_TOKEN=test-ritmo-key` e ignora o `.env` do projeto. Os testes não
usam `backend/ritmo.db` nem banco remoto. Não altere isso para apontar para um
banco real.

Verificado em 17 de outubro de 2026: a suíte completa não altera
`backend/ritmo.db` e não cria banco no diretório de trabalho. Se quiser uma
proteção extra ao rodar testes manualmente, defina um caminho temporário antes:

```powershell
$env:DATABASE_URL = "sqlite:///$(Join-Path $env:TEMP 'ritmo-test-suite.db')"
.\.venv\Scripts\python.exe -m pytest -q
Remove-Item Env:DATABASE_URL
Remove-Item -LiteralPath (Join-Path $env:TEMP 'ritmo-test-suite.db') -ErrorAction SilentlyContinue
```

Frontend:

```powershell
Set-Location frontend
npm test
npm run lint
npm run build
```

## Banco de desenvolvimento e banco legado

| Arquivo | Situação | Uso permitido |
| --- | --- | --- |
| `backend/ritmo.db` | Banco legado, com `alembic_version` vazia, possivelmente com dados pessoais | Somente leitura para diagnóstico. Não migrar, não recriar, não usar em testes |
| Arquivo SQLite em diretório temporário | Banco descartável | Testes e experimentos |
| PostgreSQL de produção | Dados reais | Nunca como ambiente genérico de teste |

Antes de qualquer operação que possa escrever em `backend/ritmo.db`, exporte os
perfis pela API e valide a restauração em um banco novo.

## Dados pessoais

- `.ritmo-backups/`, `*.db`, `*.dump`, `*.age`, `*.pem` e `*.key` são ignorados
  pelo Git. Ainda assim, evite cópias em texto puro: os snapshots de perfil
  contêm dados pessoais.
- Não cole conteúdo de `.env`, tokens, chaves ou backups em issues, commits,
  logs ou mensagens.
- Se precisar guardar um backup fora do repositório, use um destino criptografado
  e verifique se ele não duplica dados sensíveis em outro diretório sincronizado.
