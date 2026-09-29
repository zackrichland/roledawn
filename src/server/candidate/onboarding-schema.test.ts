import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../../supabase/migrations/20260819031521_candidate_onboarding_and_search_profile.sql",
  import.meta.url,
);
const FIX_MIGRATION = new URL(
  "../../../supabase/migrations/20260819031731_fix_candidate_onboarding_resume_readiness.sql",
  import.meta.url,
);
const NAME_MIGRATION = new URL(
  "../../../supabase/migrations/20260819050412_add_candidate_given_family_names.sql",
  import.meta.url,
);
const ACTIVATION_SCOPE_MIGRATION = new URL(
  "../../../supabase/migrations/20260819051015_allow_unresolved_work_authorization_after_onboarding.sql",
  import.meta.url,
);

test("onboarding readiness is candidate-owned, review-gated, and closed to direct writes", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(sql, /create table public\.candidate_search_profiles/iu);
  assert.match(sql, /alter table public\.candidate_search_profiles enable row level security/iu);
  assert.match(sql, /create policy candidate_search_profiles_candidate_select/iu);
  assert.match(sql, /revoke all on public\.candidate_search_profiles from public, anon, authenticated/iu);
  assert.match(sql, /grant select on public\.candidate_search_profiles to authenticated/iu);
  assert.doesNotMatch(sql, /for\s+(?:insert|update|delete)\s+to authenticated/iu);
  assert.match(sql, /document\.status = 'READY'/iu);
  assert.match(sql, /fact\.verification_status = 'VERIFIED'/iu);
  assert.match(sql, /CANDIDATE_ONBOARDING_INCOMPLETE/iu);
  assert.match(sql, /status = 'ACTIVE'/iu);
});

test("reviewed résumé readiness follows the persisted version-number pointer", async () => {
  const sql = await readFile(FIX_MIGRATION, "utf8");

  assert.match(sql, /document\.current_version_number is not null/iu);
  assert.doesNotMatch(sql, /document\.current_version_id/iu);
  assert.match(sql, /create or replace function private\.candidate_onboarding_missing_items/iu);
});

test("authenticated onboarding commands derive their candidate from auth uid", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(sql, /create or replace function public\.save_candidate_search_profile/iu);
  assert.match(sql, /create or replace function public\.complete_candidate_onboarding/iu);
  assert.match(sql, /v_actor uuid := auth\.uid\(\)/iu);
  assert.match(sql, /workspace\.personal_owner_auth_user_id = v_actor/iu);
  assert.match(sql, /candidate\.auth_user_id = v_actor/iu);
  assert.match(sql, /COMMAND_ID_PAYLOAD_MISMATCH/iu);
  assert.match(sql, /CANDIDATE_SEARCH_PROFILE_VERSION_MISMATCH/iu);
});

test("onboarding requires explicit given and family names without deriving either", async () => {
  const sql = await readFile(NAME_MIGRATION, "utf8");

  assert.match(sql, /create or replace function public\.save_candidate_identity_name_fact/iu);
  assert.match(sql, /'identity\.given_name'/u);
  assert.match(sql, /'identity\.family_name'/u);
  assert.match(sql, /array_append\(v_missing, 'GIVEN_NAME'\)/u);
  assert.match(sql, /array_append\(v_missing, 'FAMILY_NAME'\)/u);
  assert.match(sql, /CANDIDATE_ENTRY/u);
  assert.match(sql, /authorize_application_fill_once/iu);
  assert.match(sql, /fact\.sensitivity = ''SENSITIVE''/u);
  assert.match(sql, /work_authorization\.us\.authorized/u);
  assert.match(sql, /work_authorization\.ca\.sponsorship_required/u);
  assert.match(sql, /APPLICATION_FILL_DISCLOSURE_PREDICATE_DRIFT/u);
  assert.doesNotMatch(sql, /split_part|regexp_split/iu);
});

test("global activation requires ordinary reusable facts but not resolved work authorization", async () => {
  const sql = await readFile(ACTIVATION_SCOPE_MIGRATION, "utf8");

  assert.match(sql, /create or replace function private\.candidate_onboarding_missing_items/iu);
  assert.match(sql, /'identity\.given_name'/u);
  assert.match(sql, /'identity\.family_name'/u);
  assert.match(sql, /'identity\.legal_name'/u);
  assert.match(sql, /'contact\.application_email'/u);
  assert.match(sql, /'contact\.phone'/u);
  assert.match(sql, /'location\.city', 'location\.region', 'location\.country_code'/u);
  assert.match(sql, /public\.candidate_search_profiles/iu);
  assert.doesNotMatch(sql, /array_append\(v_missing, '(?:US|CA)_WORK_ELIGIBILITY'\)/u);
  assert.doesNotMatch(sql, /fact\.fact_key in \(\s*'work_authorization\./iu);
});
