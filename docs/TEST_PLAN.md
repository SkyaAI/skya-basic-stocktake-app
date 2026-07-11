# Test Plan

## v1 Success Scenario (manual, on a phone)
1. Open app URL — session list loads with at least one demo session visible (no login prompt).
2. Tap demo session "Morning Count" → entry list appears (demo entries visible).
3. Type `WH-0042` in the product code field → product name "Bubble Wrap Roll" and category "Packaging" appear inline.
4. Enter count `14` → tap "Save" → entry appears in list immediately.
5. Repeat for product codes `EL-0011`, `EL-0033`, `PK-0007` with arbitrary counts.
6. Tap "View Report" → report renders grouped by category with correct summed counts.
7. Confirm in Supabase table viewer that `stocktake_entries` has 4 new rows with correct `product_id`, `session_id`, and `count`.

**Pass:** Report visible within 2 seconds, groupings correct, all 4 rows in DB.
**Fail:** Any entry not saved, grouping wrong, or report requires manual refresh.

---

## Empty State Tests
- Open a brand-new session with zero entries → entry list shows "No entries yet. Start counting!"
- Search for a product code that doesn't exist → inline message "Product not found — add it to the catalogue?"

## Error State Tests
- Submit entry with blank count → form shows "Count is required" inline, no DB write.
- Submit entry with count = `-1` → form shows "Count must be 0 or more", no DB write.
- Simulate network drop → error toast "Could not save entry. Check your connection."

## Edit / Delete Tests
- Tap an entry → edit count from `14` to `20` → save → list and report reflect `20`.
- Delete an entry → it disappears from list; report recalculates immediately.

## Report Accuracy Test
- Enter 2 entries for the same product in one session → report shows summed total, not duplicates.
