import assert from "node:assert/strict";
import test from "node:test";
import { assertFullstackScope, buildFullstackCleanupSql, createFullstackScope, FULLSTACK_ACKNOWLEDGEMENT, FULLSTACK_PROJECT, requireFullstackEnvironment } from "../../../scripts/application-delivery-fullstack-lib.ts";

test("hosted delivery acceptance requires its exact explicit project and mutation acknowledgement", () => {
  const environment: NodeJS.ProcessEnv = { NODE_ENV: "test", RUN_HOSTED_DELIVERY_ACCEPTANCE: FULLSTACK_ACKNOWLEDGEMENT, ACCEPTANCE_EXPECTED_SUPABASE_PROJECT_REF: FULLSTACK_PROJECT,
    NEXT_PUBLIC_SUPABASE_URL: `https://${FULLSTACK_PROJECT}.supabase.co`, SUPABASE_SECRET_KEY: "synthetic", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic", OPENAI_API_KEY: "synthetic", BROWSERBASE_API_KEY: "synthetic" };
  requireFullstackEnvironment(environment);
  for (const changes of [{ RUN_HOSTED_DELIVERY_ACCEPTANCE: "true" }, { ACCEPTANCE_EXPECTED_SUPABASE_PROJECT_REF: "another-project" }, { NEXT_PUBLIC_SUPABASE_URL: "https://another-project.supabase.co" }, { SUPABASE_SECRET_KEY: "" }]) assert.throws(() => requireFullstackEnvironment({ ...environment, ...changes }), /FULLSTACK_/u);
});

test("synthetic SQL rejects real destinations and scope identity changes before constructing cleanup", () => {
  const scope = createFullstackScope(); assertFullstackScope(scope);
  for (const changes of [{ destinationUrl: "https://job-boards.greenhouse.io/example/jobs/1234" }, { workspaceName: "Someone else's workspace" }, { email: "real@example.org" }, { applicationId: "';delete from public.applications;--" }]) {
    assert.throws(() => buildFullstackCleanupSql({ ...scope, ...changes }), /FULLSTACK_/u);
  }
});
