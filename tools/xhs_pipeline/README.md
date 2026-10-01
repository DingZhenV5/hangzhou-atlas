# 小红书候选审核 Pipeline

此工具把采集 CSV 变成独立审核候选，不会写 `data/places.json` 或 `data/routes.json`。

## 运行

```powershell
python tools/xhs_pipeline.py path/to/xhs-batch.csv `
  --places-review path/to/xhs-places-review.csv `
  --routes-review path/to/xhs-routes-review.csv `
  --output-dir private/local-only/research/xhs-audit/YYYY-MM-DD
```

默认只运行确定性规则。`--ai-review llm` 是明确联网选项，会把候选原文及最相近的主库对象发往环境变量指定的 OpenAI 兼容接口；需配置 `XHS_LLM_ENDPOINT`、`XHS_LLM_API_KEY`、`XHS_LLM_MODEL`。AI 只产生审核意见，不写正式数据；低置信度或与规则不一致时转人工审核。

## 输出

- `xhs-candidates-review.json` / `.csv`：统一 Candidate Layer 和人工审核字段。
- `poi-match-report.csv`、`route-match-report.csv`：可解释的匹配子分数、站点映射和差异。
- `rejected-candidates.csv`：规则拒绝项及理由。
- `review.html`：离线审核页。决定保存在浏览器 localStorage，可导出 JSON。
- `xhs-audit-summary.md`：本批统计、限制及质量发现。

路线几何只有在正式数据将来提供可信轨迹并标记为非 overview-only 后才有比较意义。当前路线是浏览示意线，因此 `geo_similarity` 为 null，不对画线作轨迹相似度计算。

## 应用人工审核

审核页导出的决定默认只是决定记录。若确需改主库，应在导出的 JSON 中为每条接受项人工补齐 `human_payload`：

- 新增：`{"collection":"places|routes","record":{...完整正式数据对象...}}`
- 合并/更新：`{"collection":"places|routes","target_id":"现有ID","changes":{...}}`

新增 POI 坐标、路线 stops/path 必须由人核实并明确填写。然后先运行 dry-run：

```powershell
python tools/apply_xhs_review.py xhs-human-decisions.json
```

正式写入必须再显式加 `--apply`。脚本会先备份两个正式 JSON，校验通过后再写；可加 `--validate-build` 调用现有网站数据校验，失败则恢复备份。单纯 AI 或 XHS 候选没有写库权限。
