# Security

## Secret Handling
- Supabase service-role key never exposed to the browser — used only in Next.js server actions / API routes
- All client calls use the anon key with RLS as the enforcement layer
- `.env.local` holds all secrets; committed `.env.example` has only placeholder keys

## Permission Model (v1 → lock-down)
- **v1:** Permissive RLS — all tables readable and writable by anyone (demo mode)
- **Lock-down sprint:** Replace with `auth.uid() = user_id` row-level policies; anon access revoked
- Agents inherit the session's permission level — no elevated service-role calls from client code

## Approved Tools Rule
- Only named, scoped server-side functions are callable (see Agentic Layer)
- No `eval`, `run_any`, or raw shell execution permitted
- LLM calls are server-side only; prompt + response logged to audit table

## Audit Principle
- Every insert / update / delete on `stocktake_entries` and `products` writes an audit row
- Audit rows are append-only — no update or delete policy on `audit_logs`
- If a security or data-loss concern arises that exceeds the builder's expertise, stop and consult a qualified engineer before proceeding
