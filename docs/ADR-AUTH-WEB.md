# ADR: autenticação do navegador no Ritmo

Status: implementado localmente, não publicado.
Data: 17 de outubro de 2026.
Branch: `feat/ritmo-browser-auth`, a partir de `origin/chore/ritmo-free-preflight`.

## Contexto

O Ritmo nasceu como um app de casa confiável com uma única chave familiar.
O frontend pedia essa chave uma vez, guardava em `localStorage` e a enviava em
`X-Ritmo-Key` em todas as chamadas. O backend comparava com `APP_ACCESS_TOKEN`
usando `compare_digest` e aplicava lockout por IP.

Isso funcionava, mas tinha três problemas:

1. A chave era **administrativa e global**. Quem a obtivesse lia e alterava os
   dados de todos os perfis.
2. Ela vivia em `localStorage`, acessível a qualquer script na origem.
3. Nenhuma rota sabia **quem** era o chamador: o `user_id` vinha da URL, então o
   cliente escolhia qual perfil ler ou alterar.

## Alternativas avaliadas

### A. Sessão em cookie HttpOnly com CSRF (escolhida)

Sessão opaca gravada em `user_sessions`, cookie `HttpOnly` + `Secure` +
`SameSite=Lax`, token CSRF separado e obrigatório em métodos mutáveis.

- Prós: nenhum segredo no JavaScript; logout revoga de verdade; o servidor
  conhece o perfil; funciona com o proxy same-origin.
- Contras: exige tabela, migration, proteção CSRF e validação de origem.

### B. Bearer token emitido no login

Token assinado ou opaco guardado em `sessionStorage`/memória.

- Prós: simples para clientes não-browser.
- Contras: qualquer token legível por JS é exposto a XSS; sem cookie HttpOnly o
  ganho de segurança é menor; revogação exige lista de bloqueio de qualquer
  forma. Rejeitada para o navegador.

### C. Proxy same-origin na Vercel + sessão

Mantém o cookie first-party e elimina CORS entre frontend e API.

- É compatível com a arquitetura atual (`vercel.json` já usa `rewrites`) e é o
  **complemento recomendado** da opção A. Não substitui a autenticação.

## Decisão

Opção **A**, com a opção **C** como alvo de implantação.

### Credenciais

- Cada perfil ganhou `users.password_hash` (Argon2id via `argon2-cffi`).
- Não existe cadastro público. O hash é definido por um operador com
  `python -m scripts.set_profile_password --profile-id <perfil>`.
- A senha é lida de prompt ou stdin, nunca de argumento de linha de comando.
- `password_hash` é anulável para não quebrar perfis existentes; um perfil sem
  hash simplesmente não consegue entrar.

### Sessão

- `user_sessions` guarda apenas o SHA-256 do token e do CSRF.
- Token novo a cada login (previne fixação de sessão).
- Expiração absoluta (`SESSION_TTL_HOURS`, padrão 720 h).
- Logout grava `revoked_at` e limpa os cookies.
- Sessão sobrevive a reinício e suspensão da instância, porque o estado está no
  PostgreSQL e não na memória do processo.

### CSRF e origem

- O token CSRF vai num cookie legível e deve ser ecoado em `X-CSRF-Token` em
  `POST`, `PUT`, `PATCH` e `DELETE`.
- `Origin` é validada contra `CORS_ORIGINS` quando presente.
- `SameSite=Lax` é defesa em profundidade, não a única barreira.

### Autorização

- `Principal` distingue `session` de `api_key`.
- Sessão só acessa `/api/users/{user_id}` do próprio perfil.
- Rotas por id de recurso (`/api/habits/{id}`, `/api/shopping-lists/{id}`,
  `/api/reading-books/{id}`, `/api/workout-sessions/{id}`, etc.) resolvem o dono
  no banco; recurso inexistente continua 404 para não revelar ids.
- Compras compartilhadas usam o par gravado no banco, nunca um id do cliente.
- A chave de API continua válida para scripts, backups e testes. Ela **não** é
  usada pelo navegador e não é embutida no bundle.

## Consequências

- Nova migration `a1c4e9f7b2d5` (coluna + tabela + índices). Não aplicada em
  nenhum banco remoto nesta fase.
- `argon2-cffi` passa a ser dependência de runtime.
- O frontend troca a tela de código por perfil + senha, e a troca de perfil passa
  a exigir a senha do outro perfil.
- `GET /api/auth/profiles` devolve **apenas** um identificador opaco
  (`login_id`, HMAC-SHA256 truncado) e um rótulo posicional (`Perfil 1`,
  `Perfil 2`). Nenhum nome, inicial, tema ou slug de perfil sai sem
  autenticação. O `login_id` é resolvido no login; o `profile_id` bruto
  continua aceito para scripts, protegido pela senha e pelo lockout.
- Sessões antigas continuam válidas após troca de senha. Revogação imediata
  exige apagar as linhas de `user_sessions` do perfil.

## Limitações conhecidas

- Não há fluxo de "esqueci a senha"; a recuperação é operacional.
- Não há segundo fator.
- `GET /api/users` devolve apenas o perfil da sessão. A lista completa fica
  restrita à chave de API.
- A chave de API segue com acesso total ao banco da casa; ela precisa ser longa,
  rotacionável e nunca ir para o navegador.
- Sem proxy same-origin, o cookie passa a ser de terceiros e o navegador pode
  bloqueá-lo. Isso não foi testado em produção.

