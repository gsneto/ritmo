import calendar
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models.task import Task
from models.user import User
from schemas.task import TaskCreate, TaskResponse, TaskUpdate
from time_utils import app_now, app_today

router = APIRouter(prefix="/api", tags=["tasks"])


def next_recurrence_date(
    current: date,
    recurrence: str,
    interval: int,
) -> date:
    if recurrence == "daily":
        return current + timedelta(days=interval)
    if recurrence == "weekly":
        return current + timedelta(days=7 * interval)
    if recurrence == "monthly":
        month_index = current.month - 1 + interval
        year = current.year + month_index // 12
        month = month_index % 12 + 1
        day = min(current.day, calendar.monthrange(year, month)[1])
        return date(year, month, day)
    return current


@router.get("/users/{user_id}/tasks", response_model=list[TaskResponse])
def list_tasks(user_id: int, db: Session = Depends(get_db)):
    """List all tasks for a user."""
    tasks = db.query(Task).filter(Task.user_id == user_id).order_by(Task.date, Task.time).all()
    return tasks


@router.post("/users/{user_id}/tasks", response_model=TaskResponse)
def create_task(user_id: int, data: TaskCreate, db: Session = Depends(get_db)):
    """Create a new task."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    task = Task(
        user_id=user_id,
        name=data.name,
        date=data.date,
        time=data.time,
        recurrence=data.recurrence,
        recurrence_interval=data.recurrence_interval,
        created_at=app_today(),
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.put("/tasks/{task_id}", response_model=TaskResponse)
def update_task(task_id: int, data: TaskUpdate, db: Session = Depends(get_db)):
    """Update a task."""
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if data.name is not None:
        task.name = data.name
    if data.date is not None:
        task.date = data.date
    if data.time is not None:
        task.time = data.time
    if data.recurrence is not None:
        task.recurrence = data.recurrence
    if data.recurrence_interval is not None:
        task.recurrence_interval = data.recurrence_interval

    db.commit()
    db.refresh(task)
    return task


@router.delete("/tasks/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db)):
    """Delete a task."""
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    db.delete(task)
    db.commit()
    return {"message": "Task deleted"}


@router.post("/tasks/{task_id}/complete", response_model=TaskResponse)
def complete_task(task_id: int, db: Session = Depends(get_db)):
    """Toggle task completion."""
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.completed_at:
        task.completed_at = None
        generated = db.query(Task).filter(
            Task.recurrence_parent_id == task.id,
            Task.completed_at.is_(None),
        ).first()
        if generated:
            db.delete(generated)
    else:
        task.completed_at = app_now()
        if task.recurrence != "none":
            next_date = next_recurrence_date(
                task.date,
                task.recurrence,
                task.recurrence_interval,
            )
            generated = db.query(Task).filter(
                Task.recurrence_parent_id == task.id,
            ).first()
            if generated is None:
                db.add(
                    Task(
                        user_id=task.user_id,
                        name=task.name,
                        date=next_date,
                        time=task.time,
                        recurrence=task.recurrence,
                        recurrence_interval=task.recurrence_interval,
                        recurrence_parent_id=task.id,
                        created_at=app_today(),
                    )
                )

    db.commit()
    db.refresh(task)
    return task
