from fastapi import APIRouter, Depends, HTTPException, status

from ....integrations.mcp_manager import MCPManager
from ....schemas.mcp_chart import ChartRequest, ChartResponse
from ....services.mcp_chart_service import ChartGenerationError, ChartGenerationService
from ....core.agent_limits import reset_from_settings, AgentBudgetExceeded
from ....core.security import get_current_user, user_is_admin
from ....models.user import User


router = APIRouter(prefix="/mcp")


@router.get("/servers")
def list_mcp_servers() -> list[dict]:  # type: ignore[valid-type]
    mgr = MCPManager()
    return [
        {"name": s.name, "command": s.command, "args": s.args, "env": list(s.env.keys())}
        for s in mgr.list_servers()
    ]


@router.post("/chart", response_model=ChartResponse)
async def generate_mcp_chart(  # type: ignore[valid-type]
    payload: ChartRequest,
    current_user: User = Depends(get_current_user),
) -> ChartResponse:
    if not (user_is_admin(current_user) or current_user.can_generate_chart):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chart generation access required",
        )
    # Initialize per-request agent budgets from settings
    reset_from_settings()
    service = ChartGenerationService()
    try:
        result = await service.generate_chart(
            prompt=payload.prompt,
            dataset=payload.dataset,
            answer=payload.answer,
        )
    except AgentBudgetExceeded as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except ChartGenerationError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    return ChartResponse(
        prompt=result.prompt,
        chart_url=result.chart_url,
        tool_name=result.tool_name,
        chart_title=result.chart_title,
        chart_description=result.chart_description,
        chart_spec=result.chart_spec,
        source_sql=result.source_sql,
        source_row_count=result.source_row_count,
    )
