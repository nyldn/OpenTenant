# Hello module

An independent ESM package whose implementation imports only the Apache-2.0
OpenTenant module SDK. It declares a native `/hello` route, navigation item,
settings panel, tenant migration and role map. Its default entitlement is off.

Add `@example/module-hello` to the platform dependencies and `helloModule` to
`apps/platform/opentenant-modules.ts`. See the SDK README for installation
registration and the architecture guide for outstanding integrator wiring.
