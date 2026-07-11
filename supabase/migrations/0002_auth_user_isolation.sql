-- Lock down demo-mode public access and isolate rows per signed-in user.
-- Existing seed/demo rows with null user_id remain in the database but are hidden by RLS.

grant usage on schema public to authenticated;
grant select, insert, update, delete on
  categories,
  products,
  stocktake_sessions,
  stocktake_entries
to authenticated;
grant select, insert on audit_logs to authenticated;

revoke all on
  categories,
  products,
  stocktake_sessions,
  stocktake_entries,
  audit_logs
from anon;

alter table categories alter column user_id set default auth.uid();
alter table products alter column user_id set default auth.uid();
alter table stocktake_sessions alter column user_id set default auth.uid();
alter table stocktake_entries alter column user_id set default auth.uid();
alter table audit_logs alter column user_id set default auth.uid();

drop policy if exists "categories_v1_read" on categories;
drop policy if exists "categories_v1_write" on categories;
drop policy if exists "products_v1_read" on products;
drop policy if exists "products_v1_write" on products;
drop policy if exists "stocktake_sessions_v1_read" on stocktake_sessions;
drop policy if exists "stocktake_sessions_v1_write" on stocktake_sessions;
drop policy if exists "stocktake_entries_v1_read" on stocktake_entries;
drop policy if exists "stocktake_entries_v1_write" on stocktake_entries;
drop policy if exists "audit_logs_v1_read" on audit_logs;
drop policy if exists "audit_logs_v1_write" on audit_logs;

create policy "categories_owner_select"
  on categories for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "categories_owner_insert"
  on categories for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "categories_owner_update"
  on categories for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "categories_owner_delete"
  on categories for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "products_owner_select"
  on products for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "products_owner_insert"
  on products for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "products_owner_update"
  on products for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "products_owner_delete"
  on products for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "stocktake_sessions_owner_select"
  on stocktake_sessions for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "stocktake_sessions_owner_insert"
  on stocktake_sessions for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "stocktake_sessions_owner_update"
  on stocktake_sessions for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "stocktake_sessions_owner_delete"
  on stocktake_sessions for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "stocktake_entries_owner_select"
  on stocktake_entries for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "stocktake_entries_owner_insert"
  on stocktake_entries for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "stocktake_entries_owner_update"
  on stocktake_entries for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "stocktake_entries_owner_delete"
  on stocktake_entries for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "audit_logs_owner_select"
  on audit_logs for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "audit_logs_owner_insert"
  on audit_logs for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create index if not exists categories_user_id_idx on categories(user_id);
create index if not exists products_user_id_idx on products(user_id);
create index if not exists stocktake_sessions_user_id_idx on stocktake_sessions(user_id);
create index if not exists stocktake_entries_user_id_idx on stocktake_entries(user_id);
