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
        "title": "Peito e tríceps em casa",
        "note": "Use o chão ou um colchonete. Movimento controlado.",
        "exercises": (
            {"name": "Supino no chão com halteres", "sets": "3", "reps": "10"},
            {"name": "Crucifixo no chão", "sets": "3", "reps": "12"},
            {"name": "Tríceps francês com halter", "sets": "3", "reps": "10"},
        ),
    },
    {
        "day": "Ter",
        "title": "Pernas com halteres",
        "note": "Mantenha o abdômen firme e priorize a execução.",
        "exercises": (
            {"name": "Agachamento goblet", "sets": "4", "reps": "10"},
            {"name": "Levantamento terra romeno", "sets": "3", "reps": "10"},
            {"name": "Panturrilha em pé", "sets": "3", "reps": "15"},
        ),
    },
    {
        "day": "Qua",
        "title": "Recuperação",
        "note": "Caminhada leve ou 10 minutos de mobilidade.",
        "exercises": (),
    },
    {
        "day": "Qui",
        "title": "Costas e bíceps em casa",
        "note": "Apoie uma mão em uma cadeira firme para a remada.",
        "exercises": (
            {"name": "Remada unilateral com halter", "sets": "3", "reps": "10"},
            {"name": "Pullover no chão", "sets": "3", "reps": "12"},
            {"name": "Rosca alternada", "sets": "3", "reps": "10"},
        ),
    },
    {
        "day": "Sex",
        "title": "Ombros e corpo todo",
        "note": "Treino curto e completo para fechar a semana.",
        "exercises": (
            {"name": "Desenvolvimento com halteres", "sets": "3", "reps": "10"},
            {"name": "Elevação lateral", "sets": "3", "reps": "12"},
            {"name": "Afundo alternado", "sets": "3", "reps": "10"},
            {"name": "Caminhada do fazendeiro", "sets": "3", "reps": "40s"},
        ),
    },
    {
        "day": "Sáb",
        "title": "Mobilidade",
        "note": "Alongamento leve, sem obrigação de carga.",
        "exercises": (),
    },
    {
        "day": "Dom",
        "title": "Descanso",
        "note": "Recupere o corpo para a próxima semana.",
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
