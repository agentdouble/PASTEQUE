from pathlib import Path

from fastapi import APIRouter, UploadFile, HTTPException, Depends, status
from sqlalchemy.orm import Session

from ....schemas.data import (
    IngestResponse,
    DataOverviewResponse,
    UpdateHiddenFieldsRequest,
    HiddenFieldsResponse,
    TableExplorePreview,
    UpdateColumnRolesRequest,
    ColumnRolesResponse,
    UpdateExplorerEnabledRequest,
    ExplorerEnabledResponse,
)
from ....schemas.tables import TableInfo, ColumnInfo
from ....services.data_service import DataService, ColumnRoles
from ....repositories.data_repository import DataRepository
from ....repositories.user_table_permission_repository import UserTablePermissionRepository
from ....repositories.data_source_preference_repository import DataSourcePreferenceRepository
from ....core.config import settings
from ....core.database import get_session
from ....core.security import get_current_user, user_is_admin
from ....models.user import User

router = APIRouter(prefix="/data")
_service = DataService(repo=DataRepository(tables_dir=Path(settings.tables_dir)))


@router.post("/ingest", response_model=IngestResponse)
async def ingest(file: UploadFile) -> IngestResponse:  # type: ignore[valid-type]
    """Endpoint placeholder d’ingestion de données.
    Délègue à DataService (non implémenté).
    """
    raise NotImplementedError("Data ingestion not implemented yet")


@router.get("/tables", response_model=list[TableInfo])
def list_tables(  # type: ignore[valid-type]
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[TableInfo]:
    allowed = None
    if not user_is_admin(current_user):
        allowed = UserTablePermissionRepository(session).get_allowed_tables(current_user.id)
    return _service.list_tables(allowed_tables=allowed)


@router.get("/schema/{table_name}", response_model=list[ColumnInfo])
def get_table_schema(  # type: ignore[valid-type]
    table_name: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[ColumnInfo]:
    allowed = None
    if not user_is_admin(current_user):
        allowed = UserTablePermissionRepository(session).get_allowed_tables(current_user.id)
    try:
        return _service.get_schema(table_name, allowed_tables=allowed)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/overview", response_model=DataOverviewResponse)
def get_data_overview(  # type: ignore[valid-type]
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    date_from: str | None = None,
    date_to: str | None = None,
    include_disabled: bool = False,
    lazy_disabled: bool = True,
    lightweight: bool = False,
    headers_only: bool = False,
) -> DataOverviewResponse:
    allowed = None
    if not user_is_admin(current_user):
        allowed = UserTablePermissionRepository(session).get_allowed_tables(current_user.id)
        include_disabled = False
        lazy_disabled = True
        lightweight = False
        headers_only = False
    else:
        include_disabled = bool(include_disabled)
        lazy_disabled = bool(lazy_disabled)
        lightweight = bool(lightweight)
        headers_only = bool(headers_only)
    pref_repo = DataSourcePreferenceRepository(session)
    preferences = pref_repo.list_preferences()
    hidden_map = {source: pref.hidden_fields for source, pref in preferences.items() if pref.hidden_fields}
    column_roles_map = {
        source: ColumnRoles(
            date_field=pref.date_field,
            category_field=pref.category_field,
            sub_category_field=pref.sub_category_field,
        )
        for source, pref in preferences.items()
    }
    enabled_map = {source: pref.explorer_enabled for source, pref in preferences.items()}
    include_hidden = user_is_admin(current_user)
    try:
        return _service.get_overview(
            allowed_tables=allowed,
            hidden_fields_by_source=hidden_map,
            include_hidden_fields=include_hidden,
            column_roles_by_source=column_roles_map,
            date_from=date_from,
            date_to=date_to,
            explorer_enabled_by_source=enabled_map,
            include_disabled_sources=include_disabled,
            skip_overview_for_disabled=lazy_disabled,
            lightweight=lightweight,
            headers_only=headers_only,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.put("/overview/{source}/hidden-fields", response_model=HiddenFieldsResponse)
def update_hidden_fields(  # type: ignore[valid-type]
    source: str,
    payload: UpdateHiddenFieldsRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> HiddenFieldsResponse:
    if not user_is_admin(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

    table_name = source.strip()
    if not table_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Table name is required")

    try:
        schema = _service.get_schema(table_name)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))

    available_fields = {col.name for col in schema}
    cleaned: list[str] = []
    seen: set[str] = set()
    unknown: list[str] = []
    for name in payload.hidden_fields:
        if not isinstance(name, str):
            continue
        trimmed = name.strip()
        if not trimmed:
            continue
        if trimmed not in available_fields:
            unknown.append(trimmed)
            continue
        key = trimmed.casefold()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(trimmed)

    if unknown:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Colonnes inconnues pour {table_name}: {', '.join(sorted(set(unknown)))}",
        )

    repo = DataSourcePreferenceRepository(session)
    updated = repo.set_hidden_fields(source=table_name, hidden_fields=cleaned)
    session.commit()
    return HiddenFieldsResponse(source=table_name, hidden_fields=updated)


@router.put("/overview/{source}/column-roles", response_model=ColumnRolesResponse)
def update_column_roles(  # type: ignore[valid-type]
    source: str,
    payload: UpdateColumnRolesRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ColumnRolesResponse:
    if not user_is_admin(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

    table_name = source.strip()
    if not table_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Table name is required")

    try:
        schema = _service.get_schema(table_name)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))

    available_fields = {col.name for col in schema}

    def _validate(field_name: str | None, label: str) -> str | None:
        if field_name is None:
            return None
        trimmed = field_name.strip()
        if not trimmed:
            return None
        if trimmed not in available_fields:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Colonne inconnue pour {table_name}: {trimmed} (champ {label})",
            )
        return trimmed

    date_field = _validate(payload.date_field, "date_field")
    category_field = _validate(payload.category_field, "category_field")
    sub_category_field = _validate(payload.sub_category_field, "sub_category_field")

    if (category_field and not sub_category_field) or (sub_category_field and not category_field):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Sélectionnez à la fois une catégorie et une sous-catégorie ou aucune des deux.",
        )

    repo = DataSourcePreferenceRepository(session)
    updated = repo.set_column_roles(
        source=table_name,
        date_field=date_field,
        category_field=category_field,
        sub_category_field=sub_category_field,
    )
    session.commit()

    return ColumnRolesResponse(
        source=table_name,
        date_field=updated.date_field,
        category_field=updated.category_field,
        sub_category_field=updated.sub_category_field,
    )


