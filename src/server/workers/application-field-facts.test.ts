import assert from "node:assert/strict";
import test from "node:test";

import { CANDIDATE_ANSWER_FACT_KEYS, DECLINE_TO_SELF_IDENTIFY, type CandidateFactKey } from "../../domain/candidate-profile.ts";
import type { AgentBrowserField } from "./agents-browser-tools.ts";
import { assertFactCompatible } from "./agents-form-driver.ts";
import { resolveOptionValue } from "./agents-option-match.ts";
import { deliveryFieldFactKey } from "./application-delivery-driver.ts";
import {
  ANSWER_LABEL_RULES, classifyFieldFact, fieldRejectsCandidateFact, isCandidateAnswerFactKey, normalizeFieldLabel, optionMatchForField,
} from "./application-field-facts.ts";
import { classifyFact, type ControlDescriptor } from "./greenhouse-no-submit-driver.ts";

type Case = readonly [label: string, expected: CandidateFactKey | null, kind?: string, inputType?: string];

// Every label is checked through the shared rules, the delivery driver's field
// shape and the legacy Greenhouse control shape. A null expectation means the
// field is left for the constrained model tools or the candidate.
const CASES: readonly Case[] = [
  // Identity: anchored positives with common decorations.
  ["First name", "identity.given_name"],
  ["First Name*", "identity.given_name"],
  ["First name ✱", "identity.given_name"],
  ["First name (required)", "identity.given_name"],
  ["Your first name", "identity.given_name"],
  ["Given name", "identity.given_name"],
  ["Last name", "identity.family_name"],
  ["Last Name *", "identity.family_name"],
  ["Surname", "identity.family_name"],
  ["Family name", "identity.family_name"],
  ["Surname/Family name", "identity.family_name"],
  ["Name", "identity.legal_name"],
  ["Full name", "identity.legal_name"],
  ["Full Name*", "identity.legal_name"],
  ["Your name", "identity.legal_name"],
  ["Full legal name", "identity.legal_name"],
  ["Legal name", "identity.legal_name"],
  ["First and last name", "identity.legal_name"],
  // Identity: variants and other people never take the candidate's name. A
  // clean preferred-name label is the saved preferred name, never the given name.
  ["Preferred first name", "identity.preferred_name"],
  ["Preferred name", "identity.preferred_name"],
  ["Legal first name", null],
  ["Legal last name", null],
  ["Middle name", null],
  ["Nickname", null],
  ["Maiden name", null],
  ["Name pronunciation", null],
  ["Full name of referrer", null],
  ["Manager's name", null],
  ["Hiring manager name", null],
  ["Emergency contact name", null],
  ["Company name", null],
  ["Name of your current employer", null],
  ["School name", null],
  ["Recruiter name", null],
  ["Reference 1 name", null],
  ["Name a project you are proud of", null, "LONG_TEXT", "textarea"],
  // Email.
  ["Email", "contact.application_email", "TEXT", "email"],
  ["Email:", "contact.application_email", "TEXT", "email"],
  ["E-mail", "contact.application_email"],
  ["Email Address (required)", "contact.application_email", "TEXT", "email"],
  ["Please enter your email address", "contact.application_email", "TEXT", "email"],
  ["Confirm email", "contact.application_email", "TEXT", "email"],
  ["Referral email", null, "TEXT", "email"],
  ["Referrer's email", null, "TEXT", "email"],
  ["Who referred you (email)?", null, "TEXT", "email"],
  ["Reference email", null, "TEXT", "email"],
  ["Emergency contact email", null, "TEXT", "email"],
  ["Manager email", null, "TEXT", "email"],
  ["Work email", null, "TEXT", "email"],
  ["Alternate email", null, "TEXT", "email"],
  ["University email", null, "TEXT", "email"],
  ["How can we contact you?", null, "TEXT", "email"],
  ["Email", null, "TEXT", "tel"],
  // Phone.
  ["Phone", "contact.phone", "TEXT", "tel"],
  ["Phone number", "contact.phone", "TEXT", "tel"],
  ["Mobile phone", "contact.phone", "TEXT", "tel"],
  ["Cell phone number", "contact.phone", "TEXT", "tel"],
  ["Phone Number (optional)", "contact.phone", "TEXT", "tel"],
  ["Emergency contact phone", null, "TEXT", "tel"],
  ["Previous employer phone", null, "TEXT", "tel"],
  ["Reference phone number", null, "TEXT", "tel"],
  ["Work phone", null, "TEXT", "tel"],
  ["Home phone", null, "TEXT", "tel"],
  ["Phone", null, "TEXT", "email"],
  ["Phone", null, "TEXT", "number"],
  // LinkedIn and website.
  ["LinkedIn", "contact.linkedin_url", "TEXT", "url"],
  ["LinkedIn Profile", "contact.linkedin_url"],
  ["LinkedIn Profile URL (optional)", "contact.linkedin_url", "TEXT", "url"],
  ["Referrer's LinkedIn", null, "TEXT", "url"],
  ["Company LinkedIn page", null, "TEXT", "url"],
  ["Portfolio", "contact.website_url", "TEXT", "url"],
  ["Portfolio URL", "contact.website_url", "TEXT", "url"],
  ["Personal website", "contact.website_url", "TEXT", "url"],
  ["Your website", "contact.website_url", "TEXT", "url"],
  ["Website", null, "TEXT", "url"],
  ["Website URL", null, "TEXT", "url"],
  ["Company website", null, "TEXT", "url"],
  ["Current website", null, "TEXT", "url"],
  ["Other website", null, "TEXT", "url"],
  ["GitHub URL", null, "TEXT", "url"],
  // City.
  ["City", "location.city"],
  ["Current city", "location.city"],
  ["City of residence", "location.city"],
  ["Location (City)", "location.city", "SINGLE_SELECT", "text"],
  ["City", "location.city", "SINGLE_SELECT", "select-one"],
  ["School city/state", null],
  ["City of birth", null],
  ["City, State", null],
  ["Preferred city", null],
  ["Which city would you like to work in?", null],
  ["Current location", null],
  // Region: short labels only, never sentences.
  ["State", "location.region"],
  ["State/Province", "location.region"],
  ["State / Province", "location.region", "SINGLE_SELECT", "select-one"],
  ["Province", "location.region"],
  ["Region", "location.region"],
  ["State of residence", "location.region"],
  ["State or region", "location.region"],
  // Never a region; the expectation itself is the saved salary answer.
  ["Please state your salary expectations", "compensation.expected_salary"],
  ["State your reasons for applying", null, "LONG_TEXT", "textarea"],
  ["State of birth", null],
  ["State license number", null],
  ["What state do you live in?", null],
  // Country.
  ["Country", "location.country_code", "SINGLE_SELECT", "select-one"],
  ["Country", "location.country_code"],
  ["Country of residence", "location.country_code", "SINGLE_SELECT", "select-one"],
  ["Location (Country)", "location.country_code", "SINGLE_SELECT", "select-one"],
  ["Country of citizenship", null, "SINGLE_SELECT", "select-one"],
  ["Country of birth", null, "SINGLE_SELECT", "select-one"],
  ["Country code", null, "SINGLE_SELECT", "select-one"],
  ["Countries where you are authorized to work", null, "MULTI_SELECT", "select-multiple"],
  ["Country", null, "MULTI_SELECT", "select-multiple"],
  ["Country", null, "SINGLE_SELECT", "radio"],
  // Compensation, companies and free-text prompts. Only an expectation takes
  // the saved salary answer; current, past and hourly pay stay unmapped.
  ["Current company", null],
  ["Salary expectations", "compensation.expected_salary"],
  ["Expected compensation", "compensation.expected_salary"],
  ["Desired pay", "compensation.expected_salary"],
  ["Why do you want to work here?", null, "LONG_TEXT", "textarea"],
  ["How did you hear about us?", "application.heard_about"],
  ["Please describe your experience", null, "LONG_TEXT", "textarea"],
  ["Name", null, "LONG_TEXT", "textarea"],
  ["Expected salary", "compensation.expected_salary"],
  ["Desired salary range", "compensation.expected_salary"],
  ["Expected annual base salary", "compensation.expected_salary"],
  ["What are your salary expectations?", "compensation.expected_salary"],
  ["What are your salary expectations?", "compensation.expected_salary", "LONG_TEXT", "textarea"],
  ["What is your desired salary?", "compensation.expected_salary"],
  ["Salary requirements", "compensation.expected_salary"],
  ["What are you looking for in terms of compensation?", "compensation.expected_salary"],
  ["Current salary", null],
  ["Current compensation", null],
  ["What is your current salary?", null],
  ["Current salary expectations", null],
  ["Salary", null],
  ["Salary history", null],
  ["Previous salary", null],
  ["Expected salary at your previous employer", null],
  ["Desired hourly rate", null],
  ["Expected salary", null, "TEXT", "number"],
  ["Referrer's expected salary", null],
  // Saved address and postal code: explicit street/line/ZIP labels only.
  ["Street address", "contact.address_line1"],
  ["Address line 1", "contact.address_line1"],
  ["Address 1", "contact.address_line1"],
  ["Street Address (Line 1)", "contact.address_line1"],
  ["Address line 2", "contact.address_line2"],
  ["Apartment, suite, etc.", "contact.address_line2"],
  ["Apt/Suite", "contact.address_line2"],
  ["Address", null],
  ["Home address", null],
  ["Company address", null],
  ["Work address line 1", null],
  ["Mailing address line 1", null],
  ["Billing street address", null],
  ["Email address", "contact.application_email"],
  ["Unit", null],
  ["ZIP code", "location.postal_code"],
  ["Zip", "location.postal_code"],
  ["Postal code", "location.postal_code"],
  ["ZIP / Postal Code", "location.postal_code"],
  ["Zip or postal code", "location.postal_code"],
  ["Postcode", "location.postal_code"],
  ["Please enter your ZIP code", "location.postal_code"],
  ["Company zip code", null],
  ["Work zip code", null],
  ["School zip code", null],
  ["Emergency contact postal code", null],
  ["ZIP code", null, "TEXT", "number"],
  // Preferred name and pronouns.
  ["Preferred First Name", "identity.preferred_name"],
  ["Your preferred name", "identity.preferred_name"],
  ["Preferred last name", null],
  ["Preferred full name", null],
  ["Preferred name pronunciation", null],
  ["Preferred nickname", null],
  ["What name do you prefer?", null],
  ["Pronouns", "identity.pronouns"],
  ["Preferred pronouns", "identity.pronouns"],
  ["What are your pronouns?", "identity.pronouns"],
  ["Pronouns", "identity.pronouns", "SINGLE_SELECT", "select-one"],
  ["Other pronouns", null],
  // How the candidate found the job.
  ["How did you hear about this job?", "application.heard_about"],
  ["How did you hear about this position?", "application.heard_about", "SINGLE_SELECT", "select-one"],
  ["How did you hear about Northstar Systems?", "application.heard_about"],
  ["Where did you hear about us?", "application.heard_about"],
  ["Where did you find this job posting?", "application.heard_about"],
  ["How did you hear about us?", "application.heard_about", "LONG_TEXT", "textarea"],
  ["How did you learn about Python?", null],
  ["How did you hear about our referral program?", null],
  ["How did you hear about our company?", null],
  ["If referred, how did you hear about us?", null],
  ["How did you hear about us? Please explain", null],
  ["Source", null],
  // Earliest start. A bare "Start date" is often employment history.
  ["Earliest start date", "availability.start_date"],
  ["Desired start date", "availability.start_date"],
  ["When can you start?", "availability.start_date"],
  ["If hired, when can you start?", "availability.start_date"],
  ["When would you be available to start?", "availability.start_date"],
  ["How soon can you start?", "availability.start_date", "SINGLE_SELECT", "select-one"],
  ["What is your earliest possible start date?", "availability.start_date"],
  // Observed on hosted Greenhouse and Lever forms (2026-09-28 form audit).
  ["When is the earliest you could start in this role?", "availability.start_date"],
  ["How soon are you available to start working?", "availability.start_date"],
  ["When is the earliest you could start an interview?", null],
  ["When is the earliest your previous employer could release you?", null],
  ["Start date", null],
  ["Previous job start date", null],
  ["Start date at your current employer", null],
  ["Earliest start date", null, "TEXT", "date"],
  ["Earliest interview date", null],
  // Relocation willingness, never relocation assistance or a specific place.
  ["Are you willing to relocate?", "preferences.willing_to_relocate"],
  ["Are you willing to relocate?", "preferences.willing_to_relocate", "SINGLE_SELECT", "select-one"],
  ["Are you open to relocation?", "preferences.willing_to_relocate"],
  ["Would you consider relocating for this role?", "preferences.willing_to_relocate"],
  ["Willingness to relocate", "preferences.willing_to_relocate"],
  ["Relocation", null],
  ["Do you require relocation assistance?", null],
  ["Are you willing to relocate to New York?", null],
  ["Is your spouse willing to relocate?", null],
  // Highest level of education, never an education-history row.
  ["Highest level of education", "education.highest_degree", "SINGLE_SELECT", "select-one"],
  ["Highest level of education completed", "education.highest_degree"],
  ["What is the highest level of education you have completed?", "education.highest_degree", "SINGLE_SELECT", "select-one"],
  ["Highest degree obtained", "education.highest_degree"],
  ["Education level", "education.highest_degree", "SINGLE_SELECT", "select-one"],
  ["Degree", null, "SINGLE_SELECT", "select-one"],
  ["School", null],
  ["Highest degree currently pursuing", null],
  ["Highest level of education required for this role", null],
  ["Minimum level of education", null, "SINGLE_SELECT", "select-one"],
  ["Field of study", null],
  // Voluntary self-identification, choice controls only.
  ["Gender", "self_id.gender", "SINGLE_SELECT", "select-one"],
  ["Gender (optional)", "self_id.gender", "SINGLE_SELECT", "select-one"],
  ["Gender identity", "self_id.gender", "SINGLE_SELECT", "select-one"],
  ["Are you Hispanic/Latino?", "self_id.hispanic_latino", "SINGLE_SELECT", "select-one"],
  ["Hispanic or Latino", "self_id.hispanic_latino", "SINGLE_SELECT", "select-one"],
  ["Race", "self_id.race_ethnicity", "SINGLE_SELECT", "select-one"],
  ["Race/Ethnicity", "self_id.race_ethnicity", "SINGLE_SELECT", "select-one"],
  ["Race & Ethnicity", "self_id.race_ethnicity", "SINGLE_SELECT", "select-one"],
  ["Race (*Please select one option that best describes how you identify*)*", "self_id.race_ethnicity", "SINGLE_SELECT", "select-one"],
  ["Race (select one)", "self_id.race_ethnicity", "SINGLE_SELECT", "select-one"],
  ["Race (please select one option that best describes your spouse)", null, "SINGLE_SELECT", "select-one"],
  ["Veteran Status", "self_id.veteran_status", "SINGLE_SELECT", "select-one"],
  ["Protected veteran status", "self_id.veteran_status", "SINGLE_SELECT", "select-one"],
  ["Are you a protected veteran?", "self_id.veteran_status", "SINGLE_SELECT", "select-one"],
  ["Disability Status", "self_id.disability_status", "SINGLE_SELECT", "select-one"],
  ["Voluntary Self-Identification of Disability", "self_id.disability_status", "SINGLE_SELECT", "select-one"],
  ["Gender", null],
  ["Gender", null, "LONG_TEXT", "textarea"],
  ["Sex", null, "SINGLE_SELECT", "select-one"],
  ["Sex assigned at birth", null, "SINGLE_SELECT", "select-one"],
  ["Gender assigned at birth", null, "SINGLE_SELECT", "select-one"],
  ["Sexual orientation", null, "SINGLE_SELECT", "select-one"],
  ["Ethnicity", null, "SINGLE_SELECT", "select-one"],
  ["Race (check all that apply)", null, "SINGLE_SELECT", "select-one"],
  ["Race", null, "MULTI_SELECT", "select-multiple"],
  ["Is your spouse a protected veteran?", null, "SINGLE_SELECT", "select-one"],
  ["Are you a disabled veteran?", null, "SINGLE_SELECT", "select-one"],
  ["Do you need a disability accommodation?", null, "SINGLE_SELECT", "select-one"],
  ["Disability accommodation", null, "SINGLE_SELECT", "select-one"],
  ["Gender of your emergency contact", null, "SINGLE_SELECT", "select-one"],
];

