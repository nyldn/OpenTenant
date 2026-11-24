# Migration number reservations

Parallel branches reserve migration numbers here before they write SQL, so
merges never collide. Numbering may have gaps. The integrator renumbers only
when a gap would break an ordering assertion.

| Catalog | Numbers | Owner / branch | Status |
| --- | --- | --- | --- |
| control-plane | 0030 | audit checkpoint hardening | used |
| tenant-support | 0006 | audit checkpoint hardening | used |
| tenant-brain | 0002 | audit checkpoint hardening | used |
| control-plane | 0040–0044 | W2 tenant lifecycle and worker | 0040–0044 used; tenant-core reservations unused |
| tenant-core | 0010–0011 | W2 tenant lifecycle and worker | reserved |
| control-plane | 0045–0047 | W2 key rotation and email | reserved |
| control-plane | 0048–0049 | W2 custom domains | reserved |
| control-plane | 0050–0051 | W2 observability and rate limiting | 0050 used; 0051 reserved, unused |
| control-plane | 0063–0064 | OpenFGA authorization adapter | 0063 used; 0064 reserved |
| control-plane | 0065 | Sandbox adapters and OpenMeter export | used: export cursor and receipts |
| control-plane | 0066 | Sandbox adapters and OpenMeter export | reserved, unused |
| control-plane | 0060–0062 | Better Auth identity adapter | 0060–0062 used |
| tenant-hello | 0001 | fix-wave-4 module registry sample | used: isolated sample catalog, no control-plane numbers used |
| control-plane | 0071 | wave4b integrator | OAuth clients and single-use PKCE codes |
| control-plane | 0072–0073 | Wave 2 L1 lifecycle undo and job status | reserved, unused (L1 needed no DDL) |
| control-plane | 0074–0075 | Wave 2 D1 Assessment engagement integrity | reserved, unused (D1 is browser storage only) |
| control-plane | 0076–0077 | Wave 2 A1 Better Auth authority and owner claim | reserved, unused (A1 needed no DDL) |
| control-plane | 0080–0081 | Wave 3 S1 domain challenge recovery and tenant brand assets | used |
| control-plane | 0082–0083 | Wave 4 R1 custom-domain re-verification schedule | 0082 used; 0083 unused |
| control-plane | 0084–0085 | Wave 4 R2 authorization lifecycle outbox | 0084 used; 0085 unused |
| control-plane | 0086–0087 | Wave 4 R3 durable Support email delivery (control-plane side) | reserved, unused |
| tenant-support | 0007–0008 | Wave 4 R3 durable Support email delivery (tenant side) | 0007 used; 0008 unused |
| control-plane | 0088–0089 | Wave 4 R4 bounded tenant export | reserved, unused |
| tenant-support | 0009–0010 | Wave 5 R6 reviewed Support AI suggestion store | reserved |
| control-plane | 0090–0091 | Wave 5 R7 quality-contract persistence | reserved |
| control-plane | 0092+ | next free block | free |
| tenant-support | 0011+ | next free block | free |
| control-plane | 0070 | fix-wave-4 Developer MCP | package-owned DDL exported as DEVELOPER_MCP_SCHEMA; canonical runner wiring reserved for integrator |
