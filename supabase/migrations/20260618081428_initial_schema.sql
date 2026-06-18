-- supabase/migrations/20260618081428_initial_schema.sql
-- This migration creates the initial CRM tables

-- ============================================================
-- HELPER FUNCTION: Auto-update updated_at
-- ============================================================

create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================
-- TABLE 1: CONTACTS
-- ============================================================

create table if not exists contacts (
  id bigint primary key generated always as identity,
  email text unique not null,
  first_name text,
  last_name text,
  phone text,
  -- Auth/Magic Link fields
  otp text,
  magic_link text,
  link_expiry timestamptz,
  -- Tracking
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Indexes for contacts
create index if not exists idx_contacts_email on contacts(email);
create index if not exists idx_contacts_created_at on contacts(created_at desc);
create index if not exists idx_contacts_link_expiry on contacts(link_expiry) where link_expiry is not null;

-- Trigger for contacts
drop trigger if exists update_contacts_updated_at on contacts;
create trigger update_contacts_updated_at
  before update on contacts
  for each row
  execute function update_updated_at_column();

-- RLS for contacts
do $$ 
begin
  if not exists (
    select 1 from pg_tables 
    where schemaname = 'public' and tablename = 'contacts' and rowsecurity = true
  ) then
    alter table contacts enable row level security;
  end if;
end $$;

-- Policies for contacts
do $$ 
begin
  if not exists (
    select 1 from pg_policies 
    where schemaname = 'public' and tablename = 'contacts' and policyname = 'Allow authenticated users to read contacts'
  ) then
    create policy "Allow authenticated users to read contacts"
    on public.contacts
    for select
    to authenticated
    using (true);
  end if;
end $$;

do $$ 
begin
  if not exists (
    select 1 from pg_policies 
    where schemaname = 'public' and tablename = 'contacts' and policyname = 'Allow authenticated users to insert contacts'
  ) then
    create policy "Allow authenticated users to insert contacts"
    on public.contacts
    for insert
    to authenticated
    with check (true);
  end if;
end $$;

do $$ 
begin
  if not exists (
    select 1 from pg_policies 
    where schemaname = 'public' and tablename = 'contacts' and policyname = 'Allow authenticated users to update contacts'
  ) then
    create policy "Allow authenticated users to update contacts"
    on public.contacts
    for update
    to authenticated
    using (true)
    with check (true);
  end if;
end $$;

-- ============================================================
-- TABLE 2: FILES (OneDrive uploads)
-- ============================================================

create table if not exists files (
  id bigint primary key generated always as identity,
  contact_id bigint references contacts(id) on delete cascade,
  file_name text not null,
  file_url text not null,
  file_id text,
  file_type text,
  size_bytes bigint,
  uploaded_at timestamptz default now() not null,
  created_by_email text
);

-- Indexes for files
create index if not exists idx_files_contact_id on files(contact_id);
create index if not exists idx_files_uploaded_at on files(uploaded_at desc);

-- RLS for files
do $$ 
begin
  if not exists (
    select 1 from pg_tables 
    where schemaname = 'public' and tablename = 'files' and rowsecurity = true
  ) then
    alter table files enable row level security;
  end if;
end $$;

-- Policies for files
do $$ 
begin
  if not exists (
    select 1 from pg_policies 
    where schemaname = 'public' and tablename = 'files' and policyname = 'Allow authenticated users to read files'
  ) then
    create policy "Allow authenticated users to read files"
    on public.files
    for select
    to authenticated
    using (true);
  end if;
end $$;

do $$ 
begin
  if not exists (
    select 1 from pg_policies 
    where schemaname = 'public' and tablename = 'files' and policyname = 'Allow authenticated users to insert files'
  ) then
    create policy "Allow authenticated users to insert files"
    on public.files
    for insert
    to authenticated
    with check (true);
  end if;
end $$;

-- ============================================================
-- TABLE 3: MEETINGS (Calendar/Bookings)
-- ============================================================

create table if not exists meetings (
  id bigint primary key generated always as identity,
  contact_id bigint references contacts(id) on delete cascade,
  title text not null,
  meeting_date timestamptz not null,
  duration_minutes int,
  calendar_event_id text,
  notes text,
  status text default 'scheduled',  -- ← ADDED: scheduled, completed, cancelled, no_show
  -- Tracking
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  created_by_email text
);

-- Indexes for meetings
create index if not exists idx_meetings_contact_id on meetings(contact_id);
create index if not exists idx_meetings_meeting_date on meetings(meeting_date);
create index if not exists idx_meetings_status on meetings(status);  -- ← Now works because status exists

-- Trigger for meetings
drop trigger if exists update_meetings_updated_at on meetings;
create trigger update_meetings_updated_at
  before update on meetings
  for each row
  execute function update_updated_at_column();

-- RLS for meetings
do $$ 
begin
  if not exists (
    select 1 from pg_tables 
    where schemaname = 'public' and tablename = 'meetings' and rowsecurity = true
  ) then
    alter table meetings enable row level security;
  end if;
end $$;

-- Policies for meetings
do $$ 
begin
  if not exists (
    select 1 from pg_policies 
    where schemaname = 'public' and tablename = 'meetings' and policyname = 'Allow authenticated users to read meetings'
  ) then
    create policy "Allow authenticated users to read meetings"
    on public.meetings
    for select
    to authenticated
    using (true);
  end if;
end $$;

do $$ 
begin
  if not exists (
    select 1 from pg_policies 
    where schemaname = 'public' and tablename = 'meetings' and policyname = 'Allow authenticated users to insert meetings'
  ) then
    create policy "Allow authenticated users to insert meetings"
    on public.meetings
    for insert
    to authenticated
    with check (true);
  end if;
end $$;

do $$ 
begin
  if not exists (
    select 1 from pg_policies 
    where schemaname = 'public' and tablename = 'meetings' and policyname = 'Allow authenticated users to update meetings'
  ) then
    create policy "Allow authenticated users to update meetings"
    on public.meetings
    for update
    to authenticated
    using (true)
    with check (true);
  end if;
end $$;

-- ============================================================
-- TABLE 4: NOTES (Contact notes/comments)
-- ============================================================

create table if not exists notes (
  id bigint primary key generated always as identity,
  contact_id bigint references contacts(id) on delete cascade,
  content text not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  created_by_email text,
  is_internal boolean default false
);

-- Indexes for notes
create index if not exists idx_notes_contact_id on notes(contact_id);
create index if not exists idx_notes_created_at on notes(created_at desc);

-- Trigger for notes
drop trigger if exists update_notes_updated_at on notes;
create trigger update_notes_updated_at
  before update on notes
  for each row
  execute function update_updated_at_column();

-- RLS for notes
do $$ 
begin
  if not exists (
    select 1 from pg_tables 
    where schemaname = 'public' and tablename = 'notes' and rowsecurity = true
  ) then
    alter table notes enable row level security;
  end if;
end $$;

-- Policies for notes
do $$ 
begin
  if not exists (
    select 1 from pg_policies 
    where schemaname = 'public' and tablename = 'notes' and policyname = 'Allow authenticated users to read notes'
  ) then
    create policy "Allow authenticated users to read notes"
    on public.notes
    for select
    to authenticated
    using (true);
  end if;
end $$;

do $$ 
begin
  if not exists (
    select 1 from pg_policies 
    where schemaname = 'public' and tablename = 'notes' and policyname = 'Allow authenticated users to insert notes'
  ) then
    create policy "Allow authenticated users to insert notes"
    on public.notes
    for insert
    to authenticated
    with check (true);
  end if;
end $$;

do $$ 
begin
  if not exists (
    select 1 from pg_policies 
    where schemaname = 'public' and tablename = 'notes' and policyname = 'Allow authenticated users to update notes'
  ) then
    create policy "Allow authenticated users to update notes"
    on public.notes
    for update
    to authenticated
    using (true)
    with check (true);
  end if;
end $$;