# create-opentenant

Unpublished OpenTenant host scaffolder. Requires Node 22, pnpm 11.13.1, local
packed packages and a disposable pgvector Postgres 17 admin connection.

```sh
create-opentenant --name example-app --identity local --provisioning postgres --tarballs /absolute/packs --yes
```

The command creates a new directory, installs built tarballs, applies canonical
migrations and provisions one synthetic tenant. It never overwrites an existing
directory. `--identity better-auth` selects the self-hosted browser adapter.
The generated host is a minimal public synthetic welcome page, not the complete
platform or a production deployment. No third-party implementation was copied.
Local template copying is implemented with Node's standard library.
