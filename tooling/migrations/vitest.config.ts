import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    /**
     * The integration suites share one database and each begins by dropping and
     * recreating the public schema. Run in parallel they race: two files reach
     * `create schema public` together and one dies on
     * `duplicate key value violates unique constraint "pg_namespace_nspname_index"`.
     *
     * This never surfaced because the suites carried different required
     * database-name prefixes behind a single environment variable, so at most
     * one could run at a time. Consolidating the guard made them runnable
     * together, which is what exposed the shared mutable schema underneath.
     */
    fileParallelism: false,
  },
});
