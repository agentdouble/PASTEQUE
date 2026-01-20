import json
import textwrap
from pathlib import Path

from insight_backend.services.ticket_context_service import TicketContextService
from insight_backend.repositories.data_repository import DataRepository
from insight_backend.repositories.dictionary_repository import DataDictionaryRepository


class _FakeAgent:
    def summarize_chunks(self, *, period_label: str, chunks, total_tickets: int) -> str:  # type: ignore[override]
        return f"summary {period_label} ({total_tickets})"


def _write_yaml(path: Path, content: str) -> None:
    path.write_text(textwrap.dedent(content).strip() + "\n", encoding="utf-8")


def test_dictionary_note_uses_only_selected_columns(tmp_path: Path) -> None:
    dico_dir = tmp_path / "dictionary"
    dico_dir.mkdir()
    _write_yaml(
        dico_dir / "tickets.yml",
        """
        version: 1
        table: tickets
        columns:
          - name: title
            description: T
          - name: status
            description: S
        """,
    )

    service = TicketContextService(
        data_repo=DataRepository(tmp_path),
        agent=_FakeAgent(),
        data_pref_repo=None,
        ticket_config_repo=None,
    )
    # Redirect dictionary lookup to the temporary folder
    service._dictionary_repo = DataDictionaryRepository(directory=dico_dir)

    note = service._build_dictionary_note(table="tickets", columns=["title"])
    assert note is not None
    _, _, blob = note.partition("\n")
    data = json.loads(blob)
    cols = data["tickets"]["columns"]
    names = [c["name"] for c in cols]
    assert names == ["title"]
