from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from analyzer import analyze
from ai_analyzer import ai_analyze, GeminiUpstreamError

app = FastAPI(title="Co-occurrence Network Demo")

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


class AnalyzeRequest(BaseModel):
    text: str = Field(..., min_length=1)
    window_size: int = Field(10, ge=1, le=50)
    min_freq: int = Field(2, ge=1, le=20)
    min_cooc: int = Field(2, ge=1, le=20)


class NodeIn(BaseModel):
    id: str
    label: str | None = None
    frequency: int = 1


class EdgeIn(BaseModel):
    source: str
    target: str
    weight: int = 1


class AIAnalyzeRequest(BaseModel):
    nodes: list[NodeIn]
    edges: list[EdgeIn]


@app.post("/api/analyze")
def post_analyze(req: AnalyzeRequest) -> dict:
    return analyze(
        text=req.text,
        window_size=req.window_size,
        min_freq=req.min_freq,
        min_cooc=req.min_cooc,
    )


@app.post("/api/ai-analyze")
def post_ai_analyze(req: AIAnalyzeRequest) -> dict:
    try:
        return ai_analyze(
            nodes=[n.model_dump() for n in req.nodes],
            edges=[e.model_dump() for e in req.edges],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except GeminiUpstreamError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI解析エラー: {type(e).__name__}: {e}")


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
