# Ritmo

Aplicacao de rotina pessoal com backend em **FastAPI** e frontend em **React/Vite**.

## Estrutura

- `backend/` - API FastAPI
- `frontend/` - interface React

## Backend FastAPI

### Execucao local

```powershell
cd backend
python -m venv .venv
.\\.venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
uvicorn main:app --reload
```

Se quiser usar SQLite localmente, deixe:

```env
DATABASE_URL=sqlite:///./ritmo.db
```

### Rotas principais

- `GET /health`
- `GET /api/users`
- `GET /api/users/{id}/habits`
- `GET /api/users/{id}/tasks`
- `GET /api/users/{id}/workouts`
- `GET /api/users/{id}/stats/today`
- `GET /api/users/{id}/stats/monthly`
- `GET /api/users/{id}/stats/week`
- `GET /api/users/{id}/stats/streak`

## Frontend

O frontend continua consumindo a API em `/api`. Em desenvolvimento, configure:

```env
VITE_API_URL=http://localhost:8000/api
```

E rode:

```powershell
cd frontend
npm install
npm run dev
```

## Observacao

A API FastAPI do backend usa os mesmos modelos do app atual, entao o frontend deve continuar funcionando sem mudar o contrato das rotas.
