-- OPS-06: minimal, rebuildable owner-helpdesk projection.
-- Rows are derived from tenant support outbox events so owner queue views
-- never fan out across tenant databases. The projection is never ticket
-- authority: it carries queue metadata only, applies monotonically by
-- canonical ticket version, and can always be rebuilt from tenant state.

create table helpdesk_ticket_projection (
  tenant_id text not null references tenants (tenant_id),
  ticket_number text not null,
  status text not null check (status in (
    'open', 'in_progress', 'awaiting_reply', 'resolved', 'closed'
  )),
  priority text not null check (priority in ('low', 'medium', 'high', 'urgent')),
  category text not null check (category in (
    'bug_report', 'feature_request', 'how_to', 'account_issue', 'billing',
    'other'
  )),
  -- Opaque assignee reference; never a display name or email address.
  assigned_ref text check (assigned_ref is null or length(assigned_ref) <= 120),
  opened_at timestamptz not null,
  ticket_updated_at timestamptz not null,
  source_version bigint not null check (source_version >= 1),
  source_event_id bigint,
  projected_at timestamptz not null default now(),
  tombstoned boolean not null default false,
  primary key (tenant_id, ticket_number)
);

comment on table helpdesk_ticket_projection is
  'Derived owner queue index; queue metadata only, monotonic by canonical '
  'ticket version, rebuildable, and never ticket authority. Subjects, '
  'bodies, and attachments have no columns here by design.';

create index helpdesk_projection_queue_idx
  on helpdesk_ticket_projection (status, priority, ticket_updated_at desc)
  where not tombstoned;

create index helpdesk_projection_tenant_idx
  on helpdesk_ticket_projection (tenant_id, ticket_updated_at desc)
  where not tombstoned;

-- Per-tenant consumer checkpoint and health. Lag is derived for display and
-- is explicitly not ticket state.
create table helpdesk_projection_state (
  tenant_id text primary key references tenants (tenant_id),
  last_event_id bigint not null default 0 check (last_event_id >= 0),
  last_event_at timestamptz,
  last_applied_at timestamptz,
  last_rebuild_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 500),
  updated_at timestamptz not null default now()
);

comment on table helpdesk_projection_state is
  'Outbox consumer checkpoint and projection health per tenant; '
  'reconciliation compares this against tenant outbox state.';
