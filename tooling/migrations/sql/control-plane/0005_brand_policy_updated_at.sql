-- The tenant branding editor stamps updated_at on every save; the original
-- brand_policies table (migration 0001) omitted the column.

alter table brand_policies add column updated_at timestamptz not null default now();
