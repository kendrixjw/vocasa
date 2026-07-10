-- 0004_billing.sql
-- Vocasa: Stripe billing for render credits.
--
-- Credits are the common currency for paid renders (see 0003). They arrive two
-- ways, both fulfilled by the Stripe webhook running under the service role:
--   * Credit packs  - one-time purchase, grants a fixed number of credits.
--   * Monthly tiers  - subscription; each paid invoice grants that tier's
--                       monthly render allotment (unused credits roll over).
-- The webhook is the only writer here; it bypasses RLS via the service role, so
-- these tables carry no user-facing write policies (owners may read their own).

-- ---------------------------------------------------------------------------
-- 1. Stripe customer <-> user mapping (for the billing portal + lookups).
-- ---------------------------------------------------------------------------
create table public.render_customers (
  owner              uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text not null unique,
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Processed Stripe events, for idempotent webhook handling. A given event id
--    is inserted once; a duplicate delivery hits the primary key and is skipped.
-- ---------------------------------------------------------------------------
create table public.stripe_events (
  id           text primary key,
  processed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. RLS: owners may read their customer row; nobody writes from the client.
--    stripe_events is service-role only (no policies).
-- ---------------------------------------------------------------------------
alter table public.render_customers enable row level security;
alter table public.stripe_events    enable row level security;

create policy "render_customers_select_own"
  on public.render_customers for select using (owner = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. Atomic credit grant. Upserts the balance row and increments it in one
--    statement so concurrent grants can't clobber each other. Called by the
--    webhook (service role); also granted to service_role explicitly.
-- ---------------------------------------------------------------------------
create or replace function public.add_render_credits(p_owner uuid, p_amount integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount is null or p_amount <= 0 then
    return;
  end if;
  insert into public.render_credits (owner, balance)
    values (p_owner, p_amount)
    on conflict (owner)
    do update set balance = public.render_credits.balance + excluded.balance,
                  updated_at = now();
end;
$$;

grant execute on function public.add_render_credits(uuid, integer) to service_role;
