# Estado do Ritmo

Atualizado em 17 de outubro de 2026.

## Resumo atual

A estabilização está commitada em `main` no commit `676c1f3` (2 de agosto de
2026) e o repositório local está sincronizado com `origin/main`. A produção
continua na versão `3d9d7b3` e não recebeu essa estabilização.

Em 17 de outubro de 2026, a API pública documentada não responde. O host
`https://supportive-warmth-production-dd70.up.railway.app` retorna HTTP 404 com
`{"message":"Application not found"}` e cabeçalho `x-railway-fallback: true`, o
que indica domínio sem serviço associado, não erro da aplicação. O frontend
responde HTTP 200, mas o bundle publicado ainda aponta para essa mesma API, de
modo que a aplicação está degradada.

| Componente | Estado em 17/10/2026 |
| --- | --- |
| Frontend público | `https://habitos-base.vercel.app` responde HTTP 200; o bundle publicado referencia a API indisponível |
| API pública | host antigo retorna HTTP 404 (`Application not found`); última implantação confirmada `3e4557c0-9ac2-4e7c-93a1-5acf02c458d6`, em 1º de agosto de 2026 |
| Banco de produção | PostgreSQL persistente; backup automático não confirmado |
| Modelo doméstico | Casa confiável: uma chave familiar e dois perfis organizacionais |
| Novas funcionalidades | Congeladas; a prioridade é recuperar a publicação |

## Implementado nesta estabilização (commit `676c1f3`)

- Backup PostgreSQL diário versionado, criptografado, retido por 30 dias e
  restaurado automaticamente em PostgreSQL isolado antes do upload.
- Exportador JSON dos dois perfis em `backend/scripts/export_profile_backups.py`.
- Monitor de `/health` a cada 15 minutos e lembrete mensal de restauração via
  GitHub Actions.
- Comunicação alinhada ao modelo de casa confiável, sem promessa de privacidade
  entre os dois perfis.
- Troca de perfil com remontagem completa, impedindo respostas antigas de
  atualizarem a árvore do perfil novo.
- Escopo único de compras compartilhadas aplicado a listas, histórico, ANAHÍ,
  push e backup v2.
- Atualização manual das compras e recarga ao voltar para o app.
- PostgreSQL protegido contra DDL de compatibilidade em runtime; produção usa
  apenas migrações Alembic.
- CI backend configurado com PostgreSQL 16 e release manual para staging ou
  produção, incluindo smoke tests positivos e negativos de autenticação.
- Fila de notificações durável com payload persistido, retries, recuperação de
  24 horas e estados `pending`, `sent` e `failed`.
- Corrigida a causa dos lembretes silenciosos: a aplicação dependia de um worker
  Railway separado que não estava ativo e o frontend desligava o fallback local
  apenas por encontrar uma inscrição. A única réplica da API agora executa o
  scheduler por padrão, publica diagnóstico em `/health`, expõe readiness estrita
  em `/ready` e mantém o fallback local quando o processador não está `ready`.
- Rejeições Web Push permanentes desativam somente a inscrição afetada; shutdown
  interrompe o lote depois da chamada atual e cada reminder usa um `Topic`
  idempotente para reduzir duplicatas após reinícios.
- A reconciliação VAPID usa a chave real exposta pelo navegador, preserva uma
  inscrição válida quando o storage local foi limpo e recria endpoints apenas
  quando há divergência ou inatividade confirmada.
- Constraints de banco para um único livro ativo e um único treino ativo por
  perfil.
- Mensagens corrigidas para offline, reset, código da casa e Google Gemini.
- Glossário de progresso e estados explícitos de carregamento e erro.
- Histórico antigo movido para `CHANGELOG.md`; runbook vigente em `DEPLOY.md`.

## Validação local

### Reexecutada em 17 de outubro de 2026

- Backend: `118 passed`, com 2 avisos de depreciação do Alembic sobre
  `path_separator`.
- Ruff: aprovado.
- Mypy: aprovado em 18 arquivos.
- Frontend: `139 passed` em 28 arquivos.
- ESLint: sem erros e com 12 avisos de hooks já conhecidos.
- TypeScript e build Vite: aprovados.
- `alembic upgrade head`: aprovado em SQLite temporário isolado, fora do
  repositório.
- Docker não está instalado nesta máquina; o build da imagem não foi executado
  nesta verificação.

### Registro histórico de 2 de agosto de 2026

- Migração `f4b7d2a91c03`: upgrade, check, downgrade e novo upgrade aprovados em
  SQLite vazio isolado; SQL PostgreSQL compilado e PostgreSQL 16 configurado no CI.
- Cobertura frontend: 68,97% de statements, 70,35% de branches e 71,03% de linhas.
- Workflows GitHub: 5 arquivos YAML validados localmente.
- Backup JSON local: dois perfis exportados com checksums válidos e restaurados
  com sucesso em banco SQLite isolado; backup de produção continua pendente.
- Release de produção agora exige snapshot JSON criptografado dos dois perfis
  antes da migração e aborta automaticamente se esse gate falhar.

## Correções da Fase 1 (17 de outubro de 2026)

- `backend/tests/test_security_health.py` iniciava a aplicação sem banco
  isolado. Com `RITMO_DEBUG=true`, o lifespan executava `init_db` e o seed no
  `./ritmo.db` do diretório atual. O teste agora usa um SQLite temporário e
  sobrescreve `get_db`. Verificado: a suíte completa não altera mais
  `backend/ritmo.db` e não cria banco no diretório de trabalho.
- `backend/.env.example` documenta desenvolvimento, testes e produção, incluindo
  o requisito de `RITMO_DEBUG=true` para o modo SQLite sem chave.
