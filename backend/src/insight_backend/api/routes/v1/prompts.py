from fastapi import APIRouter, Depends, HTTPException

from ....core.prompts import get_prompt_store
from ....core.security import get_current_user, user_is_admin
from ....models.user import User
from ....schemas.prompts import PromptItem, PromptsResponse, PromptUpdateRequest


router = APIRouter(prefix="/prompts")


def _require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not user_is_admin(current_user):
        raise HTTPException(status_code=403, detail="Réservé aux administrateurs.")
    return current_user


def _as_prompt_item(entry) -> PromptItem:
    return PromptItem(
        key=entry.key,
        label=entry.label,
        description=entry.description,
        template=entry.template,
        placeholders=entry.placeholders,
        allowed_variables=entry.allowed_variables,
    )


@router.get("", response_model=PromptsResponse)
def list_prompts(  # type: ignore[valid-type]
    current_user: User = Depends(_require_admin),
) -> PromptsResponse:
    store = get_prompt_store()
    try:
        catalog = store.catalog()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    prompts = [catalog.entries[key] for key in sorted(catalog.entries.keys())]
    return PromptsResponse(version=catalog.version, prompts=[_as_prompt_item(item) for item in prompts])


@router.put("/{prompt_key}", response_model=PromptItem)
def update_prompt(  # type: ignore[valid-type]
    prompt_key: str,
    payload: PromptUpdateRequest,
    current_user: User = Depends(_require_admin),
) -> PromptItem:
    store = get_prompt_store()
    try:
        updated = store.update_template(prompt_key, payload.template)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _as_prompt_item(updated)
