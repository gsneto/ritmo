# Histórico do Ritmo

Este arquivo preserva entregas e rodadas antigas. O estado operacional vigente
fica em `STATUS.md`.

## 1º de agosto de 2026 - suíte de produto em produção

- Commit de produção: `3d9d7b3`.
- Backend Railway: `3e4557c0-9ac2-4e7c-93a1-5acf02c458d6`.
- Frontend Vercel: `dpl_CrRMC1Wo3B8TrFiUYV9aVAsanCRw`.
- Entregues selos de sequência, atalhos PWA, calendário `.ics`, card de treino
  em PNG, briefing ANAHÍ, insights cruzados, voz e compras compartilhadas.
- Validação registrada: 70 testes backend, 117 frontend, Ruff, mypy, build,
  auditorias de dependências e Alembic aprovados.
- PostgreSQL persistente, chave de acesso, CORS restrito e VAPID confirmados.
- Permaneceram pendentes Sentry real, backup automático, monitor externo,
  pareamento em dois aparelhos e testes físicos de iPhone/Android.

## 1º de agosto de 2026 - auditoria de arquitetura incorporada

- Adicionados rate limit, lockout, integrações opcionais Sentry, Error Boundary,
  cobertura no CI, baseline Alembic e extrações iniciais de hooks.
- Validação intermediária registrada: 61 testes backend e 94 frontend.
- TypeScript 7 foi avaliado e adiado por incompatibilidade do ecossistema de lint.

## 29 de julho de 2026 - primeira publicação da arquitetura atual

- Frontend Vercel, backend FastAPI no Railway e PostgreSQL gerenciado colocados
  em produção.
- Validação registrada: 43 testes backend, 44 frontend, build e auditoria de
  dependências aprovados.
- API autenticada, persistência, backup/restauração, CORS, cabeçalhos de
  segurança, PWA e viewport de iPhone foram exercitados.
- A versão anterior permaneceu recuperável no commit `6cd2766`.