## Implantação futura (Fase 2D)

1. Aplicar `alembic upgrade head` no Neon de staging (branch de validação
   primeiro).
2. Definir `SESSION_COOKIE_SECURE=true` e `SESSION_COOKIE_SAMESITE=lax` no
   serviço.
3. Provisionar as senhas dos perfis com o script, dentro do ambiente.
4. Publicar a API e adicionar na Vercel um rewrite antes do catch-all:

   ```json
   { "source": "/api/:path*", "destination": "https://<api-host>/api/:path*" }
   ```

5. Manter `VITE_API_URL` vazio nesse cenário, para o navegador usar a mesma
   origem.
6. Validar login, CSRF, logout e troca de perfil com dados fictícios.

## Revisão adversarial (Fase 2D)

A implementação foi relida com cenários de ataque concretos. Cada linha abaixo
tem um teste automatizado em `backend/tests/test_auth_adversarial.py` ou em
`backend/tests/test_auth.py`.

### Matriz de riscos

| Severidade | Achado | Evidência | Correção | Teste |
| --- | --- | --- | --- | --- |
| Crítico | O script de senha caía no default `sqlite:///./ritmo.db` quando `DATABASE_URL` não estava no ambiente, porque `get_settings()` lê `backend/.env`. Rodá-lo sem variável escreveria no banco legado. | `scripts/set_profile_password.py` original + `config.py` (`database_url` fallback) | exige `DATABASE_URL` no ambiente e recusa `ritmo.db` sem `--allow-legacy-db` | `test_cli_requires_explicit_database_url`, `test_cli_refuses_the_legacy_database` |
| Alto | `GET /api/users` devolvia todos os perfis para qualquer sessão autenticada. | `routers/users.py` original | sessão recebe apenas o próprio perfil; chave de API mantém a lista completa | `test_users_endpoint_hides_other_profiles_from_session` |
| Alto | Trocar a senha não revogava sessões existentes. | `revoke_all_sessions` existia sem chamadas | o script revoga todas as sessões do perfil | `test_password_rotation_revokes_existing_sessions`, `test_cli_sets_only_the_target_profile_and_revokes_sessions` |
| Alto | `Sec-Fetch-Site: cross-site` não era considerado; uma requisição cross-site sem `Origin` dependia apenas do token. | `security.enforce_origin` | rejeita `cross-site` antes de olhar o token | `test_cross_site_fetch_metadata_is_rejected` |
| Médio | O campo `password` do login não tinha limite superior; um corpo enorme virava custo de CPU no Argon2. | `schemas/auth.py` | `min_length=1`, `max_length=256` | coberto pelo schema |
| Alto | `GET /api/auth/profiles` devolvia nome real e o próprio slug do perfil (`profile_id`), que é um primeiro nome, sem autenticação. Qualquer pessoa com o domínio da API enumerava a casa. | `routers/auth.py`, `schemas/auth.py` | handle opaco por HMAC + rótulo posicional; nomes só aparecem em `/api/users`, autenticado | `test_profile_directory_is_anonymous`, `test_login_accepts_the_anonymous_handle`, `test_login_handle_does_not_resemble_the_profile_id` |
| Médio | `enforce_profile_scope` fazia `int()` sem guarda e podia devolver 500 com um `user_id` não numérico. | `security.py` | conversão protegida; retorna 403 | `test_non_numeric_profile_id_is_forbidden_not_a_server_error` |
| Baixo | `CSRF_EXEMPT_PATHS` é inalcançável: o login não passa por `get_principal`. | leitura de `security.py` e `routers/auth.py` | mantido apenas como documentação; o login tem `enforce_origin` | `test_login_errors_do_not_leak_internals` |
| Baixo | O lockout é por processo e usa `request.client.host`; atrás de proxy o IP é o do proxy. | `security.py`, `rate_limit.py` | documentado; não protege contra força bruta distribuída | — |

### O que foi verificado e está correto

- **Sessão**: `secrets.token_urlsafe(32)`; o banco guarda só SHA-256; token novo a
  cada login; expiração absoluta conferida no servidor; logout grava
  `revoked_at`; token revogado nunca é aceito de novo.
- **CSRF**: é um token sincronizado com a linha de sessão, não um double-submit
  simples. O `csrf_hash` fica na mesma linha do `token_hash`; um token de outra
  sessão falha mesmo com cookie de sessão válido, e forjar o cookie `ritmo_csrf`
  não ajuda.
- **Cookies**: `HttpOnly` na sessão, `Secure` configurável, `SameSite=Lax`,
  `Path=/`, sem `Domain`. Com `Secure=true` o nome recebe o prefixo `__Host-`.
- **Isolamento**: sessão só alcança `/api/users/{id}` do próprio perfil e as
  rotas por id de recurso resolvem o dono no banco; recursos inexistentes
  continuam 404.
- **Senhas**: Argon2id, comparação de hash pela própria biblioteca, hash nulo
  tratado com verificação fictícia para equalizar tempo, mensagem idêntica para
  perfil inexistente e senha errada.

### Limitações aceitas nesta fase

- Sem MFA e sem recuperação de senha autoatendida.
- Sem limite de sessões simultâneas por perfil.
- `last_seen_at` é gravado na criação e não é atualizado.
- A chave de API continua com acesso total ao banco da casa e não é rotacionável
  pela interface.
