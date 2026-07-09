-- 0002_sharing.sql
-- Vocasa: read-only plan sharing + anonymous comments.
--
-- Adds a per-plan share token and a comments table. Public (anon) access is
-- exposed ONLY through SECURITY DEFINER functions scoped to a token, so an
-- anonymous visitor can read/comment on exactly the plan whose token they hold
-- and cannot enumerate other plans. The base tables keep owner-only RLS.
--
-- Apply in the Supabase SQL editor after 0001_plans.sql.

-- ---------------------------------------------------------------------------
-- 1. Share token on plans (null = not shared). Revoking = set back to null.
-- ---------------------------------------------------------------------------
alter table public.plans
  add column if not exists share_token text unique;

-- ---------------------------------------------------------------------------
-- 2. Comments table (owner-only RLS; public access via the RPCs below).
-- ---------------------------------------------------------------------------
create table if not exists public.plan_comments (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.plans (id) on delete cascade,
  author_name text not null,
  body        text not null,
  created_at  timestamptz not null default now()
);

alter table public.plan_comments enable row level security;

-- The plan owner can read comments on their own plans (e.g. in the editor).
create policy "plan_comments_select_owner"
  on public.plan_comments
  for select
  using (
    exists (
      select 1 from public.plans p
      where p.id = plan_comments.plan_id and p.owner = auth.uid()
    )
  );

create index if not exists plan_comments_plan_idx
  on public.plan_comments (plan_id, created_at);

-- ---------------------------------------------------------------------------
-- 3. Token-scoped public access (SECURITY DEFINER — bypasses RLS but only ever
--    returns rows for the exact token supplied). No table-level anon grants, so
--    visitors cannot list plans/comments they don't have a token for.
-- ---------------------------------------------------------------------------

-- Resolve a shared plan by token.
create or replace function public.get_shared_plan(p_token text)
returns table (id uuid, name text, data jsonb)
language sql
security definer
set search_path = public
as $$
  select p.id, p.name, p.data
  from public.plans p
  where p.share_token = p_token
  limit 1;
$$;

-- List a shared plan's comments (oldest first).
create or replace function public.get_shared_comments(p_token text)
returns table (id uuid, author_name text, body text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select c.id, c.author_name, c.body, c.created_at
  from public.plan_comments c
  join public.plans p on p.id = c.plan_id
  where p.share_token = p_token
  order by c.created_at asc;
$$;

-- Add a comment to a shared plan. Validates the token and trims/caps input.
create or replace function public.add_shared_comment(p_token text, p_author text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  pid uuid;
  new_id uuid;
begin
  select p.id into pid from public.plans p where p.share_token = p_token limit 1;
  if pid is null then
    raise exception 'invalid or revoked share link';
  end if;
  if length(trim(coalesce(p_author, ''))) = 0 or length(trim(coalesce(p_body, ''))) = 0 then
    raise exception 'name and comment are required';
  end if;
  insert into public.plan_comments (plan_id, author_name, body)
  values (pid, left(trim(p_author), 60), left(trim(p_body), 2000))
  returning id into new_id;
  return new_id;
end;
$$;

-- Only these token-scoped functions are reachable by anon.
grant execute on function public.get_shared_plan(text) to anon, authenticated;
grant execute on function public.get_shared_comments(text) to anon, authenticated;
grant execute on function public.add_shared_comment(text, text, text) to anon, authenticated;