function browserField(label: string, kind: string, inputType: string, extra: Partial<AgentBrowserField> = {}): AgentBrowserField {
  return Object.freeze({
    fieldId: `field_${"a".repeat(64)}`, fingerprint: "a".repeat(64), label, kind: kind as AgentBrowserField["kind"], inputType,
    name: "", domId: "", autocomplete: "", placeholder: "", required: false, readOnly: false, candidateOnly: false,
    options: kind === "SINGLE_SELECT" || kind === "MULTI_SELECT" ? [{ value: "x", label: "x" }] : [], accept: "", multiple: kind === "MULTI_SELECT",
    hasValue: false, valid: true, optionCount: 0, searchable: false, ...extra,
  });
}

function legacyControl(label: string, kind: string, inputType: string, extra: Partial<ControlDescriptor> = {}): ControlDescriptor {
  const tagName = kind === "LONG_TEXT" ? "textarea" : ["select-one", "select-multiple"].includes(inputType) ? "select" : "input";
  return Object.freeze({
    index: 0, tagName, type: inputType, name: "", id: "", autocomplete: "", label, optionLabel: "", value: "", checked: false,
    fileCount: 0, placeholder: "", accept: "", required: false, disabled: false, visible: true, insideForm: true, ...extra,
  }) as ControlDescriptor;
}