- `docs/LOCAL_SETUP.md` centraliza o procedimento local reproduzível.
- `.gitignore` passou a cobrir dumps, chaves e artefatos de criptografia.

## Staging PostgreSQL (17 de outubro de 2026)

Foi criado o projeto Neon Free `ritmo-pessoal-staging` na região
`aws-us-east-1`, isolado e sem dados pessoais. As quatro migrações Alembic foram
aplicadas e o banco está em `f4b7d2a91c03`; o esquema resultante coincide com os
modelos SQLAlchemy (20 tabelas, 156 colunas). A API pública continua indisponível
e nenhum serviço Render foi criado. Detalhes, limites gratuitos e pendências
estão em `docs/NEON_STAGING.md`.

## Preparação para staging (17 de outubro de 2026)

- Branch `chore/ritmo-free-preflight` publicada em `origin` no commit
  `734a3f4`, sem force push e sem alterar `main`.
- `main` permanece em `676c1f3`; não houve merge nem pull request.
- Branch Neon `ritmo-online-migration-validation` (`br-mute-flower-b85ezren`)
  criada e esvaziada para provar as migrations online.
- `alembic upgrade head` online ainda **não** foi executado: faltava um meio
  seguro de fornecer a credencial ao processo. O procedimento está em
  `docs/NEON_STAGING.md`.
- O serviço Render de staging não foi criado. O MCP do Render não está exposto
  neste ambiente e não há credencial disponível; o roteiro manual está em
  `DEPLOY.md`.

## Bloqueios externos

Verificado em 17 de outubro de 2026:

- [x] Ambientes GitHub `backend-production` e `database-backups` existem.
- [ ] Cadastrar `RAILWAY_TOKEN` e `RAILWAY_PROJECT_ID` em `backend-production`.
  Sem eles, a execução `30730790617` (2 de agosto de 2026) falhou no job
  *Publish backend*.
- [ ] Cadastrar `DATABASE_BACKUP_URL` e `BACKUP_AGE_RECIPIENT` em
  `database-backups`. O ambiente existe, mas está sem secrets.
- [ ] Reativar os workflows `Production health monitor`, `Daily PostgreSQL backup`
  e `Monthly restore reminder`, que estão `disabled_inactivity`.
- [ ] Executar `Daily PostgreSQL backup` e confirmar dump, restauração isolada,
  criptografia e retenção do artefato.
- [ ] Exportar o JSON atual dos perfis com a chave de produção.
- [ ] Criar projetos Sentry e configurar DSNs no backend e na Vercel.
- [ ] Restabelecer a API pública; o host antigo não tem serviço associado.
- [ ] Criar `backend-staging`, PostgreSQL isolado, preview Vercel e proteções no
  GitHub.
- [ ] Aplicar a migração em staging e validar backup, API, worker, retries e
  constraints antes de produção.
- [ ] Parear os perfis e validar troca, compras e push em dois aparelhos reais.
- [ ] Instalar a PWA e testar microfone, atalhos e Web Push em Android e iPhone.

Issues abertas no repositório: `#1` (API indisponível) e `#2` (validação de
restauração mensal).

O `backend/ritmo.db` local é anterior ao Alembic e continua atendido pela camada
de compatibilidade SQLite. Em 17 de outubro de 2026 foi confirmado que ele
possui uma tabela `alembic_version` vazia, sem revisão registrada. Ele não foi
migrado nem estampado. Durante esta sessão, uma execução da suíte aplicou DDL de
compatibilidade nesse arquivo, conforme registrado em Limitações; as contagens
de dados conferem com o export de 2 de agosto de 2026.

## Limitações do ambiente local

- `backend/.env` é ignorado pelo Git. Em 17 de outubro de 2026 ele não continha
  `RITMO_DEBUG` nem `DATABASE_URL`; as duas linhas foram acrescentadas
  localmente, sem alterar o restante do arquivo. Sem `RITMO_DEBUG=true`, a
  validação de `config.py` recusa `ALLOW_INSECURE_NO_ACCESS_TOKEN=true` com
  SQLite e comandos como `alembic current` falham antes de abrir o banco. O
  procedimento seguro para completar o arquivo está em `docs/LOCAL_SETUP.md`.
- Docker não está instalado nesta máquina.
- Em 17 de outubro de 2026, antes da correção de isolamento acima, uma execução
  da suíte aplicou DDL de compatibilidade em `backend/ritmo.db`. As contagens de
  dados conferem com o export de 2 de agosto de 2026 (2 perfis, 14 treinos, 2
  sessões); nenhum registro foi removido. Um ponto de restauração foi copiado
  para fora do repositório e do OneDrive.
- Os snapshots em `.ritmo-backups/` não foram alterados.

## Próxima prioridade

1. Revisar as mudanças da Fase 1 e executar o CI sem publicar.
2. Definir a arquitetura gratuita (Render Free + Neon Free + Vercel Hobby) e
   revalidar as franquias antes de provisionar.
3. Recriar a API em ambiente gratuito com PostgreSQL gerenciado e variáveis
   configuradas fora do Git.
4. Migrar o SQLite legado com backup, importação validada e rollback.
5. Ativar backup independente, Sentry e monitoramento.
6. Promover o frontend somente após staging e aceitação de dois perfis.

## Critério de conclusão

A estabilização estará concluída quando houver um backup verificado nas últimas
24 horas, restauração isolada aprovada, Sentry e monitor ativos, scheduler sem
entregas silenciosamente perdidas e vinte trocas de perfil sob rede lenta sem
exibição ou mutação de dados do perfil anterior.
