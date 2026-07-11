-- Store usernames for email/password auth and allow username sign-in lookup.

create table if not exists user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  email text not null,
  created_at timestamptz not null default now()
);

alter table user_profiles enable row level security;

grant select on user_profiles to anon, authenticated;
grant update on user_profiles to authenticated;

drop policy if exists "user_profiles_username_lookup" on user_profiles;
drop policy if exists "user_profiles_owner_update" on user_profiles;

create policy "user_profiles_username_lookup"
  on user_profiles for select
  to anon, authenticated
  using (true);

create policy "user_profiles_owner_update"
  on user_profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  desired_username text;
begin
  desired_username := lower(regexp_replace(coalesce(new.raw_user_meta_data->>'username', ''), '[^a-zA-Z0-9_]', '', 'g'));

  if length(desired_username) < 3 then
    desired_username := 'user_' || replace(left(new.id::text, 8), '-', '');
  end if;

  insert into public.user_profiles (id, username, email)
  values (new.id, desired_username, coalesce(new.email, ''))
  on conflict (id) do update
    set username = excluded.username,
        email = excluded.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;

create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

create index if not exists user_profiles_username_idx on user_profiles(username);
