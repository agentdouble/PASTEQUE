from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from insight_backend.core.database import Base
from insight_backend.repositories.ticket_context_repository import TicketContextConfigRepository


def test_ticket_context_config_is_scoped_per_table():
    engine = create_engine("sqlite:///:memory:", echo=False)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = Session()
    try:
        repo = TicketContextConfigRepository(session)
        table_a = repo.save_config(
            table_name="tickets_a",
            text_column="text",
            title_column="title",
            date_column="created_at",
        )
        table_b = repo.save_config(
            table_name="tickets_b",
            text_column="body",
            title_column="summary",
            date_column="opened_at",
        )
        session.flush()

        saved_a = repo.get_config_by_table("TICKETS_A")
        saved_b = repo.get_config_by_table("tickets_b")
        assert saved_a is not None
        assert saved_b is not None
        assert saved_a.id == table_a.id
        assert saved_b.id == table_b.id

        updated_a = repo.save_config(
            table_name="tickets_a",
            text_column="content",
            title_column="subject",
            date_column="date",
        )
        session.flush()

        assert updated_a.id == table_a.id
        assert updated_a.text_column == "content"
        assert repo.get_config_by_table("tickets_b").text_column == "body"
    finally:
        session.close()
