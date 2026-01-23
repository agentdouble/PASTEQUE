from insight_backend.repositories.data_repository import DataRepository
from insight_backend.services.ticket_context_service import TicketContextService


def test_ticket_context_preview_filters_selection(tmp_path):
    tables_dir = tmp_path / "tables"
    tables_dir.mkdir()

    sample = tables_dir / "tickets.csv"
    sample.write_text(
        "\n".join(
            [
                "ticket_id,description,created_at",
                "T-1,First,2024-01-01",
                "T-2,Second,2024-01-02",
                "T-3,Third,2024-01-03",
            ]
        ),
        encoding="utf-8",
    )

    service = TicketContextService(data_repo=DataRepository(tables_dir=tables_dir))
    preview = service.build_preview(
        allowed_tables=None,
        date_from=None,
        date_to=None,
        periods=None,
        table="tickets",
        text_column="description",
        date_column="created_at",
        selection={"pk": "ticket_id", "values": ["T-1", "T-3"]},
    )

    assert preview["count"] == 2
    assert preview["total"] == 3
    assert preview["evidence_rows"]["row_count"] == 2
