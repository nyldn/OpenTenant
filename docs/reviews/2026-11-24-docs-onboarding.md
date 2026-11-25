# Public documentation and onboarding review

Reviewed the GitHub READMEs, documentation, and release notes of four
developer-facing projects on November 24, 2026. Star counts are rounded
snapshots from GitHub.

| Reference | Documentation pattern | How OpenTenant used it |
| --- | --- | --- |
| [Payload](https://github.com/payloadcms/payload#quickstart), 46k stars | Its README gives developers a command and points them to a concrete example. | The OpenTenant README starts with runnable local commands and sends the reader directly to Assessment. |
| [Appwrite](https://github.com/appwrite/appwrite), 59k stars | Its docs offer quick starts and separate entry points for individual capabilities. | The [documentation index](../README.md) routes readers to setup, modules, architecture, or operations. [Appwrite docs](https://appwrite.io/docs) |
| [Supabase](https://github.com/supabase/supabase), 115k stars | Local development and self-hosting have dedicated guides. | The local example explains what it seeds. Durable tenant provisioning and deployment have their own instructions. [Local development](https://supabase.com/docs/guides/local-development) · [Self-hosting](https://supabase.com/docs/guides/self-hosting) |
| [shadcn/ui](https://github.com/shadcn-ui/ui), 129k stars | A short README points to dedicated docs and contribution guidance. Its CLI changelog groups changes by version. | The README points readers into the docs. The changelog puts the dated source-publication entry first. [CLI changelog](https://github.com/shadcn-ui/ui/blob/main/packages/shadcn/CHANGELOG.md) |

The quick start targets the complete source checkout. The separate
packed-package guide covers the unpublished host scaffold. Use the
[capabilities guide](../product/platform-capabilities.md) for feature limits
and dated verification results.

## Verification

- The local link check passed across 182 Markdown files, including 448 local
  links and 15 cross-file anchors.
- A fresh checkout passed frozen install and `pnpm local:setup` with an
  isolated Compose project on an alternate loopback port. The documented
  platform dev command served the app. Local sign-in returned HTTP 302 to
  `/assessment`, which returned HTTP 200 with the session cookie.
- The staged repository privacy check and `git diff --check` passed.
