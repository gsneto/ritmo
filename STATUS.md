# Estado do Ritmo

Atualizado em 29 de julho de 2026.

## Estado confirmado

- A versão estável anterior está preservada no commit local `52a98d5`.
- A evolução completa está isolada na branch
  `feature/ritmo-complete-assistant-20260729`.
- A arquitetura ativa continua sendo `backend/` + `frontend/`.
- Nenhum deploy foi executado nesta branch.
- A versão antiga permanece online e não deve ser substituída antes do preview
  remoto, da configuração dos segredos e da confirmação explícita.

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

## Validações locais concluídas

- Backend: `41 passed`.
- Frontend: `44 passed` e build Vite de produção concluído.
- `pip-audit` e `npm audit`: nenhuma vulnerabilidade conhecida.
- API real local: saúde e uma rota de cada recurso responderam HTTP 200,
  incluindo backup e configuração de push.
- Cabeçalhos `nosniff`, `DENY`, `no-referrer` e `no-store` confirmados.
- PWA: manifest e service worker servidos pelo preview de produção; worker
  instalado, ativado e controlando a página.
- Interface mobile `390 x 844`: Hoje, Hábitos, Tarefas, Compras, Foco e Ajustes
  sem rolagem horizontal e sem erro de API.
- Formulário de compras mobile: nenhum campo recebe foco ao abrir, inputs
  calculados em `16px`, barra inferior oculta durante o foco e seletor de data
  condicional aprovado.
- Cabeçalho, troca de tema, ordem da biblioteca e contenção do horário dos
  hábitos conferidos em `390 x 844`.
- Backup/restauração exercitados por teste de ida e volta com hábitos, tarefas,
  compras, treino e leitura.
- Migração de hábitos/tarefas exercitada sobre esquema legado com preservação
  das linhas existentes.

## Portões antes de substituir a versão antiga

- [x] Dependências instaladas a partir dos arquivos versionados.
- [x] Testes automatizados do backend aprovados.
- [x] Testes automatizados e build do frontend aprovados.
- [x] API local, banco, backup e interface mobile validados.
- [x] Auditoria local de dependências sem vulnerabilidades conhecidas.
- [ ] Configurar banco persistente, chave de acesso e par VAPID no backend
  remoto.
- [ ] Publicar e validar o backend em ambiente controlado.
- [ ] Criar preview do frontend apontando para a API real.
- [ ] Testar persistência, Web Push e instalação em um iPhone físico.
- [ ] Promover manualmente para produção após aprovação explícita.

## Publicação

| Componente | Estado | Observação |
| --- | --- | --- |
| Versão antiga | Online e preservada | Não foi alterada por esta branch |
| Backend FastAPI | Validado localmente | Ainda exige ambiente e segredos remotos |
| Frontend React/PWA | Build e mobile aprovados | Ainda não promovido |

Consulte [DEPLOY.md](DEPLOY.md) para executar os portões remotos sem confundir
build local, preview e produção.
