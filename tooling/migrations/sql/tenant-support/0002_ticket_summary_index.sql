create index support_tickets_tenant_updated_at_idx
  on support.tickets (tenant_id, updated_at desc)
  include (ticket_number, category, status, priority);

comment on index support.support_tickets_tenant_updated_at_idx is
  'Covers the fixed content-minimized module broker summary projection';
