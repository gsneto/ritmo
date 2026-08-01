# Estado do Ritmo

Atualizado em 29 de julho de 2026.

## Auditoria em andamento — 1º de agosto de 2026

Esta entrega está na branch `chore/auditoria-2026-08` e ainda não foi publicada
na Vercel/Railway. Ela acrescenta rate limit e lockout, Sentry opcional, Error
Boundary, lint/cobertura no CI, React 19.2.8, Lucide compatível, dependências
backend atualizadas, hooks de domínio e baseline Alembic.

- Backend: 61 testes, Ruff, mypy, pip-audit e `alembic check` aprovados; cobertura
  de 86%.
- Frontend: 94 testes, lint e build aprovados; cobertura de statements de 64,64%.
- TypeScript 7 foi testado em branch isolada e não foi adotado por incompatibilidade
  atual do `typescript-eslint`.
- Antes de publicar, validar visualmente React 19 nas telas principais e registrar
  o baseline do banco Railway existente conforme `DEPLOY.md`.

## Produção confirmada

- Frontend público: [https://habitos-base.vercel.app](https://habitos-base.vercel.app)
- API: [health check público](https://supportive-warmth-production-dd70.up.railway.app/health)
- Frontend publicado na Vercel com estado `Ready`, deployment
  `dpl_Au6mrpnStvhKN5aAdTzxd3FHVuzE`.
- Backend FastAPI publicado no Railway com PostgreSQL persistente.
- `RITMO_DEBUG=false`, chave de acesso forte, CORS limitado ao domínio público
  e Web Push habilitado com um par VAPID exclusivo.
- Código da aplicação publicado a partir de `cf209eb` na branch
  `feature/ritmo-complete-assistant-20260729`.
- A versão anterior permanece recuperável no histórico Git, no commit
  `6cd2766`.

## O que esta branch acrescenta

- Assistente **Hoje** com próxima ação, agenda, compra, treino e leitura.
- Hábitos por dias da semana e tarefas diárias, semanais ou mensais.
- Compras e finanças com categorias, orçamentos, quantidade, preço unitário,
  recorrência, comparação mensal, histórico de preço e CSV.
- Treino guiado com cronômetro, descanso, cargas, repetições, recordes,
  histórico e sugestão de progressão.
- Biblioteca com vários livros, porcentagem, sessões, diário e notas por página.
- PWA instalável, identidade indígena no ícone, tela offline e suporte a Web
  Push com agendador no backend.
- Formulários móveis sem zoom automático, navegação inferior oculta durante a
  digitação e nova compra sem abertura involuntária do teclado.
- Compra planejada com atalhos Hoje, Amanhã e Outra data; biblioteca antes dos
  resumos; saudação com arco e flecha e tema no cabeçalho.
- Backup JSON completo e restauração atômica por perfil.
- Migrações aditivas/preservadoras para os bancos SQLite existentes.

## Validações concluídas

- Backend: `43 passed`.
- Frontend: `44 passed` e build Vite de produção concluído.
- `pip-audit` e `npm audit`: nenhuma vulnerabilidade conhecida.
- API de produção: `/health` respondeu HTTP 200; uma requisição sem chave foi
  recusada com 401 e uma requisição autorizada retornou os dois perfis.
- Hábitos, tarefas, treinos, compras, leitura, estatísticas e backup responderam
  na API remota. Uma gravação temporária no PostgreSQL foi confirmada e removida.
- A configuração de push remota respondeu habilitada com chave pública VAPID.
- CORS aceita `https://habitos-base.vercel.app` e recusa a origem local usada no
  preview.
- Cabeçalhos `nosniff`, `DENY`, `no-referrer` e `no-store` confirmados.
- PWA pública: manifest, service worker, tela offline, ícones e grafismo
  responderam HTTP 200; o manifest usa modo `standalone` e início em `/today`.
- Interface pública em viewport de iPhone `390 x 844`: Hoje, Hábitos, Tarefas,
  Compras e Foco sem rolagem horizontal e conectados à API real.
- Formulário de compras mobile: nenhum campo recebe foco ao abrir, inputs
  calculados em `16px`, barra inferior oculta durante o foco e seletor de data
  condicional aprovado.
- Cabeçalho, troca de tema, ordem da biblioteca e contenção do horário dos
  hábitos conferidos em `390 x 844`.
- Backup/restauração exercitados por teste de ida e volta com hábitos, tarefas,
  compras, treino e leitura.
- Migração de hábitos/tarefas exercitada sobre esquema legado com preservação
  das linhas existentes.

## Portões da publicação

- [x] Dependências instaladas a partir dos arquivos versionados.
- [x] Testes automatizados do backend aprovados.
- [x] Testes automatizados e build do frontend aprovados.
- [x] API local, banco, backup e interface mobile validados.
- [x] Auditoria local de dependências sem vulnerabilidades conhecidas.
- [x] Configurar banco persistente, chave de acesso e par VAPID no backend
  remoto.
- [x] Publicar e validar o backend em ambiente controlado.
- [x] Criar e validar o pacote do frontend apontando para a API real.
- [x] Promover manualmente para produção após aprovação explícita.
- [ ] Confirmar instalação na tela inicial e entrega de uma notificação em um
  iPhone físico. Esse passo depende do aparelho e da permissão do iOS.

## Publicação

| Componente | Estado | Observação |
| --- | --- | --- |
| Versão anterior | Preservada | Recuperável pelo histórico Git/Vercel |
| Backend FastAPI | Online | Railway + PostgreSQL, saúde 200 |
| Frontend React/PWA | Online | Vercel `Ready`, mobile e PWA aprovados |

Consulte [DEPLOY.md](DEPLOY.md) para repetir os portões sem confundir build
local, preview e produção.