test("anchored label rules map only exact candidate questions and leave look-alikes empty", () => {
  assert.ok(CASES.length >= 60, "the table must stay exhaustive");
  const failures: string[] = [];
  for (const [label, expected, kind = "TEXT", inputType = "text"] of CASES) {
    const shared = classifyFieldFact({ label, kind, inputType });
    const delivery = deliveryFieldFactKey(browserField(label, kind, inputType));
    const legacy = classifyFact(legacyControl(label, kind, inputType));
    for (const [path, actual] of [["shared", shared], ["delivery", delivery], ["legacy", legacy]] as const) {
      if (actual !== expected) failures.push(`${path} ${JSON.stringify(label)} ${kind}/${inputType}: expected ${expected}, got ${actual}`);
    }
  }
  assert.deepEqual(failures, []);
});

// Verbatim labels the production observer reported on live hosted Greenhouse
// forms (2026-09-28 read-only audit): a required control's aria-label and its
// visible "Label*" are joined, so the same words arrive twice.
test("a label repeated by the observer classifies as the single question it names", () => {
  const cases: readonly (readonly [string, CandidateFactKey | null, string, string])[] = [
    ["First Name First Name*", "identity.given_name", "TEXT", "text"],
    ["Last Name Last Name*", "identity.family_name", "TEXT", "text"],
    ["Email Email*", "contact.application_email", "TEXT", "text"],
    ["Phone Phone*", "contact.phone", "TEXT", "tel"],
    ["LinkedIn Profile LinkedIn Profile*", "contact.linkedin_url", "TEXT", "text"],
    ["Preferred First Name Preferred First Name *", "identity.preferred_name", "TEXT", "text"],
    ["Preferred Pronouns Preferred Pronouns*", "identity.pronouns", "TEXT", "text"],
    ["What are your compensation expectations? What are your compensation expectations*", "compensation.expected_salary", "TEXT", "text"],
    ["How did you hear about this job? How did you hear about this job?*", "application.heard_about", "TEXT", "text"],
    ["When is the earliest you could start in this role? When is the earliest you could start in this role?*", "availability.start_date", "TEXT", "text"],
    // Repetition never widens a rule: these stay with the model tools or the candidate.
    ["Legal Address: Legal Address:*", null, "TEXT", "text"],
    ["Full address Full address*", null, "LONG_TEXT", "textarea"],
    ["Phone Country*", null, "SINGLE_SELECT", "text"],
    ["How did you hear about this job? If referred by employee, please list employee's name: How did you hear about this job? If referred by employee, please list employee's name:*", null, "TEXT", "text"],
    ["Email email of your referrer", null, "TEXT", "text"],
    ["Referral email Referral email*", null, "TEXT", "email"],
    ["Emergency contact phone Emergency contact phone*", null, "TEXT", "tel"],
  ];
  for (const [label, expected, kind, inputType] of cases) {
    assert.equal(deliveryFieldFactKey(browserField(label, kind, inputType)), expected, label);
  }
  assert.equal(normalizeFieldLabel("First Name First Name*"), "first name");
  assert.equal(normalizeFieldLabel("How did you hear about this job? How did you hear about this job?*"), "how did you hear about this job");
  assert.equal(normalizeFieldLabel("Phone Country*"), "phone country");
  // The observer's React Select combobox for a single-answer race question.
  assert.equal(deliveryFieldFactKey(browserField("Race (*Please select one option that best describes how you identify*)*", "SINGLE_SELECT", "text")), "self_id.race_ethnicity");
  // A repeated third-party label is still refused for the candidate's own fact.
  assert.equal(fieldRejectsCandidateFact({ label: "Referrer name Referrer name*" }, "identity.legal_name"), true);
});

