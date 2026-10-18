# Migração dos perfis para o PostgreSQL

Documento de preparação. A importação real ainda **não** foi executada.

## 1. Inventário das fontes locais

Verificado em 18 de outubro de 2026, apenas por metadados e contagens.

### `backend/ritmo.db` (SQLite legado)

| Propriedade | Valor |
| --- | --- |
| Bytes | 393.216 |
| SHA-256 | `9663519E576B2D15351044E844D517194A2C1B16AE92A025838178290FA1EA3E` |
| `integrity_check` | `ok` |
| Violações de FK | 0 |
| Tabelas | 22 |
| `alembic_version` | existe, **0 linhas** (anterior ao Alembic) |
| Colunas de `users` | `id, profile_id, name, initials, theme, briefing_enabled, briefing_time, created_at` — **sem `password_hash`** |

Contagens não nulas:

| Tabela | Registros |
| --- | --- |
| `users` | 2 |
| `workouts` | 14 |
| `exercises` | 26 |
| `workout_sessions` | 2 |
| `workout_session_exercises` | 7 |
| `workout_set_logs` | 22 |

Vazias: `habits`, `habit_check_ins`, `tasks`, `shopping_lists`, `shopping_items`,
`shopping_monthly_budgets`, `shopping_pairs`, `reading_books`, `reading_notes`,
`reading_sessions`, `workout_exercise_preferences`, `anahi_briefings`,
`push_subscriptions`, `push_deliveries`.

### `.ritmo-backups/2026-08-02T00-39-39Z/`

| Arquivo | Bytes | SHA-256 (prefixo) |
| --- | --- | --- |
| `manifest.json` | 512 | `EABD79B3…` |
| `ritmo-antonio-…json` | 9.729 | `88C46D08…` |
| `ritmo-itayna-…json` | 3.409 | `15C456F4…` |

Formato: `version: 2`, `app: "Ritmo"`, `exported_at` presente, `profile` com
`name/initials/theme`. O `manifest.json` traz, por perfil, `profile_id`,
`user_id`, `file` e `sha256`.

Entidades no JSON: `habits`, `tasks`, `shopping_lists` (com itens e
`ownership`), `shopping_budgets`, `workouts` (com exercícios), `workout_sessions`
(com exercícios e séries), `workout_preferences`, `reading_books` (com sessões e
notas).

Contagens: 7 treinos por perfil (13 exercícios cada), 2 sessões no primeiro
perfil com 7 exercícios de sessão e 22 séries, 0 em todo o resto.

## 2. Fonte de verdade por entidade

As duas fontes descrevem **o mesmo estado**: as contagens do JSON coincidem
exatamente com o SQLite (14 treinos, 26 exercícios, 2 sessões, 7 exercícios de
sessão, 22 séries). Não há dados exclusivos do SQLite fora das tabelas vazias.

| Entidade | Fonte autoritativa | Motivo |
| --- | --- | --- |
| Identidade do perfil (`profile_id`) | `manifest.json` | único identificador estável; o documento de perfil não o repete |
| Nome, iniciais, tema | JSON (`profile`) | exportado pela própria aplicação |
| Hábitos, tarefas, compras, orçamentos | JSON | completo e validado por `schemas/backup.py` |
| Treinos e exercícios | JSON | idem |
| Sessões, exercícios de sessão, séries | JSON | idem; o JSON contém o detalhe completo |
| Preferências de treino | JSON | idem |
| Leitura (livros, sessões, notas) | JSON | idem |
| Par de compras compartilhadas | SQLite (`shopping_pairs`) | estado doméstico, não faz parte do backup por perfil; **vazio** hoje |
| Senhas | nenhuma fonte | provisionadas por operador, nunca importadas |
| Sessões web, inscrições push, outbox, briefings | nenhuma | específicas do ambiente; **vazias** hoje |

Regra de precedência: o JSON vence para conteúdo de perfil. O SQLite só seria
consultado para `shopping_pairs`, e apenas se tivesse linhas.

Não há divergência a resolver: as contagens são idênticas e o JSON foi gerado
pelo próprio endpoint de exportação.

## 3. Importador

O importador é o caminho que já existe e é exercitado pela aplicação:

`PUT /api/users/{user_id}/backup` → `routers/backup.py::restore_user_backup`.

