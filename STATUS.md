# Estado do Ritmo

Atualizado em 29 de julho de 2026.

## Estado confirmado

- A migração FastAPI + React foi preservada no commit local `0ce1d77`, na
  branch de segurança `safety/ritmo-fastapi-migration-20260729`.
- O trabalho de correção continua na branch
  `fix/ritmo-production-ready-20260729`.
- A arquitetura ativa do código é `backend/` + `frontend/`.
- A configuração Vercel da raiz aponta para o build de `frontend/` e inclui o
  fallback de rotas da SPA.
- Os workflows foram preparados para testar antes de qualquer publicação
  manual.
- Nenhum deploy foi executado por estas alterações.
- A versão antiga continua online em `https://habitos-base.vercel.app`.
- A versão antiga em produção deve permanecer intacta até a aprovação do
  preview, dos testes da API e da validação mobile.

## Validações locais concluídas

- Backend: `13 passed`, `pip check` sem dependências quebradas e `pip-audit`
  sem vulnerabilidades conhecidas.
- Frontend: `10 passed`, build Vite concluído e `npm audit` sem
  vulnerabilidades conhecidas.
- API real com SQLite isolado: 18 smoke tests aprovados, cobrindo chave de
  acesso, CRUD, check-in idempotente, estatísticas, treinos, reset e CORS.
- Persistência confirmada em um segundo processo lendo o arquivo SQLite.
- Ambiente limpo de produção do backend iniciado apenas com
  `requirements.txt`, sem dependências de teste.
- Interface validada em `390 x 844` e `1440 x 1000`, sem rolagem horizontal.
- Preview local do build final validado com rota direta e sem erros no console.

## Portões para considerar a migração pronta

- [x] Dependências instaladas a partir dos arquivos versionados.
- [x] Testes automatizados do backend aprovados.
- [x] Testes automatizados e build do frontend aprovados.
- [x] API iniciada com banco isolado e smoke tests aprovados.
- [ ] Segurança, CORS e persistência verificados no backend publicado.
- [ ] Preview Vercel apontando para a URL real da API.
- [x] Interface validada localmente em `390 x 844` e `1440 x 1000`.
- [x] Rotas internas da SPA funcionando por acesso direto no preview local.
- [ ] Produção promovida manualmente e verificada.

## Publicação

| Componente | Estado | Observação |
| --- | --- | --- |
| Versão antiga | Online e preservada | Não substituir antes do preview remoto |
| Backend FastAPI | Não publicado por este fluxo | Exige alvo, banco persistente, segredos e smoke tests |
| Frontend React | Não promovido por este fluxo | Primeiro publicar e aprovar um preview |

Consulte [DEPLOY.md](DEPLOY.md) para executar cada portão sem confundir build
local, preview e produção.
