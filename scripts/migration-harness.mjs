// Local, service-free migration harness. Applies every checked-in migration to
// an in-process PGlite database with minimal Supabase auth/storage stubs, then
// optionally runs SQL check files. No hosted database is touched.
//
//   node scripts/migration-harness.mjs                 # apply all migrations
//   node scripts/migration-harness.mjs checks/*.sql    # apply, then run checks
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

export async function createMigratedDatabase({ log = () => {} } = {}) {
  const db = new PGlite();
  await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls; create role supabase_admin;
create schema auth; create schema storage; create schema extensions;
create table auth.users(id uuid primary key, email text, raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),current_user)$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')$$;
create function extensions.gen_random_uuid() returns uuid language sql as $$select gen_random_uuid()$$;
create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select sha256($1)$$;
create function extensions.digest(text,text) returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
grant usage on schema auth, storage, extensions to anon, authenticated, service_role;
grant select on auth.users to service_role; grant all on storage.objects, storage.buckets to service_role;
`);
  const names = (await readdir(resolve("supabase/migrations"))).filter((name) => name.endsWith(".sql")).sort();
  for (const name of names) {
    let sql = await readFile(resolve("supabase/migrations", name), "utf8");
    sql = sql
      .replace(/create extension if not exists pgcrypto with schema extensions;/giu, "")
      .replace(/create extension if not exists "?pg_cron"?[^;]*;/giu, "")
      .replace(/create extension if not exists "?pg_net"?[^;]*;/giu, "");
    try {
      await db.exec(sql);
      log(`applied ${name}`);
    } catch (error) {
      const failure = new Error(`MIGRATION_FAILED ${name}: ${error.message}`);
      failure.cause = error;
      throw failure;
    }
  }
  return { db, migrations: names };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const started = Date.now();
  const { db, migrations } = await createMigratedDatabase();
  console.log(`applied ${migrations.length} migrations in ${Date.now() - started} ms`);
  let failed = 0;
  for (const file of process.argv.slice(2)) {
    try {
      const results = await db.exec(await readFile(resolve(file), "utf8"));
      const rows = results.filter((result) => result.rows.length).flatMap((result) => result.rows);
      console.log(`PASS ${file}${rows.length ? `\n${JSON.stringify(rows, null, 2)}` : ""}`);
    } catch (error) {
      failed += 1;
      console.log(`FAIL ${file}: ${error.message}${error.where ? `\n  where: ${error.where}` : ""}`);
    }
  }
  await db.close();
  process.exitCode = failed ? 1 : 0;
}