Por que reutilizar em vez de escrever outro:

- valida o documento inteiro com `schemas/backup.py` antes de tocar no banco
  (unicidade de `source_id`, referências internas, um único livro e uma única
  sessão ativos, par `checked_at`/`price_cents`, faixas de valores);
- executa tudo em uma transação com `commit`/`rollback`;
- é o mesmo código que a aplicação usa em produção, então não há dois
  comportamentos para manter.

Comportamento relevante:

- **Substitui** o conteúdo do perfil: apaga hábitos, tarefas, treinos, sessões,
  livros e listas antes de reinserir.
- **Ignora** listas com `ownership: "shared"` — elas pertencem ao par doméstico,
  não ao perfil.
- **Não** cria nem altera `password_hash`.
- É idempotente por construção: reimportar o mesmo documento produz o mesmo
  estado, não uma duplicação.

### Ferramenta de backup

`backend/scripts/backup_local_data.py`:

```powershell
$env:RITMO_BACKUP_PASSPHRASE = '<frase longa>'
python -m scripts.backup_local_data create --output-dir <dir> `
    --sqlite backend/ritmo.db --json-dir .ritmo-backups
python -m scripts.backup_local_data verify <arquivo>.tar.gz.enc <arquivo>.manifest.json
Remove-Item Env:RITMO_BACKUP_PASSPHRASE
```

- AES-256-GCM com chave derivada por scrypt (`n=32768`, `r=8`, `p=1`);
- o tar/gzip existe apenas em memória — nada em texto puro no disco;
- `verify` descriptografa em diretório temporário privado, compara todos os
  SHA-256, roda `integrity_check` nos SQLite restaurados e apaga o temporário;
- recusa sobrescrever backup existente.

## 4. Ensaio realizado

`backend/tests/test_migration_dry_run.py` importa dois documentos sintéticos
com o grafo completo (hábitos com check-ins, tarefas recorrentes com pai, listas
com itens e uma lista compartilhada, orçamento, treino com exercícios, sessão com
séries, preferência, livro com sessão e nota) em um SQLite temporário.

Resultados verificados:

| Verificação | Resultado |
| --- | --- |
| Grafo completo gravado | 2 hábitos, 2 tarefas, 1 lista, 1 orçamento, 1 treino, 1 sessão, 1 preferência, 1 livro |
| Lista `shared` não reimportada | confirmado |
| Segundo perfil intocado pelo primeiro import | confirmado |
| Reimportação idempotente | contagens idênticas |
| `source_workout_id` órfão | 422, nada gravado |
| `source_id` duplicado | 422 |
| Falha no `commit` | rollback preserva o estado anterior |
| Nenhuma credencial criada | `password_hash` continua nulo |
| Fuso preservado | `started_at` mantém o instante UTC |

## 5. Senhas dos perfis

Procedimento por perfil, em etapa posterior e com o operador presente:

```powershell
Set-Location backend
$env:DATABASE_URL = '<url do destino>'
python -m scripts.set_profile_password --profile-id <perfil>
Remove-Item Env:DATABASE_URL
```

O script exige `DATABASE_URL` explícita, recusa `ritmo.db` sem
`--allow-legacy-db`, lê a senha sem eco e revoga as sessões existentes do perfil.

Os dois perfis a provisionar são os identificados no `manifest.json`. Nenhuma
senha é definida nesta fase.

## 6. Cutover

Executar somente após revisão deste documento e confirmação do operador.

1. **Backup restaurável**: rodar `create` e `verify`; guardar o `.manifest.json`
   também fora da máquina, porque ele não é criptografado.
2. **Destino confirmado**: identificar a branch Neon pelo ID e conferir que é a
   escolhida (não `main`, não outra).
3. **Estado inicial**: registrar contagens agregadas do destino.
4. **Exportação**: usar os JSONs já validados por SHA-256 contra o manifesto.
5. **Importação**: para cada perfil, `PUT /api/users/{id}/backup`, em ordem,
   parando no primeiro erro.
6. **Verificação**: contagens por tabela e por perfil; nenhuma linha órfã.
7. **Hashes canônicos**: comparar um resumo estável dos dados migrados
   (contagens + `sha256` de campos ordenados, sem senhas nem tokens).
8. **Senhas**: provisionar individualmente.
9. **Smoke tests**: login, leitura, escrita, isolamento entre perfis.
10. **Encerrar o uso do destino** antes de qualquer reversão: bloquear escrita
    na API (por exemplo, remover a `APP_ACCESS_TOKEN` usada pelo frontend ou
    parar o serviço) para que nenhuma gravação nova aconteça durante o rollback.

## 7. Rollback

Reverter `DATABASE_URL` **não é rollback suficiente** se houve gravações no
destino depois do cutover: essas escritas não existem no SQLite e seriam
descartadas silenciosamente.

Procedimento:

1. Bloquear escrita no destino e registrar o instante do bloqueio.
2. Exportar o perfil pela API (`GET /api/users/{id}/backup`) para capturar o que
   foi escrito depois do cutover. Esse documento vira a fonte das gravações
   posteriores.
3. Restaurar o backup criptografado em ambiente isolado e rodar `verify`.
4. Repontar `DATABASE_URL` para o banco anterior, ou restaurar o dump no banco
   de destino se a decisão for continuar nele.
5. Reconciliar as gravações do passo 2: reimportá-las com o mesmo endpoint, que
   substitui o conteúdo do perfil pelo documento mais recente.
6. Confirmar contagens e smoke tests.

Condições para interromper antes de concluir:

- `verify` do backup falhar;
- contagens do destino não baterem com o esperado;
- qualquer 422 durante a importação;
- divergência de hash canônico;
- falha de login após o provisionamento.

Em qualquer um desses casos, parar, não apagar nada e relatar.

## 8. Estado da execução em 18 de outubro de 2026

### Concluído

| Item | Evidência |
| --- | --- |
| Backup localizado e íntegro | `ritmo-backup-20261018T152355Z.tar.gz.enc`, SHA-256 `293B9314…3DD98`, igual ao manifesto |
| Restauração verificada | `files_verified: 4`, `sqlite_integrity_ok: 1`, `VERIFY OK` |
| Frase recuperada | DPAPI da conta Windows atual |
| Fontes conferidas | manifesto com 2 perfis, ambos com hash conferido; contagens idênticas às da Fase 2G |
| Destino identificado | projeto `autumn-recipe-20127160`, branch `br-mute-flower-b85ezren`, revisão `a1c4e9f7b2d5`, 21 tabelas |
| Destino limpo | 0 usuários, 0 sessões, 0 treinos |
| Privacidade do login | `GET /api/auth/profiles` passou a devolver só `login_id` + `Perfil N`; verificado na API publicada em `b5b45a1` |
| Ensaio do importador | 8 testes com fixtures sintéticas, todos aprovados |

### Pendente — bloqueio real

A frase de recuperação **não** está guardada fora desta máquina. Enquanto isso
não acontecer, nenhum dado pessoal é transferido: perder a máquina tornaria o
backup irrecuperável e não haveria rollback.

Pré-requisito para a Fase 2H:

1. Copiar a frase para um gerenciador de senhas (ou papel guardado fora de casa).
2. Confirmar que ela pode ser lida de outro dispositivo.
3. Só então executar a importação descrita nas seções 6 e 7.

### Verificação de privacidade executada em produção

Com dois perfis sintéticos inseridos temporariamente na branch de staging:

```
GET /api/auth/profiles
[{"login_id":"4df5a32ea879b1b9","label":"Perfil 1"},
 {"login_id":"31a28ab5ef732f3e","label":"Perfil 2"}]
```

Sem nomes, iniciais, temas ou slugs. Login pelo `login_id` devolveu 200. Os
perfis sintéticos foram removidos em seguida; o banco voltou a 0 usuários.

## 9. Limitações conhecidas

- O backup criptografado usa uma frase gerada localmente e protegida por DPAPI
  na conta Windows atual. Se a máquina for perdida sem que a frase tenha sido
  copiada para um gerenciador de senhas, o arquivo é irrecuperável. Copiar a
  frase para fora da máquina é responsabilidade do operador.
- O `manifest.json` não é criptografado: contém nomes de arquivo e hashes, não
  conteúdo.
- `restore_user_backup` substitui o conteúdo do perfil; não faz merge. É o
  comportamento desejado para cutover, mas significa que importar um documento
  desatualizado apaga dados mais novos.
