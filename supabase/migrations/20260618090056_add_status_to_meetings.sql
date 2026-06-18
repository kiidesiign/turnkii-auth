-- supabase/migrations/20260618085701_add_status_to_meetings.sql
-- Add status column to meetings table

-- Add the status column if it doesn't exist
alter table public.meetings 
add column if not exists status text default 'scheduled';

-- Create the index on status
create index if not exists idx_meetings_status on meetings(status);

-- Optional: Add a check constraint to ensure only valid statuses
alter table public.meetings 
add constraint if not exists meetings_status_check 
check (status in ('scheduled', 'completed', 'cancelled', 'no_show'));

-- Update existing records to have the default status
update public.meetings 
set status = 'scheduled' 
where status is null;