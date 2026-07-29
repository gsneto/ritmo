from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models.task import Task
from models.user import User
from schemas.task import TaskResponse, TaskCreate, TaskUpdate
from time_utils import app_now, app_today

router = APIRouter(prefix="/api", tags=["tasks"])


@router.get("/users/{user_id}/tasks", response_model=List[TaskResponse])
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
    else:
        task.completed_at = app_now()

    db.commit()
    db.refresh(task)
    return task
