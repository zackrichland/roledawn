import { candidateFactDefinition, type CandidateFactKey, type CandidateFactValue } from "./candidate-profile.ts";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const ISO_COUNTRY_CODES = new Set(["US", "CA"]);

export class CandidateProfileError extends Error {
  readonly code: string;
  readonly field: CandidateFactKey | null;

  constructor(code: string, message: string, field: CandidateFactKey | null = null) {
    super(message);
    this.name = "CandidateProfileError";
    this.code = code;
    this.field = field;
  }
}

function compactText(value: string, maximum: number, field: CandidateFactKey): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (!normalized || normalized.length > maximum) {
    throw new CandidateProfileError(
      "CANDIDATE_FACT_VALUE_INVALID",
      `Enter ${maximum === 120 ? "a shorter value" : "a valid value"}.`,
      field,
    );
  }
  return normalized;
}

function publicHttpsUrl(value: string, field: CandidateFactKey): string {
  const normalized = compactText(value, 2048, field);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new CandidateProfileError("CANDIDATE_FACT_URL_INVALID", "Enter a complete https:// URL.", field);
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
  ) {
    throw new CandidateProfileError("CANDIDATE_FACT_URL_INVALID", "Use a public https:// URL.", field);
  }
  parsed.hash = "";
  return parsed.toString();
}

function normalizePhone(value: string): string {
  let normalized = value.trim().replace(/[\s().-]/gu, "");
  // North American numbers are usually typed without a country code.
  if (/^\d{10}$/u.test(normalized)) normalized = `+1${normalized}`;
  else if (/^1\d{10}$/u.test(normalized)) normalized = `+${normalized}`;
  if (!E164_PATTERN.test(normalized)) {
    throw new CandidateProfileError(
      "CANDIDATE_FACT_PHONE_INVALID",
      "Enter a phone number with country code, such as +1 202 555 0123.",
      "contact.phone",
    );
  }
  return normalized;
}

function normalizeTriState(value: string, field: CandidateFactKey): CandidateFactValue {
  if (value === "yes") return true;
  if (value === "no") return false;
  if (value === "unsure") return "unsure";
  throw new CandidateProfileError("CANDIDATE_FACT_VALUE_INVALID", "Choose Yes, No, or I'm not sure.", field);
}

export function normalizeCandidateFactValue(
  key: CandidateFactKey,
  rawValue: string,
): Readonly<{ value: CandidateFactValue; normalizedText: string }> {
  switch (key) {
    case "identity.given_name":
    case "identity.family_name": {
      const text = compactText(rawValue, 80, key);
      return { value: text, normalizedText: text };
    }
    case "identity.legal_name": {
      const text = compactText(rawValue, 160, key);
      return { value: text, normalizedText: text };
    }
    case "contact.application_email": {
      const email = compactText(rawValue.toLowerCase(), 254, key);
      if (!EMAIL_PATTERN.test(email)) {
        throw new CandidateProfileError("CANDIDATE_FACT_EMAIL_INVALID", "Enter a valid application email.", key);
      }
      return { value: email, normalizedText: email };
    }
    case "contact.phone": {
      const phone = normalizePhone(rawValue);
      return { value: phone, normalizedText: phone };
    }
    case "contact.linkedin_url": {
      const url = publicHttpsUrl(rawValue, key);
      const parsed = new URL(url);
      if (!/(^|\.)linkedin\.com$/i.test(parsed.hostname) || !parsed.pathname.toLowerCase().startsWith("/in/")) {
        throw new CandidateProfileError("CANDIDATE_FACT_LINKEDIN_INVALID", "Use your linkedin.com/in/ profile URL.", key);
      }
      parsed.search = "";
      return { value: parsed.toString(), normalizedText: parsed.toString() };
    }
    case "contact.website_url": {
      const url = publicHttpsUrl(rawValue, key);
      return { value: url, normalizedText: url };
    }
    case "location.city":
    case "location.region": {
      const text = compactText(rawValue, 120, key);
      return { value: text, normalizedText: text };
    }
    case "location.country_code": {
      const country = compactText(rawValue.toUpperCase(), 2, key);
      if (!ISO_COUNTRY_CODES.has(country)) {
        throw new CandidateProfileError("CANDIDATE_FACT_COUNTRY_INVALID", "Choose a supported country.", key);
      }
      return { value: country, normalizedText: country };
    }
    case "work_authorization.us.authorized":
    case "work_authorization.us.sponsorship_required":
    case "work_authorization.ca.authorized":
    case "work_authorization.ca.sponsorship_required": {
      const value = normalizeTriState(rawValue, key);
      return { value, normalizedText: typeof value === "boolean" ? (value ? "Yes" : "No") : "I'm not sure" };
    }
    case "location.postal_code": {
      const text = compactText(rawValue.toUpperCase(), 12, key);
      if (!/^[A-Z0-9][A-Z0-9 -]{1,11}$/u.test(text)) {
        throw new CandidateProfileError("CANDIDATE_FACT_VALUE_INVALID", "Enter a valid ZIP or postal code.", key);
      }
      return { value: text, normalizedText: text };
    }
    case "identity.preferred_name":
      return textAnswer(rawValue, 80, key);
    case "identity.pronouns":
      return textAnswer(rawValue, 40, key);
    case "contact.address_line1":
    case "contact.address_line2":
      return textAnswer(rawValue, 160, key);
    case "compensation.expected_salary":
    case "availability.start_date":
    case "application.heard_about":
      return textAnswer(rawValue, 120, key);
    case "preferences.willing_to_relocate":
    case "education.highest_degree":
    case "self_id.gender":
    case "self_id.hispanic_latino":
    case "self_id.race_ethnicity":
    case "self_id.veteran_status":
    case "self_id.disability_status":
      return choiceAnswer(rawValue, key);
  }
}

function textAnswer(rawValue: string, maximum: number, key: CandidateFactKey): Readonly<{ value: string; normalizedText: string }> {
  const text = compactText(rawValue, maximum, key);
  return { value: text, normalizedText: text };
}

function choiceAnswer(rawValue: string, key: CandidateFactKey): Readonly<{ value: string; normalizedText: string }> {
  const text = rawValue.trim().replace(/\s+/gu, " ");
  const choice = candidateFactDefinition(key).choices?.find((option) => option === text);
  if (!choice) throw new CandidateProfileError("CANDIDATE_FACT_VALUE_INVALID", "Choose one of the listed answers.", key);
  return { value: choice, normalizedText: choice };
}
