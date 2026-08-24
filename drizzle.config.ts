import {defineConfig} from 'drizzle-kit'

/**
 * Migrations are generated files, checked in, and applied in order. Nothing
 * pushes a schema straight at a database: the indexes and the rollup trigger
 * in the later migrations are hand-written SQL that no schema differ would
 * produce, and a push would silently drop them.
 */
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {url: process.env.DATABASE_URL ?? ''},
  strict: true,
  verbose: true,
})
