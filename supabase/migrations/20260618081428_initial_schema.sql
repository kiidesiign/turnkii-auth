-- supabase/migrations/20250317120000_initial_schema.sql
-- This migration creates the initial CRM tables

-- Safe: Creates if not exists
create table if not exists contacts (
  id bigint primary key generated always as identity,
  email text unique not null,
  first_name text,
  last_name text,
  phone text,
  otp text,
  magic_link text,
  link_expiry timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enable RLS (idempotent)
do $$ 
begin
  if not exists (
    select 1 from pg_tables 
    where schemaname = 'public' and tablename = 'contacts'
  ) then
    alter table contacts enable row level security;
  end if;
end $$;


-- Update the policy section to this:
-- Safe policy creation: Check if policy exists before creating
do $$ 
begin
  if not exists (
    select 1 from pg_policies 
    where schemaname = 'public' 
    and tablename = 'contacts' 
    and policyname = 'Allow authenticated users to read contacts'
  ) then
    create policy "Allow authenticated users to read contacts"
    on public.contacts
    for select
    to authenticated
    using (true);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies 
    where schemaname = 'public' 
    and tablename = 'contacts' 
    and policyname = 'Allow authenticated users to insert contacts'
  ) then
    create policy "Allow authenticated users to insert contacts"
    on public.contacts
    for insert
    to authenticated
    with check (true);
  end if;
end $$;
