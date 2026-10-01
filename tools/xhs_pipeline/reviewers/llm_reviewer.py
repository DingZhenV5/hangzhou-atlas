"""Opt-in OpenAI-compatible structured reviewer; never applies suggestions."""
from __future__ import annotations

import json
import os
import urllib.request


SYSTEM_PROMPT = """你是杭州周末地图的小红书候选审核器。只输出 JSON 对象，不写数据库。
按严格证据将候选分类为 POI/ROUTE/COLLECTION/INVALID/UNKNOWN；抽取原文明确写出的路线节点，不猜坐标。
已有对象优先，无法确认则 HUMAN_REVIEW。点赞收藏只代表热度。返回字段：type,type_confidence,mapability_score,quality_score,raw_place_names,raw_route_text,existing_match,suggested_action,reason,proposed_changes。
建议动作只能是 REJECT/MERGE/UPDATE_EXISTING/ADD/HUMAN_REVIEW。confidence < 0.8 或信息不足必须 HUMAN_REVIEW。"""


def review(candidate: dict, database_context: dict | None = None) -> dict:
    endpoint = os.environ.get("XHS_LLM_ENDPOINT", "").strip()
    api_key = os.environ.get("XHS_LLM_API_KEY", "").strip()
    model = os.environ.get("XHS_LLM_MODEL", "").strip()
    if not (endpoint and api_key and model):
        return {"status": "not_configured", "reason": "需显式配置 XHS_LLM_ENDPOINT / XHS_LLM_API_KEY / XHS_LLM_MODEL"}
    body = {
        "model": model,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps({"candidate": candidate, "existing_data": database_context or {}}, ensure_ascii=False)},
        ],
    }
    req = urllib.request.Request(endpoint, data=json.dumps(body).encode(), headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=60) as response:
        content = json.load(response)["choices"][0]["message"]["content"]
    result = json.loads(content)
    confidence = float(result.get("type_confidence", 0))
    if confidence < 0.8 or result.get("suggested_action") not in {"REJECT", "MERGE", "UPDATE_EXISTING", "ADD", "HUMAN_REVIEW"}:
        result["suggested_action"] = "HUMAN_REVIEW"
    result["status"] = "completed"
    result["confidence_gate"] = "passed" if confidence >= 0.8 else "human_review"
    return result
