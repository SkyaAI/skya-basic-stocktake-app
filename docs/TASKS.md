# Tasks & Sprints

## Sprint 1 — DB + Core Entry Engine ✦ v1 functional milestone
**Goal:** Staff can enter a product code + count and see the grouped report. No login required. Demo data visible on first load.

- [ ] Write and apply migration SQL (categories, products, sessions, entries + RLS v1 policies + seed data)
- [ ] Build session list page — shows open sessions, loading / empty / error states
- [ ] Build entry page — product code input (mobile keyboard-friendly), count field, submit button → inserts to `stocktake_entries`
- [ ] Product lookup on code entry — fuzzy match against `products`, display name + category inline
- [ ] Edit / delete entry within session
- [ ] Report view — SQL group-by category, sum counts, renders grouped table immediately after last entry
- [ ] All states handled: loading skeleton, empty session message, error toast, ready state
- [ ] Verify: no dead buttons; every form persists to DB; UI reflects saved data without refresh

**Definition of Done:** A tester on a phone opens the app, picks a session, enters 4 product codes with counts, taps "Report", and sees a correctly grouped category summary — all data confirmed in Supabase table viewer.

---

## Sprint 2 — Product Catalogue & Search Polish
**Goal:** Staff can manage the product list and get autocomplete on code entry.

- [ ] Product catalogue CRUD page (add / edit / delete product + category assignment)
- [ ] Autocomplete dropdown on product code input (debounced search)
- [ ] Add-new-product flow inline (medium-risk: staff confirms before saving)
- [ ] Category management (add / rename categories)
- [ ] Count anomaly highlight (flag entry if count > 3× session average)

**Definition of Done:** Staff can add an unrecognised product inline, assign it a category, and see it appear correctly in the report grouping.

---

## Sprint 3 — Lock It Down (Auth + Per-User Isolation)
**Goal:** Real users log in; each user sees only their own sessions and data.

- [ ] Supabase Auth (email/password or magic link)
- [ ] Login / signup pages
- [ ] Replace v1 RLS policies with `auth.uid() = user_id` owner-scoped policies
- [ ] Populate `user_id` on all inserts post-auth
- [ ] Remove public write access; anon can only view demo seed rows (or redirect to login)

**Definition of Done:** Two test accounts cannot see each other's sessions or entries. Unauthenticated POST requests are rejected by RLS.

---

## Sprint 4 — Export & Smart Features
**Goal:** Useful extras after the core is proven.

- [ ] Export report to CSV
- [ ] Session history and close/archive workflow
- [ ] AI category suggestion for unrecognised product codes (LLM, stored with confidence + review_status)
- [ ] Audit log viewer for session changes

---

## Gantt (sprint → feature)
```
Sprint 1  |  DB schema · entry form · product lookup · report view
Sprint 2  |  catalogue CRUD · autocomplete · anomaly flag
Sprint 3  |  auth · RLS lock-down · user isolation
Sprint 4  |  CSV export · session archive · AI category · audit viewer
```
