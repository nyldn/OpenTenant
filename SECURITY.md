# Security policy

OpenTenant provides a multi-tenant shell, control and tenant databases,
identity adapters, and module execution. Security reports can cover the
framework, first-party modules, adapters, and documented deployment defaults.

Report vulnerabilities privately through GitHub's **Report a vulnerability**
form once it is enabled. If the form is unavailable, contact a maintainer
privately and request a secure channel. Keep reports, tenant data, credentials,
and reproductions out of public issues and pull requests. Include the affected
revision, configuration, impact, and enough context to identify the boundary.

Tenant and identity resolution must precede data access and mutations.
Tenant-owned rows, credential material, and audit events must stay bound to
their tenant. Module authority must be scoped, expiring, and validated at the
host boundary. Generated code must run with bounded execution, no ambient
credentials, and controlled egress. Consult the
[platform architecture](docs/architecture/platform-architecture.md) for the
trust boundaries and production prerequisites.
