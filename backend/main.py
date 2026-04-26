from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from analyzer import analyze

app = FastAPI(title="Co-occurrence Network Demo")

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


class AnalyzeRequest(BaseModel):
    text: str = Field(..., min_length=1)
    window_size: int = Field(10, ge=1, le=50)
    min_freq: int = Field(2, ge=1, le=20)
    min_cooc: int = Field(2, ge=1, le=20)


@app.post("/api/analyze")
def post_analyze(req: AnalyzeRequest) -> dict:
    return analyze(
        text=req.text,
        window_size=req.window_size,
        min_freq=req.min_freq,
        min_cooc=req.min_cooc,
    )


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
