-- Move stocktake business data from per-user ownership to shared organisation ownership.
-- This migration is additive first: existing user_id columns are kept for audit/rollback.

create table if not exists organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists organisation_members (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  invited_email text,
  role text not null default 'warehouse_staff'
    check (role in ('warehouse_staff', 'supervisor', 'admin')),
  status text not null default 'active'
    check (status in ('pending', 'active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, user_id),
  unique (organisation_id, invited_email)
);

create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, name)
);

create table if not exists erp_exports (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  session_id uuid references stocktake_sessions(id) on delete set null,
  generated_by_user_id uuid references auth.users(id) on delete set null,
  export_type text not null,
  created_at timestamptz not null default now()
);

create table if not exists user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  email text not null,
  created_at timestamptz not null default now()
);

alter table user_profiles
  add column if not exists display_name text,
  add column if not exists default_organisation_id uuid references organisations(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table categories
  add column if not exists organisation_id uuid references organisations(id) on delete cascade,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table products
  add column if not exists organisation_id uuid references organisations(id) on delete cascade,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table stocktake_sessions
  add column if not exists organisation_id uuid references organisations(id) on delete cascade,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table stocktake_entries
  add column if not exists organisation_id uuid references organisations(id) on delete cascade,
  add column if not exists entered_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table audit_logs
  add column if not exists organisation_id uuid references organisations(id) on delete set null;

-- Create one organisation for each existing owner and one shared legacy organisation
-- for any pre-auth seed/demo rows that have null user_id.
insert into organisations (id, name, created_by)
select gen_random_uuid(), coalesce(up.username, 'Skya Stocktake Organisation'), owners.user_id
from (
  select distinct user_id from categories where user_id is not null
  union
  select distinct user_id from products where user_id is not null
  union
  select distinct user_id from stocktake_sessions where user_id is not null
  union
  select distinct user_id from stocktake_entries where user_id is not null
) owners
left join user_profiles up on up.id = owners.user_id
where not exists (
  select 1 from organisation_members om
  where om.user_id = owners.user_id
    and om.role = 'admin'
    and om.status = 'active'
);

insert into organisations (id, name)
select gen_random_uuid(), 'Skya Stocktake Organisation'
where exists (
  select 1 from categories where user_id is null
  union all
  select 1 from products where user_id is null
  union all
  select 1 from stocktake_sessions where user_id is null
  union all
  select 1 from stocktake_entries where user_id is null
)
and not exists (
  select 1 from organisations where name = 'Skya Stocktake Organisation' and created_by is null
);

insert into organisation_members (organisation_id, user_id, role, status)
select distinct on (o.created_by) o.id, o.created_by, 'admin', 'active'
from organisations o
where o.created_by is not null
on conflict (organisation_id, user_id) do nothing;

update user_profiles up
set default_organisation_id = om.organisation_id,
    display_name = coalesce(up.display_name, up.username),
    updated_at = now()
from organisation_members om
where om.user_id = up.id
  and om.role = 'admin'
  and om.status = 'active'
  and up.default_organisation_id is null;

with owner_orgs as (
  select user_id, min(organisation_id::text)::uuid as organisation_id
  from organisation_members
  where user_id is not null and role = 'admin' and status = 'active'
  group by user_id
),
legacy_org as (
  select id as organisation_id
  from organisations
  where name = 'Skya Stocktake Organisation' and created_by is null
  order by created_at
  limit 1
)
update categories c
set organisation_id = coalesce(
      (select oo.organisation_id from owner_orgs oo where oo.user_id = c.user_id),
      (select lo.organisation_id from legacy_org lo)
    ),
    created_by = coalesce(c.created_by, c.user_id),
    updated_at = now()
where c.organisation_id is null;

with owner_orgs as (
  select user_id, min(organisation_id::text)::uuid as organisation_id
  from organisation_members
  where user_id is not null and role = 'admin' and status = 'active'
  group by user_id
),
legacy_org as (
  select id as organisation_id
  from organisations
  where name = 'Skya Stocktake Organisation' and created_by is null
  order by created_at
  limit 1
)
update products p
set organisation_id = coalesce(
      (select oo.organisation_id from owner_orgs oo where oo.user_id = p.user_id),
      (select c.organisation_id from categories c where c.id = p.category_id),
      (select lo.organisation_id from legacy_org lo)
    ),
    created_by = coalesce(p.created_by, p.user_id),
    updated_at = now()
where p.organisation_id is null;

with owner_orgs as (
  select user_id, min(organisation_id::text)::uuid as organisation_id
  from organisation_members
  where user_id is not null and role = 'admin' and status = 'active'
  group by user_id
),
legacy_org as (
  select id as organisation_id
  from organisations
  where name = 'Skya Stocktake Organisation' and created_by is null
  order by created_at
  limit 1
)
update stocktake_sessions s
set organisation_id = coalesce(
      (select oo.organisation_id from owner_orgs oo where oo.user_id = s.user_id),
      (select lo.organisation_id from legacy_org lo)
    ),
    created_by = coalesce(s.created_by, s.user_id),
    updated_at = now()
where s.organisation_id is null;

update stocktake_entries e
set organisation_id = coalesce(
      s.organisation_id,
      (select p.organisation_id from products p where p.id = e.product_id)
    ),
    entered_by_user_id = coalesce(e.entered_by_user_id, e.user_id),
    updated_at = now()
from stocktake_sessions s
where e.session_id = s.id
  and e.organisation_id is null;

update audit_logs a
set organisation_id = coalesce(a.organisation_id, oo.organisation_id)
from (
  select user_id, min(organisation_id::text)::uuid as organisation_id
  from organisation_members
  where user_id is not null and status = 'active'
  group by user_id
) oo
where a.user_id = oo.user_id
  and a.organisation_id is null;

create or replace function public.current_user_org_role(org_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select om.role
  from organisation_members om
  where om.organisation_id = org_id
    and om.user_id = (select auth.uid())
    and om.status = 'active'
  limit 1
$$;

create or replace function public.current_user_is_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_org_role(org_id) is not null
$$;

create or replace function public.current_user_can_manage_org(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_org_role(org_id) = 'admin'
$$;

create or replace function public.current_user_can_manage_sessions(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_org_role(org_id) in ('admin', 'supervisor')
$$;

revoke all on function public.current_user_org_role(uuid) from public;
revoke all on function public.current_user_is_org_member(uuid) from public;
revoke all on function public.current_user_can_manage_org(uuid) from public;
revoke all on function public.current_user_can_manage_sessions(uuid) from public;
grant execute on function public.current_user_org_role(uuid) to authenticated;
grant execute on function public.current_user_is_org_member(uuid) to authenticated;
grant execute on function public.current_user_can_manage_org(uuid) to authenticated;
grant execute on function public.current_user_can_manage_sessions(uuid) to authenticated;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  desired_username text;
  target_org uuid;
begin
  desired_username := lower(regexp_replace(coalesce(new.raw_user_meta_data->>'username', ''), '[^a-zA-Z0-9_]', '', 'g'));

  if length(desired_username) < 3 then
    desired_username := 'user_' || replace(left(new.id::text, 8), '-', '');
  end if;

  update public.organisation_members
  set user_id = new.id,
      status = 'active',
      updated_at = now()
  where user_id is null
    and status = 'pending'
    and lower(invited_email) = lower(coalesce(new.email, ''));

  select organisation_id
    into target_org
  from public.organisation_members
  where user_id = new.id
    and status = 'active'
  order by created_at
  limit 1;

  if target_org is null then
    insert into public.organisations (name, created_by)
    values (coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), desired_username) || ' Organisation', new.id)
    returning id into target_org;

    insert into public.organisation_members (organisation_id, user_id, role, status)
    values (target_org, new.id, 'admin', 'active');
  end if;

  insert into public.user_profiles (id, username, email, display_name, default_organisation_id)
  values (new.id, desired_username, coalesce(new.email, ''), desired_username, target_org)
  on conflict (id) do update
    set username = excluded.username,
        email = excluded.email,
        display_name = coalesce(public.user_profiles.display_name, excluded.display_name),
        default_organisation_id = coalesce(public.user_profiles.default_organisation_id, excluded.default_organisation_id),
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;

create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

alter table user_profiles enable row level security;
alter table organisations enable row level security;
alter table organisation_members enable row level security;
alter table locations enable row level security;
alter table erp_exports enable row level security;

grant usage on schema public to authenticated;
grant select on user_profiles to anon, authenticated;
grant update on user_profiles to authenticated;
grant select, insert, update, delete on
  organisations,
  organisation_members,
  locations,
  categories,
  products,
  stocktake_sessions,
  stocktake_entries,
  erp_exports
to authenticated;
grant select, insert on audit_logs to authenticated;

drop policy if exists "categories_owner_select" on categories;
drop policy if exists "categories_owner_insert" on categories;
drop policy if exists "categories_owner_update" on categories;
drop policy if exists "categories_owner_delete" on categories;
drop policy if exists "products_owner_select" on products;
drop policy if exists "products_owner_insert" on products;
drop policy if exists "products_owner_update" on products;
drop policy if exists "products_owner_delete" on products;
drop policy if exists "stocktake_sessions_owner_select" on stocktake_sessions;
drop policy if exists "stocktake_sessions_owner_insert" on stocktake_sessions;
drop policy if exists "stocktake_sessions_owner_update" on stocktake_sessions;
drop policy if exists "stocktake_sessions_owner_delete" on stocktake_sessions;
drop policy if exists "stocktake_entries_owner_select" on stocktake_entries;
drop policy if exists "stocktake_entries_owner_insert" on stocktake_entries;
drop policy if exists "stocktake_entries_owner_update" on stocktake_entries;
drop policy if exists "stocktake_entries_owner_delete" on stocktake_entries;
drop policy if exists "audit_logs_owner_select" on audit_logs;
drop policy if exists "audit_logs_owner_insert" on audit_logs;

drop policy if exists "user_profiles_username_lookup" on user_profiles;
drop policy if exists "user_profiles_owner_update" on user_profiles;
drop policy if exists "organisations_member_select" on organisations;
drop policy if exists "organisations_admin_insert" on organisations;
drop policy if exists "organisations_admin_update" on organisations;
drop policy if exists "organisation_members_select" on organisation_members;
drop policy if exists "organisation_members_admin_insert" on organisation_members;
drop policy if exists "organisation_members_admin_update" on organisation_members;
drop policy if exists "organisation_members_admin_delete" on organisation_members;
drop policy if exists "locations_member_select" on locations;
drop policy if exists "locations_admin_write" on locations;
drop policy if exists "categories_member_select" on categories;
drop policy if exists "categories_admin_insert" on categories;
drop policy if exists "categories_admin_update" on categories;
drop policy if exists "categories_admin_delete" on categories;
drop policy if exists "products_member_select" on products;
drop policy if exists "products_admin_insert" on products;
drop policy if exists "products_admin_update" on products;
drop policy if exists "products_admin_delete" on products;
drop policy if exists "stocktake_sessions_member_select" on stocktake_sessions;
drop policy if exists "stocktake_sessions_supervisor_insert" on stocktake_sessions;
drop policy if exists "stocktake_sessions_supervisor_update" on stocktake_sessions;
drop policy if exists "stocktake_sessions_admin_delete" on stocktake_sessions;
drop policy if exists "stocktake_entries_member_select" on stocktake_entries;
drop policy if exists "stocktake_entries_member_insert" on stocktake_entries;
drop policy if exists "stocktake_entries_supervisor_update" on stocktake_entries;
drop policy if exists "stocktake_entries_supervisor_delete" on stocktake_entries;
drop policy if exists "erp_exports_member_select" on erp_exports;
drop policy if exists "erp_exports_member_insert" on erp_exports;
drop policy if exists "audit_logs_member_select" on audit_logs;
drop policy if exists "audit_logs_member_insert" on audit_logs;

create policy "user_profiles_username_lookup"
  on user_profiles for select
  to anon, authenticated
  using (true);

create policy "user_profiles_owner_update"
  on user_profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "organisations_member_select"
  on organisations for select
  to authenticated
  using (public.current_user_is_org_member(id));

create policy "organisations_admin_insert"
  on organisations for insert
  to authenticated
  with check ((select auth.uid()) = created_by);

create policy "organisations_admin_update"
  on organisations for update
  to authenticated
  using (public.current_user_can_manage_org(id))
  with check (public.current_user_can_manage_org(id));

create policy "organisation_members_select"
  on organisation_members for select
  to authenticated
  using (public.current_user_is_org_member(organisation_id));

create policy "organisation_members_admin_insert"
  on organisation_members for insert
  to authenticated
  with check (public.current_user_can_manage_org(organisation_id));

create policy "organisation_members_admin_update"
  on organisation_members for update
  to authenticated
  using (public.current_user_can_manage_org(organisation_id))
  with check (public.current_user_can_manage_org(organisation_id));

create policy "organisation_members_admin_delete"
  on organisation_members for delete
  to authenticated
  using (public.current_user_can_manage_org(organisation_id));

create policy "locations_member_select"
  on locations for select
  to authenticated
  using (public.current_user_is_org_member(organisation_id));

create policy "locations_admin_write"
  on locations for all
  to authenticated
  using (public.current_user_can_manage_org(organisation_id))
  with check (public.current_user_can_manage_org(organisation_id));

create policy "categories_member_select"
  on categories for select
  to authenticated
  using (public.current_user_is_org_member(organisation_id));

create policy "categories_admin_insert"
  on categories for insert
  to authenticated
  with check (public.current_user_can_manage_org(organisation_id));

create policy "categories_admin_update"
  on categories for update
  to authenticated
  using (public.current_user_can_manage_org(organisation_id))
  with check (public.current_user_can_manage_org(organisation_id));

create policy "categories_admin_delete"
  on categories for delete
  to authenticated
  using (public.current_user_can_manage_org(organisation_id));

create policy "products_member_select"
  on products for select
  to authenticated
  using (public.current_user_is_org_member(organisation_id));

create policy "products_admin_insert"
  on products for insert
  to authenticated
  with check (public.current_user_can_manage_org(organisation_id));

create policy "products_admin_update"
  on products for update
  to authenticated
  using (public.current_user_can_manage_org(organisation_id))
  with check (public.current_user_can_manage_org(organisation_id));

create policy "products_admin_delete"
  on products for delete
  to authenticated
  using (public.current_user_can_manage_org(organisation_id));

create policy "stocktake_sessions_member_select"
  on stocktake_sessions for select
  to authenticated
  using (public.current_user_is_org_member(organisation_id));

create policy "stocktake_sessions_supervisor_insert"
  on stocktake_sessions for insert
  to authenticated
  with check (public.current_user_can_manage_sessions(organisation_id));

create policy "stocktake_sessions_supervisor_update"
  on stocktake_sessions for update
  to authenticated
  using (public.current_user_can_manage_sessions(organisation_id))
  with check (public.current_user_can_manage_sessions(organisation_id));

create policy "stocktake_sessions_admin_delete"
  on stocktake_sessions for delete
  to authenticated
  using (public.current_user_can_manage_org(organisation_id));

create policy "stocktake_entries_member_select"
  on stocktake_entries for select
  to authenticated
  using (public.current_user_is_org_member(organisation_id));

create policy "stocktake_entries_member_insert"
  on stocktake_entries for insert
  to authenticated
  with check (
    public.current_user_is_org_member(organisation_id)
    and (select auth.uid()) = entered_by_user_id
  );

create policy "stocktake_entries_supervisor_update"
  on stocktake_entries for update
  to authenticated
  using (public.current_user_can_manage_sessions(organisation_id))
  with check (public.current_user_can_manage_sessions(organisation_id));

create policy "stocktake_entries_supervisor_delete"
  on stocktake_entries for delete
  to authenticated
  using (public.current_user_can_manage_sessions(organisation_id));

create policy "erp_exports_member_select"
  on erp_exports for select
  to authenticated
  using (public.current_user_is_org_member(organisation_id));

create policy "erp_exports_member_insert"
  on erp_exports for insert
  to authenticated
  with check (
    public.current_user_is_org_member(organisation_id)
    and (select auth.uid()) = generated_by_user_id
  );

create policy "audit_logs_member_select"
  on audit_logs for select
  to authenticated
  using (public.current_user_is_org_member(organisation_id));

create policy "audit_logs_member_insert"
  on audit_logs for insert
  to authenticated
  with check (public.current_user_is_org_member(organisation_id));

create index if not exists organisation_members_user_id_idx on organisation_members(user_id);
create index if not exists organisation_members_invited_email_idx on organisation_members(lower(invited_email));
create index if not exists organisation_members_org_status_idx on organisation_members(organisation_id, status);
create index if not exists categories_organisation_id_idx on categories(organisation_id);
create index if not exists products_organisation_id_idx on products(organisation_id);
create index if not exists products_organisation_code_idx on products(organisation_id, code);
create index if not exists stocktake_sessions_organisation_id_idx on stocktake_sessions(organisation_id);
create index if not exists stocktake_entries_organisation_id_idx on stocktake_entries(organisation_id);
create index if not exists stocktake_entries_session_org_idx on stocktake_entries(session_id, organisation_id);
create index if not exists locations_organisation_id_idx on locations(organisation_id);
create index if not exists erp_exports_organisation_id_idx on erp_exports(organisation_id);
