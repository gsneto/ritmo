# Estado do Ritmo

Atualizado em 1º de agosto de 2026.

## Novas features — 1º de agosto de 2026

As oito features estão consolidadas na branch `feat/product-suite-2026-08`.
Elas foram implementadas e validadas localmente, mas **não foram publicadas** na
Vercel ou no Railway. A seção de produção abaixo descreve a versão pública
anterior e não comprova que estas mudanças já estejam online.

| Feature | Implementação e teste | Limitação confirmada |
| --- | --- | --- |
| Selos de streak | Marcos de 7, 30, 100 e 365 dias, com cálculo puro e testes de limiar e agenda do hábito. | O maior streak histórico não ganhou coluna própria; o selo representa a sequência atual. |
| Atalhos do PWA | Manifest com check-in rápido e nova compra, roteamento inicial e testes das duas ações. | O manifest foi validado, mas a instalação real no Chrome/Android não foi testada; Safari/iOS não oferece esses atalhos. |
| Calendário `.ics` | Hábitos recorrentes e tarefas pendentes exportados com `icalendar`, horário e `RRULE`; teste reabre e interpreta o arquivo. | Ainda não houve importação manual no Google Calendar, Apple Calendar ou Outlook. |
| Progresso de treino | Card com período, sessões, séries, minutos, volume, carga máxima e sequência, baixado como PNG; helper, UI e download testados. | O MVP não inclui PDF; o compartilhamento usa o arquivo baixado, não a share sheet nativa. |
| Briefing da ANAHÍ | Configuração por perfil, migração, geração curta e segura, no máximo uma tentativa diária e falha não crítica no scheduler. | Gemini e entrega push reais não foram acionados nesta validação local. |
| Insights cruzados | Três cálculos determinísticos com piso de 14 dias: treino x hábitos, melhor dia de tarefas e manhã x leitura. | São associações descritivas, não causalidade; cards sem amostra suficiente ficam ocultos. |
| Entrada por voz | Web Speech API em `pt-BR`, feature detection, preenchimento editável e sem envio automático; suporte e transcrição cobertos por mocks. | Microfone real e PWA instalado no iPhone não foram testados; no iOS o suporte permanece parcial. |
| Compras compartilhadas | Código curto pareia dois perfis; listas antigas e novas, itens, histórico e preços ficam visíveis para ambos, com migração reversível e teste de isolamento dos demais domínios. | Atualizações feitas no outro aparelho aparecem ao recarregar; não há sincronização em tempo real. O orçamento mensal geral continua por perfil. |

### Validação desta branch

- Backend: `70 passed`; Ruff e mypy sem erros; cobertura total de 86%.
- Frontend: `117 passed`; build Vite aprovado; cobertura de statements de
  66,53%. O lint terminou sem erros e manteve 12 avisos já conhecidos de hooks.
- Dependências: `pip-audit` e `npm audit` sem vulnerabilidades conhecidas.
- Banco: `alembic upgrade head`, `alembic check`, downgrade da nova migração e
  novo upgrade aprovados sobre SQLite vazio.
- Manifest: exatamente dois atalhos, com URLs de check-in e nova compra.

### Validação manual ainda necessária

- Instalar a nova versão no Chrome/Android e conferir os atalhos do ícone.
- Importar o `.ics` no Google Calendar, Apple Calendar e Outlook.
- Gerar um PNG em navegador real e conferir o arquivo baixado.
- Enviar um briefing real com Gemini + Web Push no ambiente controlado.
- Testar ditado no Chrome com microfone e, separadamente, no PWA de um iPhone
  físico; o campo de texto continua sendo o caminho garantido.
- Exercitar o pareamento em dois aparelhos/perfis e confirmar o fluxo após
  recarregar.

## Auditoria em andamento — 1º de agosto de 2026

Esta entrega está na branch `chore/auditoria-2026-08` e ainda não foi publicada
na Vercel/Railway. Ela acrescenta rate limit e lockout, Sentry opcional, Error
Boundary, lint/cobertura no CI, React 19.2.8, Lucide compatível, dependências
backend atualizadas, hooks de domínio e baseline Alembic.

- Backend: 61 testes, Ruff, mypy, pip-audit e `alembic check` aprovados; cobertura
  de 86%.
- Frontend: 94 testes, lint e build aprovados; cobertura de statements de 64,68%.
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
