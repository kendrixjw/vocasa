-- 0001_plans.sql
-- Vocasa: saved plans for the voice-sketching app.
-- Creates the `plans` table, locks it down with Row Level Security so every user
-- can only touch their own rows, auto-stamps updated_at, and indexes by owner
-- for fast per-user dashboard listing.
--
-- NOTE: if a `plans` table already exists (e.g. from earlier manual setup),
-- this migration's `create table` will error. To start clean, drop it first by
-- uncommenting the next line (this removes any existing rows):
-- drop table if exists public.plans cascade;

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table public.plans (
  id         uuid primary key default gen_random_uuid(),

  -- The owning user. Defaults to the caller so inserts don't have to set it,
  -- and cascades so a plan is removed if the user is deleted.
  owner      uuid not null default auth.uid()
               references auth.users (id) on delete cascade,

  name       text not null,

  -- The serialized plan: { version, entities, viewport, units }.
  data       jsonb not null,

  -- Optional data-URL preview shown on the dashboard.
  thumbnail  text,

  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Row Level Security
-- ---------------------------------------------------------------------------
alter table public.plans enable row level security;

-- ---------------------------------------------------------------------------
-- 3. Policies — owner-only access, one per operation.
--    A user can never read or change another user's plans.
-- ---------------------------------------------------------------------------

-- Read only your own rows.
create policy "plans_select_own"
  on public.plans
  for select
  using (owner = auth.uid());

-- Insert only rows you own (blocks spoofing someone else's owner id).
create policy "plans_insert_own"
  on public.plans
  for insert
  with check (owner = auth.uid());

-- Update only your own rows, and you can't reassign them to someone else.
create policy "plans_update_own"
  on public.plans
  for update
  using (owner = auth.uid())
  with check (owner = auth.uid());

-- Delete only your own rows.
create policy "plans_delete_own"
  on public.plans
  for delete
  using (owner = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. Auto-update updated_at on every UPDATE.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger plans_set_updated_at
  before update on public.plans
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Index for fast per-user listing.
-- ---------------------------------------------------------------------------
create index plans_owner_idx on public.plans (owner);
