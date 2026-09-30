import { validateAgentQuestionAnswer, type AgentQuestionDescriptor, type AgentQuestionValue } from "./application-agent-questions.ts";

/** Explicit, revocable candidate authority; this reserved answer never enters a model prompt. */
export const APPLICATION_ACKNOWLEDGEMENTS_TOPIC = "Delegated application acknowledgements";
export const APPLICATION_ACKNOWLEDGEMENTS_AUTHORIZATION = "Authorize RoleDawn to accept application terms, privacy notices, processing and screening consents, certify the supplied application information, and enter my approved legal name as my signature.";
const normalized = (value: string) => value.trim().replace(/\s+/gu, " ").toLowerCase();
// A consent is permission to do something, not evidence of a qualification or personal status.
const FACTUAL = /\b(?:gender|sex|sexual|race|racial|ethnic\w*|veteran\w*|disabilit\w*|citizen\w*|nationality|criminal history|convicted|felony|clearance|ts[\s/-]*sci|polygraph|licensed|licensure|certified professional|degree|gpa|years of experience|authorized to work|require sponsorship|(?:i|you|applicant|candidate) (?:am|are|have (?!read\b|reviewed\b)|hold|possess|meet|reside|live|worked)|(?:at least|over|under) [0-9]+ (?:years|year)|bound by (?:a )?non[\s-]*compet\w*)\b/iu;
const NEGATIVE = /\b(?:do not|don['’]t|not agree|not consent|decline|refuse|without\s+using\s+(?:ai|artificial intelligence)|no\s+(?:ai|artificial intelligence))\b/iu;
const ACKNOWLEDGEMENT = /\b(?:consent|agree\w*|accept\w*|acknowledg\w*|authoriz\w*|certify|attest\w*|terms|privacy|arbitrat\w*)\b/iu;
const SIGNATURE = /^(?:(?:candidate|applicant|your|digital|electronic|typed) )?(?:signature|sign here)(?: \((?:type|enter) (?:your )?(?:full |legal )?name\))?[ *:.]*$/iu;
const AFFIRMATIVE = /^(?:yes|(?:i )?(?:agree|accept|consent|acknowledge|acknowledged|certify|attest|authorize)|confirmed)$/iu;

/** Exact code/SQL mapping. The full employer descriptor and authority id are recorded before filling. */
export function delegatedAcknowledgementValue(
  question: AgentQuestionDescriptor,
  authorization: Readonly<{ topic: string; answer: string }>,
  legalName?: string,
): AgentQuestionValue | null {
  if (normalized(authorization.topic) !== normalized(APPLICATION_ACKNOWLEDGEMENTS_TOPIC)
    || authorization.answer !== APPLICATION_ACKNOWLEDGEMENTS_AUTHORIZATION) return null;
  const label = normalized(question.label);
  let value: AgentQuestionValue;
  if (SIGNATURE.test(label)) {
    if (question.kind !== "TEXT" || question.options.length || !legalName?.trim()) return null;
    value = legalName;
  } else {
    if (!ACKNOWLEDGEMENT.test(label) || FACTUAL.test(label) || NEGATIVE.test(label)) return null;
    if (question.kind === "BOOLEAN" && question.options.length === 0) value = true;
    else if (question.kind === "SINGLE_SELECT") {
      const choices = question.options.filter(option => AFFIRMATIVE.test(normalized(option.label)));
      if (choices.length !== 1) return null;
      value = choices[0].value;
    } else if (question.kind === "MULTI_SELECT" && question.options.length === 1) {
      const choice = normalized(question.options[0].label);
      if (!AFFIRMATIVE.test(choice) && (!ACKNOWLEDGEMENT.test(choice) || FACTUAL.test(choice) || NEGATIVE.test(choice))) return null;
      value = [question.options[0].value];
    } else return null;
  }
  try { validateAgentQuestionAnswer(question, value); } catch { return null; }
  return value;
}
