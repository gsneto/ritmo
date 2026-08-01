<p align="center">
  <img src="frontend/public/ritmo-icon-192.png" width="112" alt="Ícone do Ritmo com grafismo indígena">
</p>

<h1 align="center">Ritmo</h1>

<p align="center">
  Seu cotidiano em um só lugar: hábitos, tarefas, compras, finanças, leitura e treinos.
</p>

<p align="center">
  <strong>React + TypeScript</strong> · <strong>FastAPI</strong> ·
  <strong>PostgreSQL + SQLAlchemy</strong> · <strong>PWA mobile-first</strong>
</p>

## Aplicação publicada

- App: [https://habitos-base.vercel.app](https://habitos-base.vercel.app)
- Saúde da API: [https://supportive-warmth-production-dd70.up.railway.app/health](https://supportive-warmth-production-dd70.up.railway.app/health)
- Estado técnico validado: [STATUS.md](STATUS.md)

## O que o Ritmo faz

| Área | Recursos |
| --- | --- |
| **Hoje** | Organiza horários, pendências, compras, treino e leitura em uma agenda inteligente |
| **Hábitos** | Dias da semana, lembretes, check-in e acompanhamento de sequência |
| **Tarefas** | Prazos e recorrências diárias, semanais ou mensais |
| **Compras** | Lista com check, quantidade, preço, orçamento e conclusão no mercado |
| **Finanças** | Histórico mensal, comparação, saldo, categorias, preço anterior e CSV |
| **Treinos** | Cronômetro, descanso, séries, carga, recordes e sugestão de progressão |
| **Leitura e Pomodoro** | Biblioteca, página atual, progresso, sessões, anotações e cronômetro Pomodoro |
| **ANAHÍ** | Assistente de IA que consulta, por perfil, resumos de hábitos, tarefas, leitura, compras e treinos |
| **Seus dados** | Backup e restauração completos por perfil |

O aplicativo também oferece tema claro/escuro, instalação na tela inicial,
experiência offline e suporte opcional a Web Push.

## Identidade

O visual do Ritmo incorpora um grafismo indígena fornecido pelo criador do
projeto. A arte original é preservada no cabeçalho e nos ícones da PWA, sem
reinterpretar seus traços.

## Arquitetura

```text
frontend/  React + TypeScript + Vite
    │
    │ HTTPS /api
    ▼
backend/   FastAPI + SQLAlchemy
    │
    └── SQLite local ou PostgreSQL gerenciado em produção
```

- `frontend/`: interface responsiva e instalável;
- `backend/`: API, regras de negócio, migrações e agendador de notificações;
- `vercel.json`: build do frontend e fallback das rotas;
- `.github/workflows/`: testes e publicações manuais.

Frontend e backend são aplicações separadas. Em produção, `VITE_API_URL` deve
apontar para a URL HTTPS completa da API, terminando em `/api`.

## Rodando localmente

### 1. Backend

```powershell
Set-Location backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m uvicorn main:app --reload
```

Por padrão, o ambiente local usa:

```env
DATABASE_URL=sqlite:///./ritmo.db
RITMO_DEBUG=true
```

Endereços úteis:

- API: `http://localhost:8000`
- documentação: `http://localhost:8000/docs`
- verificação: `http://localhost:8000/health`

### 2. Frontend

Em outro terminal:

```powershell
Set-Location frontend
Copy-Item .env.example .env
npm ci
npm run dev
```

Configuração local:

```env
VITE_API_URL=http://localhost:8000/api
```

## Segurança e notificações

Em produção, use `RITMO_DEBUG=false`, configure `APP_ACCESS_TOKEN` e limite
`CORS_ORIGINS` aos domínios reais. O token é enviado pelo frontend no cabeçalho
`X-Ritmo-Key` e nunca deve ser versionado.

Para receber lembretes mesmo com a PWA fechada, configure somente no servidor:

```env
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:voce@exemplo.com
```

Sem essas chaves, os lembretes locais e os cronômetros continuam funcionando,
mas o Web Push permanece desativado.

Cada navegador mantém o segundo plano ligado a um perfil por vez. Ao trocar de
perfil, o Ritmo preserva os alertas locais e só transfere o Web Push quando a
pessoa toca em **Ativar neste perfil**.

A ANAHÍ é opcional e usa a chave somente no backend. Nunca coloque essa chave
em variáveis `VITE_*` nem no código do frontend:

```env
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.6-flash
```

O Ritmo envia ao provedor apenas um resumo da área relacionada à pergunta e
mantém anotações de leitura, itens detalhados de compras e cargas de treino fora
do contexto da IA.

## Testes

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m pip_audit -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q

Set-Location ..\frontend
npm test
npm run build
```

O build isolado não comprova integração, persistência ou experiência móvel.
Antes de publicar, execute também os testes reais de API e interface descritos
em [DEPLOY.md](DEPLOY.md). O estado validado mais recente fica registrado em
[STATUS.md](STATUS.md).

## Publicação segura

O envio de código ao GitHub executa validações, mas não deve substituir
automaticamente a versão antiga. O fluxo correto é:

1. validar backend, banco, testes e build;
2. publicar a API em ambiente persistente;
3. criar um preview HTTPS do frontend;
4. testar instalação, persistência e notificações em um iPhone físico;
5. promover manualmente para produção somente após aprovação.

Assim, a versão antiga permanece disponível enquanto o novo Ritmo é
comprovado em um ambiente separado.

A publicação de 29 de julho de 2026 seguiu esse fluxo: API e PostgreSQL foram
validados primeiro, o frontend foi conferido separadamente em viewport mobile
e somente então o pacote aprovado foi promovido para o endereço público.
