# Staging PostgreSQL no Neon

Registro da infraestrutura gratuita criada em 17 de outubro de 2026 para provar
que o esquema do Ritmo funciona em PostgreSQL. Este documento descreve somente o
que foi verificado. Nenhum dado pessoal foi importado e nenhum serviço de API foi
publicado.

## Projeto

| Item | Valor |
| --- | --- |
| Nome | `ritmo-pessoal-staging` |
| ID / slug | `autumn-recipe-20127160` |
| Organização | `Antonio` (`org-withered-glade-54673240`) |
| Plano | Free (`free_v3`; organização com plano `free`) |
| Região | `aws-us-east-1` (N. Virginia) |
| Criado em | 2026-10-17T14:36:15Z |
| PostgreSQL | 18 |
| Branch usada | `main` (`br-ancient-cloud-b8hp23th`), root e default |
| Endpoint | read-write, 0.25–0.25 CU, scale-to-zero observado |
| Pooler | desabilitado (`pooler_enabled: false`) |

A região foi escolhida porque `Virginia, USA` é a única região do Render que
coincide com uma região do Neon entre as disponíveis nas duas plataformas. O Neon
também oferece São Paulo, mas o Render não, e usar São Paulo aumentaria a latência
entre a API e o banco.

## Estado do esquema

- `alembic_version` = `f4b7d2a91c03` (head), após aplicar as quatro revisões na
  ordem `d755b1cfc868` → `6f24b1d9a021` → `b8c19d0a4e32` → `f4b7d2a91c03`.
- 20 tabelas de aplicação mais `alembic_version`.
- 156 colunas, com fingerprint `md5` idêntico ao gerado por `Base.metadata` a
  partir dos modelos SQLAlchemy.
- 23 chaves estrangeiras, com as regras `CASCADE`/`SET NULL` previstas.
- 33 restrições `CHECK` nomeadas (`ck_*`).
- 7 restrições `UNIQUE` declaradas e os índices únicos correspondentes.
- Tipo nativo `theme_enum` com os rótulos `light` e `dark`.
- Índices parciais criados: `ix_push_deliveries_pending_retry`,
  `uq_reading_books_active_user` e `uq_workout_sessions_active_user`.
- Função `ritmo_push_delivery_user_guard()` e os dois triggers
  `trg_push_deliveries_fill_user_id` e
  `trg_push_deliveries_immutable_user_id`.

## Como o esquema foi aplicado

O agente não obteve a string de conexão, para não expor credenciais. Em vez disso:

1. gerou o DDL offline com `alembic upgrade head --sql` apontando para um dialeto
   PostgreSQL fictício (sem conexão);
2. revisou o SQL gerado, incluindo o bloco `plpgsql` e os índices parciais;
3. executou o DDL em três transações pelo MCP do Neon.

Consequência: `alembic upgrade head` **online** ainda não foi executado contra
este banco. A tabela `alembic_version` já está em `f4b7d2a91c03`, então uma
execução futura deve ser um no-op, mas isso precisa ser confirmado na Fase 2B com
`alembic current` e `alembic upgrade head` reais.

## Branch de validação online

| Item | Valor |
| --- | --- |
| Nome | `ritmo-online-migration-validation` |
| ID | `br-mute-flower-b85ezren` |
| Origem | `br-ancient-cloud-b8hp23th` (`main`), no LSN `0/1C52148` |
| Criada em | 2026-10-17T15:13:13Z |
| Estado | `ready`, vazia (0 tabelas em `public`) |

O esquema copiado da branch `main` foi removido **somente nesta branch** com
`DROP SCHEMA public CASCADE; CREATE SCHEMA public`. A branch `main` foi
reverificada em seguida e continuou com 20 tabelas e `alembic_version =
f4b7d2a91c03`, comprovando o isolamento. A branch de validação não contém dados
pessoais.

## Validação online do Alembic: pendente

Esta é a lacuna aberta da fase. `alembic upgrade head` **online**, conectado por
psycopg a esta branch, ainda não foi executado. Os motivos são objetivos:

- o agente não possui um cofre ou mecanismo de injeção de credenciais;
- obter a URL pelo MCP e repassá-la a um processo Python exigiria expô-la em
  argumento de shell, arquivo ou variável persistente, o que é proibido;
- a única alternativa executável sem exposição seria repetir o DDL offline pelo
  MCP, que não comprova o caminho online.

O estado atual prova a cadeia de migrations em PostgreSQL 18 de duas formas
(projeto novo em 2A e branch esvaziada em 2B), mas **não** prova o comando
Alembic conectado. A branch ficou deliberadamente vazia para receber esse teste.

