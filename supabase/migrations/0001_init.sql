create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  name text not null,
  created_at timestamptz not null default now()
);

alter table categories enable row level security;
drop policy if exists "categories_v1_read" on categories;
create policy "categories_v1_read" on categories for select using (true);
drop policy if exists "categories_v1_write" on categories;
create policy "categories_v1_write" on categories for all using (true) with check (true);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  code text not null,
  name text not null,
  category_id uuid references categories(id),
  ai_category_suggestion text,
  ai_category_source text,
  ai_category_confidence numeric,
  ai_category_review_status text default 'unreviewed',
  created_at timestamptz not null default now()
);

alter table products enable row level security;
drop policy if exists "products_v1_read" on products;
create policy "products_v1_read" on products for select using (true);
drop policy if exists "products_v1_write" on products;
create policy "products_v1_write" on products for all using (true) with check (true);

create table if not exists stocktake_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  name text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

alter table stocktake_sessions enable row level security;
drop policy if exists "stocktake_sessions_v1_read" on stocktake_sessions;
create policy "stocktake_sessions_v1_read" on stocktake_sessions for select using (true);
drop policy if exists "stocktake_sessions_v1_write" on stocktake_sessions;
create policy "stocktake_sessions_v1_write" on stocktake_sessions for all using (true) with check (true);

create table if not exists stocktake_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  session_id uuid references stocktake_sessions(id),
  product_id uuid references products(id),
  count integer not null default 0,
  created_at timestamptz not null default now()
);

alter table stocktake_entries enable row level security;
drop policy if exists "stocktake_entries_v1_read" on stocktake_entries;
create policy "stocktake_entries_v1_read" on stocktake_entries for select using (true);
drop policy if exists "stocktake_entries_v1_write" on stocktake_entries;
create policy "stocktake_entries_v1_write" on stocktake_entries for all using (true) with check (true);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  action text not null,
  table_name text not null,
  record_id uuid,
  actor text,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

alter table audit_logs enable row level security;
drop policy if exists "audit_logs_v1_read" on audit_logs;
create policy "audit_logs_v1_read" on audit_logs for select using (true);
drop policy if exists "audit_logs_v1_write" on audit_logs;
create policy "audit_logs_v1_write" on audit_logs for all using (true) with check (true);

insert into categories (id, name) values
  ('a1000000-0000-0000-0000-000000000001', 'Electronics'),
  ('a1000000-0000-0000-0000-000000000002', 'Packaging'),
  ('a1000000-0000-0000-0000-000000000003', 'Hardware')
on conflict do nothing;

insert into products (id, code, name, category_id) values
  ('b1000000-0000-0000-0000-000000000001', 'EL-0011', 'USB-C Charging Cable', 'a1000000-0000-0000-0000-000000000001'),
  ('b1000000-0000-0000-0000-000000000002', 'EL-0033', 'AA Battery Pack x8', 'a1000000-0000-0000-0000-000000000001'),
  ('b1000000-0000-0000-0000-000000000003', 'PK-0007', 'Cardboard Box 30cm', 'a1000000-0000-0000-0000-000000000002'),
  ('b1000000-0000-0000-0000-000000000004', 'WH-0042', 'Bubble Wrap Roll 50m', 'a1000000-0000-0000-0000-000000000002'),
  ('b1000000-0000-0000-0000-000000000005', 'HW-0019', 'M6 Hex Bolt x100', 'a1000000-0000-0000-0000-000000000003'),
  ('b1000000-0000-0000-0000-000000000006', 'HW-0022', 'Cable Tie Pack 200mm', 'a1000000-0000-0000-0000-000000000003')
on conflict do nothing;

insert into stocktake_sessions (id, name, status) values
  ('c1000000-0000-0000-0000-000000000001', 'Morning Count', 'open'),
  ('c1000000-0000-0000-0000-000000000002', 'End of Day Check', 'open')
on conflict do nothing;

insert into stocktake_entries (session_id, product_id, count) values
  ('c1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 24),
  ('c1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000003', 60),
  ('c1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000004', 14),
  ('c1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000005', 200),
  ('c1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000002', 48),
  ('c1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000006', 35)
on conflict do nothing;