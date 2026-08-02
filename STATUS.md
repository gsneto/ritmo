# Estado do Ritmo

Atualizado em 2 de agosto de 2026.

## Resumo atual

O Ritmo continua online na versão de produção do commit `3d9d7b3`. A
estabilização descrita abaixo está implementada no working tree, mas ainda não
foi publicada. Ela deve passar por staging antes de chegar à produção.

| Componente | Estado atual |
| --- | --- |
| Frontend público | `https://habitos-base.vercel.app`, última implantação confirmada `dpl_CrRMC1Wo3B8TrFiUYV9aVAsanCRw` |
| API pública | `https://supportive-warmth-production-dd70.up.railway.app`, última implantação confirmada `3e4557c0-9ac2-4e7c-93a1-5acf02c458d6` |
| Banco de produção | PostgreSQL persistente, ainda sem backup automático confirmado |
| Modelo doméstico | Casa confiável: uma chave familiar e dois perfis organizacionais |
| Novas funcionalidades | Congeladas até 15 de agosto de 2026 para estabilização e uso real |

## Implementado nesta estabilização

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

- Backend: `118 passed` (2 avisos de depreciação do Alembic).
- Ruff: aprovado.
- Mypy configurado: aprovado.
- Migração `f4b7d2a91c03`: upgrade, check, downgrade e novo upgrade aprovados em
  SQLite vazio isolado; SQL PostgreSQL compilado e PostgreSQL 16 configurado no CI.
- Frontend: `139 passed` em 28 arquivos.
- Cobertura frontend: 68,97% de statements, 70,35% de branches e 71,03% de linhas.
- TypeScript e build Vite: aprovados.
- ESLint: sem erros e com 12 avisos de hooks já conhecidos.
- Workflows GitHub: 5 arquivos YAML validados localmente.
- Backup JSON local: dois perfis exportados com checksums válidos e restaurados
  com sucesso em banco SQLite isolado; backup de produção continua pendente.
- Release de produção agora exige snapshot JSON criptografado dos dois perfis
  antes da migração e aborta automaticamente se esse gate falhar.

## Bloqueios externos

- [ ] Criar o ambiente GitHub `database-backups` e cadastrar
  `DATABASE_BACKUP_URL` e `BACKUP_AGE_RECIPIENT`.
- [ ] Executar `Daily PostgreSQL backup` e confirmar dump, restauração isolada,
  criptografia e retenção do artefato.
- [ ] Exportar o JSON atual dos perfis Antonio e Itayna com a chave de produção.
- [ ] Criar projetos Sentry e configurar DSNs no Railway e na Vercel.
- [ ] Publicar os workflows para ativar o monitor de saúde e o lembrete mensal.
- [ ] Criar `backend-staging`, PostgreSQL isolado, preview Vercel e proteções no
  GitHub.
- [ ] Aplicar a migração em staging e validar backup, API, worker, retries e
  constraints antes de produção.
- [ ] Parear os perfis e validar troca, compras e push em dois aparelhos reais.
- [ ] Instalar a PWA e testar microfone, atalhos e Web Push em Android e iPhone.

O `backend/ritmo.db` local é anterior ao Alembic e continua atendido pela camada
de compatibilidade SQLite. Ele não foi marcado como migrado porque
`alembic check` detectou diferenças históricas; os dois perfis locais foram
exportados e restaurados com sucesso antes dessa verificação.

## Próxima prioridade

1. Revisar estas alterações e executar o CI sem publicar.
2. Ativar backup e Sentry antes de qualquer migração de produção.
3. Criar staging com uma única réplica da API e scheduler embutido.
4. Publicar em staging e executar o roteiro de aceitação de dois perfis.
5. Promover para produção somente após backup restaurável e staging aprovados.
6. Usar o app por duas semanas sem novas features e registrar somente defeitos.

## Critério de conclusão

A estabilização estará concluída quando houver um backup verificado nas últimas
24 horas, restauração isolada aprovada, Sentry e monitor ativos, scheduler sem
entregas silenciosamente perdidas e vinte trocas de perfil sob rede lenta sem
exibição ou mutação de dados do perfil anterior.
