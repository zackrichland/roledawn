// Set ROLEDAWN_PGLITE_MODULE to an installed PGlite entrypoint; no database service is used.
const {PGlite}=await import(process.env.ROLEDAWN_PGLITE_MODULE ?? '@electric-sql/pglite');
import {readFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
execFileSync(process.execPath,['--experimental-strip-types','scripts/build-auto-apply-acceptance.ts','--include-pending-migrations'],{stdio:'pipe'});
const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create schema storage; create schema extensions;
create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),current_user)$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')$$;
create function extensions.gen_random_uuid() returns uuid language sql as $$select gen_random_uuid()$$;
create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select sha256($1)$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid,owner_id text,metadata jsonb,created_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
grant usage on schema auth,storage,extensions to anon,authenticated,service_role; grant select on auth.users to service_role; grant all on storage.objects,storage.buckets to service_role;
`);
const all=(await readdir(resolve('supabase/migrations'))).filter(n=>n.endsWith('.sql')).sort();
const cutoff=all.filter(n=>n.endsWith('_ats_delivery_capability_gate.sql') || n.endsWith('_account_auto_apply.sql')).sort()[0];
const names=all.filter(n=>n<cutoff && !n.endsWith('_hosted_auto_apply_lane.sql'));
if(!cutoff) throw new Error('AUTO_APPLY_MIGRATIONS_MISSING');
for(const name of names){
 let sql=await readFile(resolve('supabase/migrations',name),'utf8');
 sql=sql.replace(/create extension if not exists pgcrypto with schema extensions;/g,'');
 try{await db.exec(sql);}catch(e){console.log('MIGRATION FAILURE',name,e.message);process.exit(1);}
}
try {
 const out=await db.exec(await readFile('/tmp/roledawn-auto-apply-acceptance.sql','utf8'));
 console.log(JSON.stringify(out.filter(x=>x.rows.length).flatMap(x=>x.rows),null,2));
}catch(e){ console.log('ACCEPTANCE FAILURE',e.message,e.detail,e.where); process.exitCode=1; }
await db.close();
