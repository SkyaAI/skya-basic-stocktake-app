# Intelligence Layer

## Messy Input
Staff type free-text product codes ("wh42", "WH 0042", "wh-0042"). Categories are often missing or inconsistently named in legacy data.

## Auto-Structure (v1 rule-based)
- Normalise product code on input: strip spaces, uppercase, add dash if pattern matches `WH\d+`
- Match entered code against `products.code` (fuzzy: Postgres `ilike '%input%'`)
- Return `category.name` from FK — no AI needed for matched products

## AI Fields (stored per product)
```json
{
  "ai_category_suggestion": "Packaging",
  "ai_category_source": "gpt-4o-mini / keyword-rule",
  "ai_category_confidence": 0.82,
  "ai_category_review_status": "unreviewed"
}
```

## Events to Track
- Product code entered but not found in catalogue
- Count value > 3× the session average for that product (anomaly flag)
- Session closed without all expected products counted

## Scoring Rules (v1)
- Count anomaly score = `entered_count / session_avg_for_product` — flag if > 3
- Category confidence: rule-based keyword match scores 0.6; LLM match scores as returned

## v1 vs Later
- **v1:** Rule-based code normalisation + fuzzy match; anomaly flag displayed inline
- **Later:** LLM-suggested category for unrecognised products; bulk-import assistant