test("autocomplete hints never select a fact without an anchored label", () => {
  const cases: readonly [string, string, string][] = [
    ["How should our team address you?", "name", "text"],
    ["What should we call you?", "given-name", "text"],
    ["Where can we reach you?", "email", "email"],
    ["Referral email", "email", "email"],
    ["Contact", "tel", "tel"],
    ["Where do you live?", "postal-code", "text"],
    ["Where do you live?", "street-address", "text"],
  ];
  for (const [label, autocomplete, inputType] of cases) {
    assert.equal(deliveryFieldFactKey(browserField(label, "TEXT", inputType, { autocomplete })), null, label);
    assert.equal(classifyFact(legacyControl(label, "TEXT", inputType, { autocomplete })), null, label);
  }
  // The label decides: a given-name hint never turns a preferred-name field into the given name.
  assert.equal(deliveryFieldFactKey(browserField("Preferred first name", "TEXT", "text", { autocomplete: "given-name" })), "identity.preferred_name");
  assert.equal(classifyFact(legacyControl("Preferred first name", "TEXT", "text", { autocomplete: "given-name" })), "identity.preferred_name");
});

test("choice-only saved answers accept native selects, ARIA comboboxes and labelled radio groups, never free text", () => {
  for (const inputType of ["select-one", "text", "combobox", "radio"]) {
    assert.equal(deliveryFieldFactKey(browserField("Veteran Status", "SINGLE_SELECT", inputType)), "self_id.veteran_status", inputType);
    assert.equal(deliveryFieldFactKey(browserField("Are you willing to relocate?", "SINGLE_SELECT", inputType)), "preferences.willing_to_relocate", inputType);
  }
  for (const [kind, inputType] of [["TEXT", "text"], ["LONG_TEXT", "textarea"], ["MULTI_SELECT", "select-multiple"], ["BOOLEAN", "checkbox"]] as const) {
    assert.equal(deliveryFieldFactKey(browserField("Disability status", kind, inputType)), null, `${kind}/${inputType}`);
  }
  // Field names and IDs veto a saved answer as they veto a profile fact.
  assert.equal(classifyFieldFact({ label: "ZIP code", kind: "TEXT", inputType: "text", name: "emergency_contact_zip" }), null);
  assert.equal(classifyFieldFact({ label: "Gender", kind: "SINGLE_SELECT", inputType: "select-one", domId: "spouseGender" }), null);
  assert.equal(classifyFieldFact({ label: "Gender", kind: "SINGLE_SELECT", inputType: "select-one", name: "eeo[gender]" }), "self_id.gender");
  assert.equal(classifyFieldFact({ label: "Preferred First Name", kind: "TEXT", inputType: "text", name: "preferred_name", domId: "preferred_name" }), "identity.preferred_name");
});

