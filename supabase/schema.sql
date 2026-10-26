-- Enable needed extensions
create extension if not exists pgcrypto;

-- Public profiles table
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  first_name text not null,
  last_name text not null,
  email text not null,
  current_account_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Bank accounts table
create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  account_name text not null,
  nickname text,
  account_number text not null unique,
  balance numeric(12,2) not null default 0,
  currency text not null default 'V$',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Transaction log
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  from_account_id uuid references public.bank_accounts(id) on delete set null,
  to_account_id uuid references public.bank_accounts(id) on delete set null,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'V$',
  description text not null default 'Transfer',
  status text not null default 'completed',
  created_at timestamptz not null default now()
);

-- Payment requests
create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  description text not null default 'Payment request',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Helpful indexes
create index if not exists idx_profiles_username on public.profiles(username);
create index if not exists idx_bank_accounts_owner on public.bank_accounts(owner_id);
create index if not exists idx_transactions_from on public.transactions(from_account_id);
create index if not exists idx_transactions_to on public.transactions(to_account_id);
create index if not exists idx_payment_requests_recipient on public.payment_requests(recipient_id);

-- RLS setup
alter table public.profiles enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.payment_requests enable row level security;

-- Profiles policies
create policy "profiles_select_own" on public.profiles
for select using (auth.uid() = id);

create policy "profiles_insert_own" on public.profiles
for insert with check (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
for update using (auth.uid() = id) with check (auth.uid() = id);

-- Accounts policies
create policy "accounts_select_own" on public.bank_accounts
for select using (auth.uid() = owner_id);

create policy "accounts_insert_own" on public.bank_accounts
for insert with check (auth.uid() = owner_id);

create policy "accounts_update_own" on public.bank_accounts
for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Transactions policies
create policy "transactions_select_own" on public.transactions
for select using (
  exists (
    select 1 from public.bank_accounts src where src.id = transactions.from_account_id and src.owner_id = auth.uid()
  )
  or exists (
    select 1 from public.bank_accounts dst where dst.id = transactions.to_account_id and dst.owner_id = auth.uid()
  )
);

create policy "transactions_insert_own" on public.transactions
for insert with check (
  auth.uid() is not null
  and (
    exists (
      select 1 from public.bank_accounts src where src.id = from_account_id and src.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.bank_accounts dst where dst.id = to_account_id and dst.owner_id = auth.uid()
    )
  )
);

-- Payment request policies
create policy "payment_requests_select_own" on public.payment_requests
for select using (
  requester_id = auth.uid() or recipient_id = auth.uid()
);

create policy "payment_requests_insert_own" on public.payment_requests
for insert with check (requester_id = auth.uid() or recipient_id = auth.uid());

create policy "payment_requests_update_own" on public.payment_requests
for update using (
  requester_id = auth.uid() or recipient_id = auth.uid()
) with check (
  requester_id = auth.uid() or recipient_id = auth.uid()
);

-- Trigger to keep updated_at current
create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_updated_at
before update on public.profiles
for each row execute function public.update_updated_at_column();

create trigger accounts_updated_at
before update on public.bank_accounts
for each row execute function public.update_updated_at_column();

create trigger payment_requests_updated_at
before update on public.payment_requests
for each row execute function public.update_updated_at_column();

-- Default account setup helper function (optional helper for app logic)
create or replace function public.create_default_account(p_owner_id uuid, p_account_name text)
returns public.bank_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.bank_accounts;
begin
  insert into public.bank_accounts (owner_id, account_name, nickname, account_number, balance, currency)
  values (
    p_owner_id,
    p_account_name,
    p_account_name,
    'VDO-' || floor(random() * 900000 + 100000)::text || '-' || floor(random() * 9000 + 1000)::text,
    0,
    'V$'
  )
  returning * into v_account;

  update public.profiles
  set current_account_id = v_account.id,
      updated_at = now()
  where id = p_owner_id;

  return v_account;
end;
$$;
