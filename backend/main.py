from contextlib import asynccontextmanager
from datetime import date

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import SessionLocal, init_db
from models.user import User
from models.workout import Exercise, Workout
from routers import habits, stats, tasks, users, workouts


DEFAULT_WORKOUTS = [
    {"day": "Seg", "title": "Peito e tríceps", "note": "", "exercises": [
        {"name": "Supino reto", "sets": "3", "reps": "10"},
        {"name": "Crucifixo", "sets": "3", "reps": "12"},
    ]},
    {"day": "Ter", "title": "Costas e bíceps", "note": "", "exercises": [
        {"name": "Puxada frontal", "sets": "3", "reps": "10"},
        {"name": "Remada", "sets": "3", "reps": "12"},
    ]},
    {"day": "Qua", "title": "Pernas", "note": "", "exercises": [
        {"name": "Agachamento", "sets": "3", "reps": "10"},
        {"name": "Leg press", "sets": "3", "reps": "12"},
    ]},
    {"day": "Qui", "title": "Ombros e abdômen", "note": "", "exercises": [
        {"name": "Desenvolvimento", "sets": "3", "reps": "10"},
        {"name": "Prancha", "sets": "3", "reps": "40s"},
    ]},
    {"day": "Sex", "title": "Corpo todo", "note": "", "exercises": [
        {"name": "Circuito livre", "sets": "3", "reps": "12"},
    ]},
    {"day": "Sáb", "title": "Descanso ativo", "note": "Caminhada ou mobilidade", "exercises": []},
    {"day": "Dom", "title": "Descanso", "note": "Recuperação", "exercises": []},
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    db = SessionLocal()
    try:
        if not db.query(User).first():
            defaults = [
                User(profile_id="antonio", name="Antonio", initials="A", theme="light"),
                User(profile_id="itayna", name="Itayna", initials="I", theme="light"),
            ]
            db.add_all(defaults)
            db.commit()

            for user in db.query(User).all():
                for workout_data in DEFAULT_WORKOUTS:
                    workout = Workout(
                        user_id=user.id,
                        day=workout_data["day"],
                        title=workout_data["title"],
                        note=workout_data["note"],
                    )
                    db.add(workout)
                    db.flush()
                    for exercise_data in workout_data["exercises"]:
                        db.add(Exercise(workout_id=workout.id, **exercise_data))
                db.commit()
    finally:
        db.close()

    yield


app = FastAPI(
    title="Ritmo API",
    description="API FastAPI do Ritmo",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users.router)
app.include_router(habits.router)
app.include_router(tasks.router)
app.include_router(workouts.router)
app.include_router(stats.router)


@app.get("/")
def root():
    return {"message": "Ritmo API", "version": "1.0.0"}


@app.get("/api")
def api_root():
    return {"message": "Ritmo API", "version": "1.0.0"}


@app.get("/health")
def health():
    return {"status": "healthy", "date": date.today().isoformat()}
