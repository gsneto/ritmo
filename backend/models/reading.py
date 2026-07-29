from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from database import Base


class ReadingBook(Base):
    __tablename__ = "reading_books"
    __table_args__ = (
        CheckConstraint(
            "current_page >= 0",
            name="ck_reading_books_current_page_nonnegative",
        ),
        CheckConstraint(
            "total_pages > 0",
            name="ck_reading_books_total_pages_positive",
        ),
        CheckConstraint(
            "current_page <= total_pages",
            name="ck_reading_books_page_within_total",
        ),
        CheckConstraint(
            "status IN ('quero_ler', 'lendo', 'concluido')",
            name="ck_reading_books_status",
        ),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title = Column(String(200), nullable=False)
    current_page = Column(Integer, nullable=False, default=0)
    total_pages = Column(Integer, nullable=False)
    # Kept for backwards compatibility with the original single-book API.
    notes = Column(Text, nullable=False, default="")
    status = Column(String(20), nullable=False, default="quero_ler", index=True)
    is_active = Column(Boolean, nullable=False, default=False, index=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)

    user = relationship("User", back_populates="reading_books")
    sessions = relationship(
        "ReadingSession",
        back_populates="book",
        cascade="all, delete-orphan",
        order_by="ReadingSession.session_date.desc(), ReadingSession.id.desc()",
    )
    reading_notes = relationship(
        "ReadingNote",
        back_populates="book",
        cascade="all, delete-orphan",
        order_by="ReadingNote.note_date.desc(), ReadingNote.id.desc()",
    )

    @property
    def progress_percent(self) -> float:
        if not self.total_pages:
            return 0.0
        return round((self.current_page / self.total_pages) * 100, 1)


class ReadingSession(Base):
    __tablename__ = "reading_sessions"
    __table_args__ = (
        CheckConstraint(
            "start_page >= 0",
            name="ck_reading_sessions_start_page_nonnegative",
        ),
        CheckConstraint(
            "end_page >= start_page",
            name="ck_reading_sessions_page_order",
        ),
        CheckConstraint(
            "duration_minutes > 0 AND duration_minutes <= 1440",
            name="ck_reading_sessions_duration",
        ),
        CheckConstraint(
            "source IN ('manual', 'focus')",
            name="ck_reading_sessions_source",
        ),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    book_id = Column(
        Integer,
        ForeignKey("reading_books.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    session_date = Column(Date, nullable=False, index=True)
    start_page = Column(Integer, nullable=False)
    end_page = Column(Integer, nullable=False)
    duration_minutes = Column(Integer, nullable=False)
    source = Column(String(12), nullable=False, default="manual")
    created_at = Column(DateTime(timezone=True), nullable=False)

    book = relationship("ReadingBook", back_populates="sessions")

    @property
    def pages_read(self) -> int:
        return max(0, self.end_page - self.start_page)

    @property
    def book_title(self) -> str:
        return self.book.title


class ReadingNote(Base):
    __tablename__ = "reading_notes"
    __table_args__ = (
        CheckConstraint(
            "page >= 0",
            name="ck_reading_notes_page_nonnegative",
        ),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    book_id = Column(
        Integer,
        ForeignKey("reading_books.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    note_date = Column(Date, nullable=False, index=True)
    page = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)

    book = relationship("ReadingBook", back_populates="reading_notes")
