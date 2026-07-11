# Architecture

## Stack
- **Frontend:** Next.js (App Router) — mobile-first responsive UI
- **Database:** Supabase (Postgres + RLS)
- **Hosting:** Vercel

## Build Sequence
**Now:** DB schema → CRUD for sessions + entries → live report view (no login)
**Next:** Product catalogue management, search/autocomplete by code
**Later:** Auth + per-user sessions, export to CSV, barcode input

## Key User Action — Step by Step
1. Staff opens app → lands on active session list (seeded demo visible immediately)
2. Taps session → sees entry list for that session
3. Types a product code → app looks up product in `products` table, returns name + category
4. Staff enters count → form submits → `stocktake_entries` row inserted in Supabase
5. UI re-renders entry list live (Supabase real-time or re-fetch)
6. Staff taps "Report" → query groups entries by `category`, sums counts → renders grouped table

## Layer Plan
1. **Data layer first** — tables, constraints, RLS policies, seed data
2. **App logic** — Next.js server actions / API routes for insert, update, delete, report query
3. **Smart features later** — AI-suggested category assignment, anomaly flagging on unusually high counts

## Core Without AI
The entire flow (enter count → grouped report) is pure SQL aggregation. AI is additive only — the app is fully functional without it.
