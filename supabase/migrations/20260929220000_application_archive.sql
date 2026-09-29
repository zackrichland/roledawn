-- Archived applications leave Home; their history, files, attempts, and receipts are kept.
alter table public.applications add column archived_at timestamptz;
comment on column public.applications.archived_at is 'Hidden from Home when set; nothing else about the application changes.';
