import type { PGlite } from "@electric-sql/pglite";
import type { HostedTaskModel } from "../domain/hosted-task-admission-model.ts";

/** PGlite-only design rehearsal. Not a Supabase migration, deployed RPC, or production adapter. */
export const EXPERIMENTAL_AUTHORITY_VERSION = "HOSTED_TASK_EXPERIMENT_V0_DISABLED" as const;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu;
const conflict = (): never => { throw new Error("HOSTED_REHEARSAL_RESERVATION_CONFLICT"); };
type Row = { model: HostedTaskModel; version: number; provider: "OPENAI_HOSTED" | "BROWSERBASE" };

export async function createHostedReservationRehearsal(db: PGlite) {
  await db.exec(`
    create schema if not exists hosted_rehearsal;
    revoke all on schema hosted_rehearsal from public;
    create table if not exists hosted_rehearsal.reservations (
      application_id uuid primary key,
      candidate_id uuid not null,
      job_key text not null,
      provider text not null check (provider in ('OPENAI_HOSTED','BROWSERBASE')),
      authority_version text not null check (authority_version = 'HOSTED_TASK_EXPERIMENT_V0_DISABLED'),
      version integer not null default 0,
      model jsonb not null check (
        model->>'automaticRetryAllowed' = 'false'
        and ((model->>'phase' in ('RESERVED','STOPPED') and model->>'possibleEgress' = 'false')
          or (model->>'phase' in ('ADMISSION_PENDING','ADMITTED','UNCERTAIN','CONFIRMED','NOT_ACCEPTED')
            and model->>'possibleEgress' = 'true'))
      ),
      unique (candidate_id, job_key)
    );
    create unique index if not exists hosted_rehearsal_session_unique
      on hosted_rehearsal.reservations ((model->'binding'->>'sessionId'));
    alter table hosted_rehearsal.reservations enable row level security;
    revoke all on hosted_rehearsal.reservations from public;
  `);
  return {
    async reserve(candidateId: string, provider: Row["provider"], model: HostedTaskModel): Promise<boolean> {
      if (!UUID.test(candidateId) || model.phase !== "RESERVED" || model.possibleEgress ||
          model.automaticRetryAllowed !== false || !["OPENAI_HOSTED", "BROWSERBASE"].includes(provider)) conflict();
      const url = new URL(model.binding.destinationUrl);
      // Provider job UUID, independent of URL suffix, packet version or application row.
      const jobKey = `${url.hostname}/${url.pathname.split("/")[2].toLowerCase()}`;
      const result = await db.query(`insert into hosted_rehearsal.reservations
        (application_id,candidate_id,job_key,provider,authority_version,model)
        values ($1,$2,$3,$4,$5,$6::jsonb) on conflict do nothing returning application_id`,
      [model.binding.applicationId, candidateId, jobKey, provider, EXPERIMENTAL_AUTHORITY_VERSION, JSON.stringify(model)]);
      return result.rows.length === 1;
    },
    async read(applicationId: string): Promise<Row | null> {
      const result = await db.query<Row>("select model,version,provider from hosted_rehearsal.reservations where application_id=$1", [applicationId]);
      return result.rows[0] ?? null;
    },
    async transition(applicationId: string, expectedVersion: number, change: (state: HostedTaskModel) => HostedTaskModel): Promise<Row> {
      return db.transaction(async tx => {
        const current = (await tx.query<Row>("select model,version,provider from hosted_rehearsal.reservations where application_id=$1 for update", [applicationId])).rows[0];
        if (!current || current.version !== expectedVersion) conflict();
        const oldBinding = JSON.stringify(current.model.binding);
        const next = change(structuredClone(current.model));
        const allowed: Record<HostedTaskModel["phase"], readonly HostedTaskModel["phase"][]> = {
          RESERVED: ["ADMISSION_PENDING", "STOPPED"],
          ADMISSION_PENDING: ["ADMITTED", "UNCERTAIN", "CONFIRMED", "NOT_ACCEPTED"],
          ADMITTED: ["ADMITTED", "UNCERTAIN", "CONFIRMED", "NOT_ACCEPTED"],
          UNCERTAIN: ["UNCERTAIN", "CONFIRMED", "NOT_ACCEPTED"],
          STOPPED: ["STOPPED"], CONFIRMED: ["CONFIRMED"], NOT_ACCEPTED: ["NOT_ACCEPTED"],
        };
        if (!allowed[current.model.phase]?.includes(next.phase) ||
            (["STOPPED", "CONFIRMED", "NOT_ACCEPTED"].includes(current.model.phase)
              && JSON.stringify(next) !== JSON.stringify(current.model))) conflict();
        if (JSON.stringify(next.binding) !== oldBinding || next.automaticRetryAllowed !== false ||
            (current.model.possibleEgress && !next.possibleEgress)) conflict();
        const result = await tx.query<Row>(`update hosted_rehearsal.reservations set model=$1::jsonb,version=version+1
          where application_id=$2 and version=$3 returning model,version,provider`, [JSON.stringify(next), applicationId, expectedVersion]);
        if (result.rows.length !== 1) conflict();
        return result.rows[0];
      });
    },
  };
}
