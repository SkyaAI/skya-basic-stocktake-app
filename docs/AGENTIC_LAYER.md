# Agentic Layer

## Risk Levels & Actions

### Low — auto-execute (no approval)
- **Normalise product code** on keystroke (strip/format) → display cleaned code
- **Flag count anomaly** — highlight entry if count is unusually high vs session average
- **Auto-suggest category** for unrecognised product code (LLM, stored with `review_status = unreviewed`)

### Medium — light approval (staff confirms before save)
- **Add new product to catalogue** from free-text entry — prefill form, staff taps confirm
- **Merge duplicate product codes** — suggest merge, require tap to approve

### High — always requires explicit approval
- **Close a stocktake session** — locks entries, triggers report finalisation
- **Bulk-delete all entries in a session** — confirmation modal required

### Critical — human only
- **Delete a product from the catalogue** — permanent, no agent action permitted
- **Overwrite a closed session's data** — manual only, logged

## Named Tools (v1)
- `normalise_product_code(raw: string) → string`
- `lookup_product(code: string) → Product | null`
- `flag_anomaly(entry_id, session_id) → boolean`

## Audit Log Fields
`action`, `table_name`, `record_id`, `actor` (user_id or 'system'), `old_value`, `new_value`, `created_at`

## v1 vs Later
- **v1:** Normalise + lookup + anomaly flag (all low-risk, auto)
- **Later:** LLM category suggestion with approval UI; session-close workflow