test("every saved answer key has exactly one anchored label rule", () => {
  assert.deepEqual(ANSWER_LABEL_RULES.map((rule) => rule.factKey).sort(), [...CANDIDATE_ANSWER_FACT_KEYS].sort());
  for (const key of CANDIDATE_ANSWER_FACT_KEYS) assert.equal(isCandidateAnswerFactKey(key), true, key);
  assert.equal(isCandidateAnswerFactKey("identity.given_name"), false);
  assert.equal(isCandidateAnswerFactKey("work_authorization.us.authorized"), false);
});

test("field names and IDs can veto an otherwise generic label", () => {
  const vetoed: readonly [string, string][] = [["referral_email", ""], ["", "emergencyContactPhone"], ["urls[Other]", ""], ["manager_name", ""], ["work_email", ""]];
  for (const [name, domId] of vetoed) {
    const label = name.includes("phone") || domId.includes("Phone") ? "Phone" : name.includes("name") ? "Name" : name.includes("Other") ? "Portfolio" : "Email";
    assert.equal(classifyFieldFact({ label, kind: "TEXT", inputType: "text", name, domId }), null, `${name}${domId}`);
  }
  assert.equal(classifyFieldFact({ label: "Email", kind: "TEXT", inputType: "email", name: "job_application[email]", domId: "email" }), "contact.application_email");
  assert.equal(classifyFieldFact({ label: "LinkedIn URL", kind: "TEXT", inputType: "text", name: "urls[LinkedIn]" }), "contact.linkedin_url");
});

