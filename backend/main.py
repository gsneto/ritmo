from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from database import init_db, SessionLocal
from models.user import User
from models.workout import Workout, Exercise
from routers import users, habits, tasks, workouts, stats


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database and seed data on startup."""
    init_db()

    # Seed default users if they don't exist
    db = SessionLocal()
    try:
        if not db.query(User).first():
            default_users = [
                User(profile_id="antonio", name="Antonio", initials="A", theme="light"),
                User(profile_id="itayna", name="Itayna", initials="I", theme="light"),
            ]
            for user in default_users:
                db.add(user)
            db.commit()

            # Seed default workouts for each user
            for user in db.query(User).all():
                default_workouts = [
                    {"day": "Seg", "title": "Peito e tríceps", "note": "", "exercises": [
                        {"name": "Supino reto", "sets": "3", "reps": "10"},
                        {"name": "Crucifixo", "sets": "3", "reps": "12"}
                    ]},
                    {"day": "Ter", "title": "Costas e bíceps", "note": "", "exercises": [
                        {"name": "Puxada frontal", "sets": "3", "reps": "10"},
                        {"name": "Remada", "sets": "3", "reps": "12"}
                    ]},
                    {"day": "Qua", "title": "Pernas", "note": "", "exercises": [
                        {"name": "Agachamento", "sets": "3", "reps": "10"},
                        {"name": "Leg press", "sets": "3", "reps": "12"}
                    ]},
                    {"day": "Qui", "title": "Ombros e abdômen", "note": "", "exercises": [
                        {"name": "Desenvolvimento", "sets": "3", "reps": "10"},
                        {"name": "Prancha", "sets": "3", "reps": "40s"}
                    ]},
                    {"day": "Sex", "title": "Corpo todo", "note": "", "exercises": [
                        {"name": "Circuito livre", "sets": "3", "reps": "12"}
                    ]},
                    {"day": "Sáb", "title": "Descanso ativo", "note": "Caminhada ou mobilidade", "exercises": []},
                    {"day": "Dom", "title": "Descanso", "note": "Recuperação", "exercises": []},
                ]

                for w in default_workouts:
                    workout = Workout(user_id=user.id, day=w["day"], title=w["title"], note=w["note"])
                    db.add(workout)
                    db.flush()

                    for ex in w["exercises"]:
                        exercise = Exercise(workout_id=workout.id, name=ex["name"], sets=ex["sets"], reps=ex["reps"])
                        db.add(exercise)

                db.commit()

            print("Seed data created successfully!")
    finally:
        db.close()

    yield


app = FastAPI(
    title="Ritmo API",
    description="API para o assistente pessoal de hábitos Ritmo",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(users.router)
app.include_router(habits.router)
app.include_router(tasks.router)
app.include_router(workouts.router)
app.include_router(stats.router)


@app.get("/")
def root():
    return {"message": "Ritmo API", "version": "1.0.0"}


@app.get("/health")
def health():
    return {"status": "healthy"}
