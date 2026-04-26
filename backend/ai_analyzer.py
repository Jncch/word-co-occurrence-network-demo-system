import json
import os
from pathlib import Path

import networkx as nx
from dotenv import load_dotenv
from google import genai
from google.genai import errors as genai_errors
from google.genai import types

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

MODEL = os.environ.get("GEMINI_MODEL", "gemini-3-flash-preview")
FALLBACK_MODELS = [
    m.strip()
    for m in os.environ.get("GEMINI_FALLBACK_MODELS", "gemini-2.5-flash").split(",")
    if m.strip()
]

SYSTEM_PROMPT = """\
あなたは会議ファシリテーターのアシスタントです。
ユーザーから会議発言から構築された「キーワード共起ネットワーク」のサマリ
（頻出キーワード・共起ペア・キーワードグループ・橋渡し語など）が与えられます。
あなたの役割は、ネットワーク構造を客観的な根拠としつつ、
1) 現状の議論の中心と偏りを分析し、
2) テーマに対して欠けている重要な観点／キーワード群を特定し、
3) 次に取り組むべき議論トピックを優先度付きで提案することです。

重要な制約:
- 出力は必ず日本語。
- 出力は必ず指定されたJSONスキーマに従い、余計なテキストや前置きは付けない。
- 推測は中心性・キーワードグループ・橋渡し語などネットワーク上の根拠に紐づけて述べる。
- 欠けている観点はキーワードネットワーク全体を俯瞰して挙げ、会議で扱われた既出キーワードの単純な再列挙にしない。
- キーワードグループ（連結成分）に言及する際は、必ず「顧客・ターゲット」のように代表キーワードを
  中黒「・」で2〜3語つないで表記すること。「クラスタ1」「クラスタ3」「グループ2」などの
  番号やラベルでの呼称は絶対に使用しない。
"""

USER_PROMPT_TEMPLATE = """\

## ネットワーク統計
{stats}

## 頻出キーワード（出現頻度・次数中心性）
{top_keywords}

## 強く関連するキーワードペア（共起頻度順）
{top_cooccurrences}

## キーワードグループ（連結成分）
{clusters}

## グループ間の橋渡し語（媒介中心性順）
{bridge_words}

---
## 依頼内容
以下の3要素を持つJSONを返してください。

【全文共通の表記ルール】
- キーワードグループ（連結成分）に触れる際は、必ず代表キーワードを中黒「・」で2〜3語
  つないで表記する（例: 「顧客・ターゲット」「販売・チャネル・ブランド」）。
- 「クラスタ1」「クラスタ3」「グループ2」などの番号呼称は絶対に使用しない。

1. current_analysis (string):
   ネットワークから読み取れる「現在の議論の中心テーマ」と「議論の偏り」を3〜5文で要約。
   どのキーワード群を根拠にしたかを「顧客・ターゲット」のような代表キーワード表記で触れる。

2. missing_words (array):
   このネットワークに欠落している重要な観点を3〜6件挙げる。
   各要素は次のフィールドを持つ:
     - category: 観点の見出し（例: "競合分析", "収益モデル"）
     - keywords: その観点を象徴する代表キーワード（3〜6語の配列）
     - reason: なぜ重要か（1〜2文）

3. next_discussions (array):
   次に取り組むべき議論トピックを3〜5件、優先度順に。
   各要素は次のフィールドを持つ:
     - priority: 1から始まる整数（1が最優先）
     - topic: 短いトピック名
     - reason: なぜ次に議論すべきか（1〜2文。関連グループに触れる場合は
       「顧客・ターゲット」のように代表キーワード表記で記述する）
"""

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "current_analysis": {"type": "string"},
        "missing_words": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "category": {"type": "string"},
                    "keywords": {"type": "array", "items": {"type": "string"}},
                    "reason": {"type": "string"},
                },
                "required": ["category", "keywords", "reason"],
            },
        },
        "next_discussions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "priority": {"type": "integer"},
                    "topic": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["priority", "topic", "reason"],
            },
        },
    },
    "required": ["current_analysis", "missing_words", "next_discussions"],
}


