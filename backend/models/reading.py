from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from database import Base


class ReadingBook(Base):
    __tablename__ = "reading_books"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_reading_books_user_id"),
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
    notes = Column(Text, nullable=False, default="")
    created_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)

    user = relationship("User", back_populates="reading_book")

    @property
    def progress_percent(self) -> float:
        if not self.total_pages:
            return 0.0
        return round((self.current_page / self.total_pages) * 100, 1)
