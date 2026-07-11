# PRD — Skya Basic Stocktake App

## Problem
Warehouse staff write stock counts on paper, then manually re-enter them into Excel and build a pivot table to produce a category summary. This wastes hours per stocktake cycle.

## Target User
Warehouse personnel who move around the floor during a count and need a fast, phone-friendly input method.

## Core Objects
- **Category** — groups products (e.g. "Electronics", "Packaging")
- **Product** — product code + name, belongs to a category
- **StocktakeSession** — a named count run (e.g. "June Week 2")
- **StocktakeEntry** — product + session + count recorded by staff

## MVP Must-Haves (v1 checklist)
- [ ] Create / select a stocktake session
- [ ] Search or enter a product code on mobile and record a stock count
- [ ] Edit or delete an entry within the same session
- [ ] Instant report view: product code + count, grouped by category, for a session
- [ ] Report works without any export step — visible immediately after last entry
- [ ] Seed demo data so the app is viewable without login

## Non-Goals (v1)
- User accounts, login, or per-user isolation
- Exporting to Excel / PDF
- Barcode / QR scanning
- Multi-warehouse or multi-team support
- Historical trend charts

## Success Criteria
**Scenario:** A staff member opens the app on their phone, selects "Morning Count", enters product code `WH-0042` with a count of `14`, adds three more entries, then taps "View Report" and immediately sees all entries grouped under the correct categories — without touching Excel.

**Pass/Fail line:** The report renders the correct category groupings and counts within 2 seconds of the last entry being saved, with no manual steps in between.