test("label normalization strips only required markers, decorations and trailing punctuation", () => {
  assert.equal(normalizeFieldLabel("  E-mail Address ✱ "), "e-mail address");
  assert.equal(normalizeFieldLabel("State / Province (required):"), "state/province");
  assert.equal(normalizeFieldLabel("Phone number (Optional)"), "phone number");
  assert.equal(normalizeFieldLabel("Location ( City )"), "location (city)");
  assert.equal(normalizeFieldLabel("Please state your salary expectations?"), "please state your salary expectations");
});

const fact = (factKey: string, value: string) => ({ factVersionId: `${factKey}-1`, factKey, value, valueHash: "b".repeat(64) }) as Parameters<typeof assertFactCompatible>[1];

test("model-selected facts cannot reach third-party, employer, compensation or name-variant fields", () => {
  const blocked: readonly [string, string, string][] = [
    ["Who referred you?", "identity.legal_name", "text"],
    ["Referrer contact", "contact.application_email", "email"],
    ["In case of emergency, who should we call?", "contact.phone", "tel"],
    ["Your manager's contact number", "contact.phone", "tel"],
    ["Where is your current employer located?", "location.city", "text"],
    ["Which school did you attend? (city)", "location.city", "text"],
    ["What name do you prefer?", "identity.given_name", "text"],
    ["Preferred name", "identity.legal_name", "text"],
    ["Other names used", "identity.legal_name", "text"],
    ["Please state your salary expectations", "location.region", "text"],
  ];
  for (const [label, factKey, inputType] of blocked) {
    assert.equal(fieldRejectsCandidateFact({ label }, factKey), true, label);
    assert.throws(() => assertFactCompatible(browserField(label, "TEXT", inputType), fact(factKey, "value")), /CANDIDATE_ANSWER_REQUIRED/u, label);
  }
  // Varied first-person wording remains available to the model.
  for (const [label, factKey, inputType] of [["How should our team address you?", "identity.legal_name", "text"], ["Where can we reach you?", "contact.application_email", "email"], ["Best number to reach you", "contact.phone", "tel"]] as const) {
    assert.equal(fieldRejectsCandidateFact({ label }, factKey), false, label);
    assert.doesNotThrow(() => assertFactCompatible(browserField(label, "TEXT", inputType), fact(factKey, "value")), label);
  }
});

test("a location fact reaches a choice control only through that control's own anchored label", () => {
  assert.doesNotThrow(() => assertFactCompatible(browserField("Country", "SINGLE_SELECT", "select-one"), fact("location.country_code", "CA")));
  assert.doesNotThrow(() => assertFactCompatible(browserField("State", "SINGLE_SELECT", "select-one"), fact("location.region", "CA")));
  // "CA" in an unlabelled or differently labelled list could mean California.
  assert.throws(() => assertFactCompatible(browserField("Where do you live?", "SINGLE_SELECT", "select-one"), fact("location.country_code", "CA")), /FACT_TYPE_MISMATCH/u);
  assert.throws(() => assertFactCompatible(browserField("State", "SINGLE_SELECT", "select-one"), fact("location.country_code", "CA")), /FACT_TYPE_MISMATCH/u);
});

test("legal names and work authorization stay candidate-scoped", () => {
  const legal = (label: string) => browserField(label, "TEXT", "text", { candidateOnly: true });
  assert.doesNotThrow(() => assertFactCompatible(legal("Full legal name"), fact("identity.legal_name", "Alex Candidate")));
  assert.throws(() => assertFactCompatible(legal("Legal name of your current employer"), fact("identity.legal_name", "Alex Candidate")), /CANDIDATE_ANSWER_REQUIRED/u);
  assert.throws(() => assertFactCompatible(legal("Signature (type your full legal name)"), fact("identity.legal_name", "Alex Candidate")), /CANDIDATE_ANSWER_REQUIRED/u);
  const question = (label: string) => browserField(label, "SINGLE_SELECT", "select-one", { candidateOnly: true, options: [{ value: "Yes", label: "Yes" }, { value: "No", label: "No" }] });
  assert.doesNotThrow(() => assertFactCompatible(question("Are you legally authorized to work in the United States?"), fact("work_authorization.us.authorized", "Yes")));
  assert.doesNotThrow(() => assertFactCompatible(question("Are you legally authorized to work in the United States for any employer?"), fact("work_authorization.us.authorized", "Yes")));
  for (const label of ["Is your spouse authorized to work in the United States?", "Was your previous role authorized to work in the United States?", "Is your emergency contact authorized to work in Canada?"]) {
    assert.throws(() => assertFactCompatible(question(label), fact("work_authorization.us.authorized", "Yes")), /CANDIDATE_ANSWER_REQUIRED/u, label);
  }
});

