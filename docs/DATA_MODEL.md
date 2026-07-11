# Data Model

## categories
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | gen_random_uuid() |
| user_id | uuid nullable | owner-scoping at lock-down |
| name | text not null | e.g. "Electronics" |
| created_at | timestamptz | default now() |

## products
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid nullable | |
| code | text not null unique | e.g. "WH-0042" |
| name | text not null | display name |
| category_id | uuid FK → categories | |
| ai_category_suggestion | text | AI field: suggested category name |
| ai_category_source | text | model / rule that produced it |
| ai_category_confidence | numeric | 0–1 |
| ai_category_review_status | text default 'unreviewed' | unreviewed / accepted / rejected |
| created_at | timestamptz | |

## stocktake_sessions
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid nullable | |
| name | text not null | e.g. "June Week 2" |
| status | text default 'open' | open / closed |
| created_at | timestamptz | |

## stocktake_entries
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid nullable | |
| session_id | uuid FK → stocktake_sessions | |
| product_id | uuid FK → products | |
| count | integer not null | staff-entered count |
| created_at | timestamptz | |

## RLS
All tables: RLS enabled. v1 permissive policies allow all reads and writes (no login required). Lock-down sprint replaces with `auth.uid() = user_id` policies.

## Relationships
`categories` 1→N `products` 1→N `stocktake_entries` N→1 `stocktake_sessions`
