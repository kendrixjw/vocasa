-- 0002_renders.sql
-- Vocasa: premium redesign renders (paid, metered image-to-image add-on).
--
-- The core app produces cheap, editable, to-scale geometry from text AI calls.
-- These renders are a DIFFERENT capability: generative image restyling, where
-- every render is a real paid image-model call (per-use COGS). So usage must be
-- metered and the accounting must be tamper-proof: users may READ their own
-- balance and render history, but may never write it directly. All credit math
-- happens inside SECURITY DEFINER functions that run as the table owner and so
-- bypass RLS while stamping auth.uid() themselves.
--
-- Free hook: the first N renders per module are free (default 2). After that a
-- render consumes one credit. Credits arrive via Stripe (packs) or a monthly
-- tier (both handled in a later phase); this migration only tracks balances.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

-- Per-user credit balance. One row per user, created lazily on first reserve.
create table public.render_credits (
  owner      uuid primary key default auth.uid()
               references auth.users (id) on delete cascade,
  -- Credits available for paid renders (does not include the free allowance).
  balance    integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

-- One row per render attempt. A reservation is inserted 'pending' BEFORE the
-- model call so free-quota / credit accounting is atomic; the row is finalized
-- to 'complete' (with the result) or 'failed' (which refunds a spent credit).
create table public.renders (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null default auth.uid()
               references auth.users (id) on delete cascade,

  -- 'design' (room) or 'landscaping' (yard).
  module     text not null check (module in ('design', 'landscaping')),

  -- Where the render came from in the accounting sense.
  source     text not null check (source in ('free', 'credit')),

  status     text not null default 'pending'
               check (status in ('pending', 'complete', 'failed')),

  -- The style direction the user asked for (free text, capped by the app).
  style      text,

  -- The finished image. Stored as a data URL for now, consistent with how
  -- plan thumbnails are stored; a later phase moves this to private Blob.
  result_url text,

  -- What the model call actually cost us, in cents, for margin reporting.
  cost_cents integer,

  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Row Level Security — read-only for owners; all writes go through the
--    SECURITY DEFINER functions below.
-- ---------------------------------------------------------------------------
alter table public.render_credits enable row level security;
alter table public.renders        enable row level security;

create policy "render_credits_select_own"
  on public.render_credits for select using (owner = auth.uid());

create policy "renders_select_own"
  on public.renders for select using (owner = auth.uid());

-- Note: deliberately NO insert/update/delete policies. With RLS enabled and no
-- permissive policy, direct writes from the anon/user client are rejected. Only
-- the SECURITY DEFINER functions (which run as this migration's owner) can write.

-- ---------------------------------------------------------------------------
-- 3. Free allowance + index
-- ---------------------------------------------------------------------------
-- How many free renders each user gets per module before credits are required.
create or replace function public.render_free_limit()
returns integer language sql immutable as $$ select 2 $$;

create index renders_owner_module_idx on public.renders (owner, module);

-- ---------------------------------------------------------------------------
-- 4. reserve_render — atomically decide free vs credit vs denied, and record a
--    'pending' row. Returns the render id and the source used. Raises
--    'insufficient_credits' if the user is out of both free renders and credits.
-- ---------------------------------------------------------------------------
create or replace function public.reserve_render(p_module text)
returns table (render_id uuid, source text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_used   integer;
  v_source text;
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_module not in ('design', 'landscaping') then
    raise exception 'invalid_module';
  end if;

  -- Count renders that consumed the free allowance (pending or complete —
  -- failed ones were refunded and don't count). Lock the user's credit row so
  -- concurrent reservations serialize.
  perform 1 from public.render_credits where owner = v_uid for update;

  select count(*) into v_used
  from public.renders
  where owner = v_uid and module = p_module and source = 'free'
    and status in ('pending', 'complete');

  if v_used < public.render_free_limit() then
    v_source := 'free';
  else
    -- Need a paid credit. Ensure a balance row exists, then decrement it.
    insert into public.render_credits (owner) values (v_uid)
      on conflict (owner) do nothing;

    update public.render_credits
      set balance = balance - 1, updated_at = now()
      where owner = v_uid and balance > 0;

    if not found then
      raise exception 'insufficient_credits';
    end if;
    v_source := 'credit';
  end if;

  insert into public.renders (owner, module, source, status, style)
    values (v_uid, p_module, v_source, 'pending', null)
    returning id into v_id;

  return query select v_id, v_source;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. finalize_render — mark a reserved render complete with its result.
-- ---------------------------------------------------------------------------
create or replace function public.finalize_render(
  p_render_id uuid, p_result_url text, p_style text, p_cost_cents integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.renders
    set status = 'complete', result_url = p_result_url,
        style = p_style, cost_cents = p_cost_cents
    where id = p_render_id and owner = auth.uid() and status = 'pending';
  if not found then
    raise exception 'render_not_reservable';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. fail_render — mark a reserved render failed and refund a spent credit so
--    the user is never charged for a render we couldn't produce.
-- ---------------------------------------------------------------------------
create or replace function public.fail_render(p_render_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text;
begin
  update public.renders
    set status = 'failed'
    where id = p_render_id and owner = auth.uid() and status = 'pending'
    returning source into v_source;
  if not found then
    return; -- nothing to refund; already finalized or not ours
  end if;
  if v_source = 'credit' then
    update public.render_credits
      set balance = balance + 1, updated_at = now()
      where owner = auth.uid();
  end if;
end;
$$;

-- Let authenticated users invoke the accounting functions (they still only act
-- on their own auth.uid() rows).
grant execute on function public.reserve_render(text)                       to authenticated;
grant execute on function public.finalize_render(uuid, text, text, integer) to authenticated;
grant execute on function public.fail_render(uuid)                          to authenticated;
