# OPS-07 owner and tenant helpdesk experience plan

## Scope

Deliver the accepted section 12 experience on top of the verified OPS-06
canonical ticket store and metadata-only owner projection. This slice does not
add attachments, SLA clocks, CSAT, provider delivery, AI, or a new permission
vocabulary.

## Authorization design

- Owner queue discovery reads only `helpdesk_ticket_projection` through
  `ownerHelpdeskQueue` and requires `owner.helpdesk.queue.read`.
- An owner detail open treats the projected tenant ID and ticket reference as
  untrusted navigation hints. It independently requires
  `owner.support.customer_data.read` and an active managed-support session
  bound to that exact tenant before opening the tenant's canonical database
  context and resolving the ticket again by reference. A content-free audit
  write must succeed before content is returned. The support module's intake
  state is not used as historical content authority.
- Tenant requester visibility is based on `read_own`/`reply_own`; tenant queue,
  internal notes, assignment, and operational changes remain independently
  controlled by their fine-grained permissions.
- Delivery failures expose content-free dead-letter metadata only to callers
  with tenant-management authority.

## Test-first sequence

1. Add failing unit tests for canonical owner detail reopening and fail-closed
   installation/support-session authorization.
2. Add failing tests for distinct requester/staff capability derivation and
   content-free delivery-failure visibility.
3. Add failing page tests for accessible owner queue landmarks/filters and
   tenant status, assignment, priority, history, and failure presentation.
4. Implement the smallest store, authorization, and UI changes that satisfy
   those tests.
5. Run focused support and platform tests, direct typechecks where available,
   and `git diff --check`; leave full-profile promotion to the controller.
