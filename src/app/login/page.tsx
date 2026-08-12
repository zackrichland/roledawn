import { LoginForm } from "@/app/login/LoginForm";
import { readLocalTestLoginDecision } from "@/server/auth/local-test-login";

export default async function LoginPage() {
  const decision = await readLocalTestLoginDecision({
    allowMissingOriginForDisplay: true,
  });
  return <LoginForm localTestLoginAvailable={decision.allowed} />;
}
