from sqlalchemy.orm import Session

from models.user import User
from models.workout import Exercise, Workout


DEFAULT_USERS = (
    {"profile_id": "antonio", "name": "Antonio", "initials": "A", "theme": "light"},
    {"profile_id": "itayna", "name": "Itayna", "initials": "I", "theme": "light"},
)

DEFAULT_WORKOUTS = (
    {
        "day": "Seg",
        "title": "Peito e tríceps",
        "note": "",
        "exercises": (
            {"name": "Supino reto", "sets": "3", "reps": "10"},
            {"name": "Crucifixo", "sets": "3", "reps": "12"},
        ),
    },
    {
        "day": "Ter",
        "title": "Costas e bíceps",
        "note": "",
        "exercises": (
            {"name": "Puxada frontal", "sets": "3", "reps": "10"},
            {"name": "Remada", "sets": "3", "reps": "12"},
        ),
    },
    {
        "day": "Qua",
        "title": "Pernas",
        "note": "",
        "exercises": (
            {"name": "Agachamento", "sets": "3", "reps": "10"},
            {"name": "Leg press", "sets": "3", "reps": "12"},
        ),
    },
    {
        "day": "Qui",
        "title": "Ombros e abdômen",
        "note": "",
        "exercises": (
            {"name": "Desenvolvimento", "sets": "3", "reps": "10"},
            {"name": "Prancha", "sets": "3", "reps": "40s"},
        ),
    },
    {
        "day": "Sex",
        "title": "Corpo todo",
        "note": "",
        "exercises": (
            {"name": "Circuito livre", "sets": "3", "reps": "12"},
        ),
    },
    {
        "day": "Sáb",
        "title": "Descanso ativo",
        "note": "Caminhada ou mobilidade",
        "exercises": (),
    },
    {
        "day": "Dom",
        "title": "Descanso",
        "note": "Recuperação",
        "exercises": (),
    },
)


def create_default_workouts(db: Session, user_id: int) -> list[Workout]:
    workouts: list[Workout] = []
    for workout_data in DEFAULT_WORKOUTS:
        workout = Workout(
            user_id=user_id,
            day=workout_data["day"],
            title=workout_data["title"],
            note=workout_data["note"],
            exercises=[
                Exercise(**exercise_data)
                for exercise_data in workout_data["exercises"]
            ],
        )
        db.add(workout)
        workouts.append(workout)
    return workouts


def seed_default_data(db: Session) -> None:
    """Create missing personal profiles and their default workouts."""
    users: list[User] = []
    for user_data in DEFAULT_USERS:
        user = (
            db.query(User)
            .filter(User.profile_id == user_data["profile_id"])
            .first()
        )
        if user is None:
            user = User(**user_data)
            db.add(user)
            db.flush()
        users.append(user)

    for user in users:
        has_workouts = (
            db.query(Workout.id)
            .filter(Workout.user_id == user.id)
            .first()
        )
        if has_workouts is None:
            create_default_workouts(db, user.id)

    db.commit()
