-- Run only this file in the SQL Editor of the intended shared project.
-- Deliberately outside migrations/: db push would also apply the full backend.
-- Fail on a name collision rather than altering an existing application's table.
begin;

create table public.forma_connection_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.forma_connection_checks enable row level security;
revoke all on public.forma_connection_checks from public, anon, authenticated;
grant select, insert, delete on public.forma_connection_checks to authenticated;

create policy forma_check_read on public.forma_connection_checks
  for select to authenticated using (user_id = (select auth.uid()));
create policy forma_check_insert on public.forma_connection_checks
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy forma_check_delete on public.forma_connection_checks
  for delete to authenticated using (user_id = (select auth.uid()));

commit;