test("a saved answer reaches only its own anchored question, whatever the model proposes", () => {
  const text = (label: string, inputType = "text", extra: Partial<AgentBrowserField> = {}) => browserField(label, "TEXT", inputType, extra);
  const choice = (label: string, candidateOnly = false) => browserField(label, "SINGLE_SELECT", "select-one", { candidateOnly });
  const allowed: readonly [AgentBrowserField, string, string][] = [
    [text("Preferred first name"), "identity.preferred_name", "Sam"],
    [text("Pronouns"), "identity.pronouns", "she/her"],
    [text("Street address"), "contact.address_line1", "1 Synthetic Way"],
    [text("Address line 2"), "contact.address_line2", "Unit 4"],
    [text("ZIP code"), "location.postal_code", "20001"],
    [text("Expected salary"), "compensation.expected_salary", "$150,000 base"],
    [text("Please state your salary expectations"), "compensation.expected_salary", "$150,000 base"],
    [text("When can you start?"), "availability.start_date", "Two weeks after an offer"],
    [choice("Are you willing to relocate?"), "preferences.willing_to_relocate", "Yes"],
    [choice("How did you hear about us?"), "application.heard_about", "Company careers page"],
    [choice("Highest level of education"), "education.highest_degree", "Master's degree"],
    // Demographic questions are candidate-only; their own saved answer is the one exception.
    [choice("Gender", true), "self_id.gender", DECLINE_TO_SELF_IDENTIFY],
    [choice("Are you Hispanic/Latino?", true), "self_id.hispanic_latino", "No"],
    [choice("Race/Ethnicity", true), "self_id.race_ethnicity", "Asian"],
    [choice("Veteran Status", true), "self_id.veteran_status", "I am not a protected veteran"],
    [choice("Disability Status", true), "self_id.disability_status", DECLINE_TO_SELF_IDENTIFY],
  ];
  for (const [field, factKey, value] of allowed) {
    assert.equal(fieldRejectsCandidateFact(field, factKey), false, `${field.label} ${factKey}`);
    assert.doesNotThrow(() => assertFactCompatible(field, fact(factKey, value)), `${field.label} ${factKey}`);
  }
  const blocked: readonly [AgentBrowserField, string][] = [
    // Compensation: never current or past pay, and nothing else in an expectation field.
    [text("Current salary"), "compensation.expected_salary"],
    [text("What is your current salary?"), "compensation.expected_salary"],
    [text("Salary history"), "compensation.expected_salary"],
    [text("Desired hourly rate"), "compensation.expected_salary"],
    [text("Expected salary", "number"), "compensation.expected_salary"],
    [text("Why do you want this role?"), "compensation.expected_salary"],
    [text("Expected salary"), "location.region"],
    [text("Expected salary"), "application.heard_about"],
    [text("Expected salary"), "availability.start_date"],
    [text("Salary expectations"), "identity.legal_name"],
    // Other people, organizations and different contact points.
    [text("Referrer's email", "email"), "contact.application_email"],
    [text("Referrer's zip code"), "location.postal_code"],
    [text("Company address line 1"), "contact.address_line1"],
    [text("Work zip code"), "location.postal_code"],
    [text("Emergency contact pronouns"), "identity.pronouns"],
    [text("Expected salary", "text", { name: "referrer_expected_salary" }), "compensation.expected_salary"],
    // Name variants: the preferred name is never the given, legal or middle name, and vice versa.
    [text("Preferred name"), "identity.given_name"],
    [text("Preferred first name"), "identity.legal_name"],
    [text("First name"), "identity.preferred_name"],
    [text("Full legal name"), "identity.preferred_name"],
    [text("Middle name"), "identity.preferred_name"],
    [text("Nickname"), "identity.preferred_name"],
    // Answers proposed for a look-alike question.
    [choice("Are you 18 years or older?"), "preferences.willing_to_relocate"],
    [choice("Do you require relocation assistance?"), "preferences.willing_to_relocate"],
    [text("Start date"), "availability.start_date"],
    [choice("Degree"), "education.highest_degree"],
    [text("How did you learn about Python?"), "application.heard_about"],
    [text("Address"), "contact.address_line1"],
    [text("Apartment, suite, etc."), "contact.address_line1"],
    // Protected answers: only the exact self-identification question, as a choice.
    [choice("Veteran Status", true), "self_id.gender"],
    [choice("Gender", true), "self_id.race_ethnicity"],
    [choice("Sex", true), "self_id.gender"],
    [choice("Pronouns", true), "self_id.gender"],
    [text("Gender", "text", { candidateOnly: true }), "self_id.gender"],
    [choice("Is your spouse a protected veteran?", true), "self_id.veteran_status"],
    [choice("Tell us about yourself"), "self_id.disability_status"],
    // Profile facts never enter a demographic question.
    [choice("Gender", true), "identity.legal_name"],
    [choice("Race", true), "location.country_code"],
  ];
  for (const [field, factKey] of blocked) {
    assert.throws(() => assertFactCompatible(field, fact(factKey, "value")), /CANDIDATE_ANSWER_REQUIRED|FACT_TYPE_MISMATCH/u, `${field.label} ${factKey}`);
  }
});