### Procedimento seguro para concluir

Execute no terminal do próprio usuário, onde a URL nunca entra em histórico nem
em argumentos visíveis:

```powershell
Set-Location C:\Users\anton\OneDrive\Desktop\habitos-base\backend
$secure = Read-Host "Cole a DATABASE_URL da branch de validacao (nao sera exibida)" -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
)
$env:DATABASE_URL = $plain
$env:RITMO_DEBUG = "false"
$env:ALLOW_INSECURE_NO_ACCESS_TOKEN = "false"
$env:APP_ACCESS_TOKEN = "staging-validation-token"
$env:CORS_ORIGINS = "https://example.invalid"
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m alembic current
Remove-Item Env:DATABASE_URL, Env:RITMO_DEBUG, Env:ALLOW_INSECURE_NO_ACCESS_TOKEN, Env:APP_ACCESS_TOKEN, Env:CORS_ORIGINS
```

Depois, confirme no console do Neon, na branch de validação:

```sql
SELECT version_num FROM alembic_version;
SELECT count(*) FROM information_schema.tables
WHERE table_schema = 'public' AND table_name <> 'alembic_version';
```

Esperado: `f4b7d2a91c03` e `20`. Quando isso passar, a lacuna está fechada e a
branch pode ser descartada.

## Testes executados

- Conexão de leitura e escrita pelo MCP: OK.
- CRUD com dados fictícios e descartáveis: usuário, hábito, treino, sessão,
  inscrição e entrega de push inseridos e removidos; banco terminou vazio.
- Trigger de preenchimento: `push_deliveries.user_id = 0` foi substituído pelo
  `user_id` da inscrição e `sent_at` foi preenchido para `status = 'sent'`.
- Trigger de imutabilidade: `UPDATE push_deliveries SET user_id = ...` foi
  rejeitado com `push delivery user_id is immutable`.
- Índice único parcial: uma segunda sessão `active` para o mesmo usuário foi
  rejeitada com `duplicate key value violates unique constraint
  "uq_workout_sessions_active_user"`.

## Limites gratuitos consultados

Em 17 de outubro de 2026, a documentação oficial do Neon informava para o plano
Free:

- 100 projetos e 10 branches por projeto;
- 100 CU-hours por projeto por mês;
- 1 GB de armazenamento PostgreSQL por projeto, até 20 GB no total;
- 5 GB de transferência pública por projeto por mês;
- scale-to-zero após 5 minutos, sem possibilidade de desativar;
- histórico de restore de 6 horas;
- 1 snapshot manual;
- 1 dia de métricas.

Observação local: o endpoint deste projeto reporta
`branch_logical_size_limit` de 512 MB por branch. O limite efetivo deve ser
tratado como o menor entre esse valor e a franquia do projeto.

## Riscos e limites desta fase

- O Render MCP não está exposto nesta sessão. Nenhum serviço Render foi criado,
  alterado ou consultado por MCP.
- O pooler do Neon está desabilitado. Se for habilitado no futuro, o endpoint
  agrupado opera em modo transação e o psycopg 3 pode precisar de
  `prepare_threshold=None`. Hoje isso não se aplica.
- O backup local do SQLite continua em texto puro: `age` não está instalado nesta
  máquina, então não foi criada cópia criptografada.
- Nenhum dado pessoal, snapshot ou credencial foi enviado ao Neon.

## Informações para a Fase 2B

- Usar a `DATABASE_URL` do endpoint direto (não pooler), com `sslmode=require`.
- Guardar a URL como secret do provedor de API, nunca no repositório.
- Confirmar `alembic current` e `alembic upgrade head` online no staging.
- Considerar `RITMO_DEBUG=false` e `ALLOW_INSECURE_NO_ACCESS_TOKEN=false` no
  staging, com uma `APP_ACCESS_TOKEN` própria.
- Revalidar as franquias antes de publicar.

## Estado em 17 de outubro de 2026 (após a Fase 2B)

- Branch `main` (`br-ancient-cloud-b8hp23th`): 20 tabelas, `f4b7d2a91c03`, sem
  dados pessoais.
- Branch `ritmo-online-migration-validation` (`br-mute-flower-b85ezren`): vazia,
  reservada para o teste online do Alembic.
- Projeto continua no plano Free (`free_v3`), região `aws-us-east-1`.
- Consumo de compute permaneceu em 0.25 CU com scale-to-zero; sem upgrade.