def enrich_network(nodes: list[dict], edges: list[dict]) -> dict:
    G = nx.Graph()
    for n in nodes:
        G.add_node(n["id"], frequency=n.get("frequency", 1))
    for e in edges:
        G.add_edge(e["source"], e["target"], weight=e.get("weight", 1))

    if G.number_of_nodes() == 0:
        raise ValueError("ネットワークが空です。先に解析を実行してください。")

    degree_centrality = nx.degree_centrality(G)
    if G.number_of_edges() > 0:
        betweenness = nx.betweenness_centrality(G, weight="weight")
    else:
        betweenness = {n: 0.0 for n in G.nodes()}

    top_nodes = sorted(degree_centrality.items(), key=lambda x: x[1], reverse=True)[:20]
    top_edges = sorted(
        [(u, v, d["weight"]) for u, v, d in G.edges(data=True)],
        key=lambda x: x[2],
        reverse=True,
    )[:30]
    components = sorted(nx.connected_components(G), key=len, reverse=True)
    clusters = [
        {
            "size": len(c),
            "words": sorted(c),
            "hub": max(c, key=lambda w: degree_centrality.get(w, 0)),
        }
        for c in components
    ]
    bridge_words = sorted(betweenness.items(), key=lambda x: x[1], reverse=True)[:10]

    return {
        "stats": {
            "node_count": G.number_of_nodes(),
            "edge_count": G.number_of_edges(),
            "density": round(nx.density(G), 4),
            "average_clustering": round(nx.average_clustering(G), 4),
        },
        "top_keywords": [
            {
                "word": w,
                "degree_centrality": round(c, 4),
                "frequency": G.nodes[w]["frequency"],
            }
            for w, c in top_nodes
        ],
        "top_cooccurrences": [
            {"word_a": u, "word_b": v, "count": cnt} for u, v, cnt in top_edges
        ],
        "clusters": clusters[:10],
        "bridge_words": [
            {"word": w, "betweenness": round(b, 4)} for w, b in bridge_words
        ],
    }


def build_user_prompt(summary: dict) -> str:
    top_keywords_str = "\n".join(
        f"  - {k['word']} (出現頻度: {k['frequency']}, 中心性: {k['degree_centrality']})"
        for k in summary["top_keywords"]
    ) or "  - (なし)"

    top_cooc_str = "\n".join(
        f"  - {e['word_a']} x {e['word_b']}: {e['count']}回"
        for e in summary["top_cooccurrences"][:15]
    ) or "  - (なし)"

    def _group_label(cluster: dict) -> str:
        hub = cluster["hub"]
        others = [w for w in cluster["words"] if w != hub][:2]
        return "・".join([hub, *others])

    clusters_str = "\n".join(
        f"  - 「{_group_label(c)}」(語数: {c['size']}): {', '.join(c['words'][:8])}"
        for c in summary["clusters"][:6]
    ) or "  - (なし)"

    bridge_str = ", ".join(w["word"] for w in summary["bridge_words"]) or "(なし)"

    stats = summary["stats"]
    stats_str = (
        f"ノード数: {stats['node_count']}, エッジ数: {stats['edge_count']}, "
        f"密度: {stats['density']}, 平均クラスタ係数: {stats['average_clustering']}"
    )

    return USER_PROMPT_TEMPLATE.format(
        stats=stats_str,
        top_keywords=top_keywords_str,
        top_cooccurrences=top_cooc_str,
        clusters=clusters_str,
        bridge_words=bridge_str,
    )


class GeminiUpstreamError(Exception):
    """Gemini API がリトライ可能/不可能なエラーを返した場合に投げる。"""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def _generate_with_fallback(client, user_prompt: str) -> tuple[str, str]:
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        response_mime_type="application/json",
        response_schema=RESPONSE_SCHEMA,
    )

    candidates = [MODEL] + [m for m in FALLBACK_MODELS if m != MODEL]
    last_error: Exception | None = None
    for model_name in candidates:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=user_prompt,
                config=config,
            )
            return response.text or "", model_name
        except genai_errors.ServerError as e:
            last_error = e
            continue
        except genai_errors.ClientError as e:
            raise GeminiUpstreamError(
                f"Gemini API クライアントエラー (model={model_name}): {e}",
                status_code=getattr(e, "code", 400) or 400,
            )

    raise GeminiUpstreamError(
        "全てのGeminiモデルが利用不可です。"
        f" 試行: {candidates}. 直近のエラー: {last_error}",
        status_code=503,
    )


def ai_analyze(nodes: list[dict], edges: list[dict]) -> dict:
    if not os.environ.get("GEMINI_API_KEY"):
        raise RuntimeError(
            "GEMINI_API_KEY が設定されていません。.env を確認してください。"
        )

    summary = enrich_network(nodes, edges)
    user_prompt = build_user_prompt(summary)

    client = genai.Client()
    text, used_model = _generate_with_fallback(client, user_prompt)

    try:
        result = json.loads(text)
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f"AI応答のJSONパースに失敗しました: {e}\n生応答: {text[:500]}"
        )

    return {
        "model": used_model,
        "requested_model": MODEL,
        "summary": summary,
        "ai": result,
    }