test("self-identification fields resolve equivalent option wording only through their own classified question", () => {
  const gender = browserField("Gender", "SINGLE_SELECT", "select-one", { candidateOnly: true,
    options: [{ value: "1", label: "Male" }, { value: "2", label: "Female" }, { value: "3", label: "Decline To Self Identify" }] });
  const facts = [{ factKey: "self_id.gender", value: "Woman" }];
  assert.equal(optionMatchForField(gender, "self_id.gender", facts).semantic, "SELF_ID");
  assert.equal(resolveOptionValue(gender.options, "Woman", optionMatchForField(gender, "self_id.gender", facts)), "2");
  assert.equal(resolveOptionValue(gender.options, DECLINE_TO_SELF_IDENTIFY, optionMatchForField(gender, "self_id.gender", facts)), "3");
  // A candidate answer on the classified question gets the same wording table.
  assert.equal(optionMatchForField(gender, null, facts).semantic, "SELF_ID");
  // A mismatched fact key or an unclassified look-alike gets no aliases.
  assert.equal(optionMatchForField(gender, "self_id.veteran_status", facts).semantic, null);
  const unclassified = browserField("Gender of your emergency contact", "SINGLE_SELECT", "select-one", { options: gender.options });
  assert.equal(optionMatchForField(unclassified, null, facts).semantic, null);
  assert.throws(() => resolveOptionValue(unclassified.options, "Woman", optionMatchForField(unclassified, null, facts)), /OPTION_AMBIGUOUS/u);
});

test("only the reviewed Ashby system Location control receives city semantics", () => {
  const field = browserField("Location", "SINGLE_SELECT", "text", { provider: "ASHBY", domId: "_systemfield_location", name: "_systemfield_location", searchable: true });
  assert.equal(classifyFieldFact(field), "location.city");
  assert.equal(deliveryFieldFactKey(field), "location.city");
  assert.doesNotThrow(() => assertFactCompatible(field, fact("location.city", "Springfield")));
  for (const factKey of [null, "location.city"] as const) {
    assert.deepEqual(optionMatchForField(field, factKey, [{ factKey: "location.region", value: "IL" }, { factKey: "location.country_code", value: "US" }]),
      { semantic: "CITY", source: factKey === null ? "ANSWER" : "FACT", hints: { region: "IL", country: "US" } });
  }
  for (const change of [{ provider: undefined }, { domId: "other" }, { name: "other" }, { kind: "TEXT" }, { inputType: "select-one" }, { label: "Employer location" }, { label: "Preferred work location" }, { label: "Location (country)" }]) {
    const other = { ...field, ...change } as AgentBrowserField;
    assert.notEqual(classifyFieldFact(other), "location.city", JSON.stringify(change));
    assert.notEqual(optionMatchForField(other, null, []).semantic, "CITY");
    if (other.kind === "SINGLE_SELECT") assert.throws(() => assertFactCompatible(other, fact("location.city", "Springfield")));
  }
  assert.equal(classifyFieldFact(browserField("Location", "SINGLE_SELECT", "select-one", { options: [{ label: "United States", value: "US" }] })), null);
});

test("only the reviewed Lever native current-location slot receives the approved city", () => {
  const field = browserField("Current location ✱", "SINGLE_SELECT", "text", { provider: "LEVER", domId: "location-input", name: "location" });
  assert.equal(classifyFieldFact(field), "location.city");
  assert.equal(deliveryFieldFactKey(field), "location.city");
  assert.doesNotThrow(() => assertFactCompatible(field, fact("location.city", "Springfield")));
  for (const change of [{ provider: undefined }, { domId: "other" }, { name: "other" }, { kind: "TEXT" }, { inputType: "search" }, { label: "Preferred work location" }, { label: "Employer current location" }]) {
    assert.equal(classifyFieldFact({ ...field, ...change } as AgentBrowserField), null, JSON.stringify(change));
  }
});

test("Ashby intended work city uses an exact candidate answer without defaulting to residence", () => {
  const field = browserField("Which city and country do you intend to work from?", "SINGLE_SELECT", "text", { provider: "ASHBY", domId: "_systemfield_location", name: "_systemfield_location", searchable: true });
  assert.equal(classifyFieldFact(field), null);
  assert.equal(optionMatchForField(field, null, []).semantic, "CITY");
  assert.equal(optionMatchForField(field, "location.city", []).semantic, null);
  for (const change of [{ provider: undefined }, { domId: "other" }, { name: "other" }, { kind: "TEXT" }, { label: "Which country do you intend to work from?" }]) {
    assert.equal(optionMatchForField({ ...field, ...change } as AgentBrowserField, null, []).semantic, null);
  }
});