@router.put("/overview/{source}/explorer-enabled", response_model=ExplorerEnabledResponse)
def update_explorer_enabled(  # type: ignore[valid-type]
    source: str,
    payload: UpdateExplorerEnabledRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ExplorerEnabledResponse:
    if not user_is_admin(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

    table_name = source.strip()
    if not table_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Table name is required")

    try:
        _service.get_schema(table_name)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))

    repo = DataSourcePreferenceRepository(session)
    enabled = repo.set_explorer_enabled(source=table_name, enabled=payload.enabled)
    session.commit()
    return ExplorerEnabledResponse(source=table_name, enabled=enabled)


@router.get("/explore/{source}", response_model=TableExplorePreview)
def explore_table(  # type: ignore[valid-type]
    source: str,
    category: str,
    sub_category: str,
    limit: int = 25,
    offset: int = 0,
    sort_date: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> TableExplorePreview:
    if limit < 1 or limit > 500:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Paramètre 'limit' invalide (doit être entre 1 et 500)",
        )
    if offset < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Paramètre 'offset' invalide (doit être >= 0)",
        )

    allowed = None
    if not user_is_admin(current_user):
        allowed = UserTablePermissionRepository(session).get_allowed_tables(current_user.id)

    pref_repo = DataSourcePreferenceRepository(session)
    preferences = pref_repo.list_preferences()
    normalized_roles = {name.casefold(): pref for name, pref in preferences.items()}
    roles = normalized_roles.get(source.casefold())
    column_roles = None
    if roles:
        column_roles = ColumnRoles(
            date_field=roles.date_field,
            category_field=roles.category_field,
            sub_category_field=roles.sub_category_field,
        )

    try:
        return _service.explore_table(
            table_name=source,
            category=category,
            sub_category=sub_category,
            limit=limit,
            offset=offset,
            sort_date=sort_date,
            date_from=date_from,
            date_to=date_to,
            allowed_tables=allowed,
            column_roles=column_roles,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
