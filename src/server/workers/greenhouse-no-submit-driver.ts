import { createHash } from "node:crypto";

import type { Locator, Page } from "playwright-core";

import type { CandidateFactKey } from "../../domain/candidate-profile.ts";
import type {
  ComputerRuntimeProvisionRequest,
  NoSubmitFormDriver,
  NoSubmitFormOutcome,
} from "./application-fill.ts";
import type {
  ApplicationFillExecutionPackage,
  MaterializedApplicationArtifact,
} from "./application-fill-materializer.ts";
import {
  browserbaseRuntimePage,
  recordBrowserbaseRuntimeUpload,
} from "./browserbase-runtime.ts";
import { resolveOptionValue, type OptionSemantic } from "./agents-option-match.ts";
import { classifyFieldFact, describesOtherPersonOrPast } from "./application-field-facts.ts";

export const GREENHOUSE_NO_SUBMIT_DRIVER_RELEASE = "greenhouse-deterministic-fill/2";

export type ControlDescriptor = Readonly<{
  index: number;
  tagName: "input" | "select" | "textarea" | "button";
  type: string;
  name: string;
  id: string;
  autocomplete: string;
  label: string;
  optionLabel: string;
  value: string;
  checked: boolean;
  fileCount: number;
  placeholder: string;
  accept: string;
  required: boolean;
  disabled: boolean;
  visible: boolean;
  insideForm: boolean;
}>;

type PlannedFactFill = Readonly<{
  kind: "FACT";
  control: ControlDescriptor;
  factKey: CandidateFactKey;
  value: string;
}>;

type PlannedArtifactFill = Readonly<{
  kind: "ARTIFACT";
  control: ControlDescriptor;
  artifact: MaterializedApplicationArtifact;
}>;

type PlannedFill = PlannedFactFill | PlannedArtifactFill;

type NoSubmitDriverInput = Parameters<NoSubmitFormDriver["fillToPreSubmitReview"]>[0];

export type GreenhouseNoSubmitDriverDependencies = Readonly<{
  resolvePage?: (runtimeHandle: unknown) => Page;
  recordUpload?: (runtimeHandle: unknown, byteCount: number) => void;
}>;

const SENSITIVE_OR_LEGAL_PATTERN = new RegExp(
  String.raw`\b(?:gender|race|ethnic|veteran|disabilit|sexual orientation|pronoun|date of birth|age|citizen|citizenship|work authori[sz]ation|sponsor(?:ship)?|visa|criminal|conviction|background check|certif(?:y|ication)|attest(?:ation)?|signature|consent|terms and conditions|privacy agreement|equal employment|eeo)\b`,
  "iu",
);
const OTP_OR_MFA_PATTERN = /\b(?:one[ -]?time|otp|mfa|multi[ -]?factor|verification code|security code)\b/iu;
const LOGIN_PATH_PATTERN = /\/(?:login|log-in|signin|sign-in|account)(?:\/|$)/iu;

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[_-]+/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function descriptorText(control: ControlDescriptor): string {
  return normalizeText([
    control.label,
    control.placeholder,
    control.name,
    control.id,
    control.autocomplete,
  ].filter(Boolean).join(" "));
}

function isSubmitControl(control: ControlDescriptor): boolean {
  if (control.type === "submit" || control.type === "image") return true;
  return control.tagName === "button" && control.insideForm &&
    (control.type === "" || control.type === "submit");
}

function isInteractiveField(control: ControlDescriptor): boolean {
  if (!control.visible || control.disabled || isSubmitControl(control)) return false;
  if (control.tagName === "button") return false;
  return control.type !== "hidden" && control.type !== "reset";
}

function requiredControlIsResolved(
  control: ControlDescriptor,
  controls: readonly ControlDescriptor[],
): boolean {
  if (control.type === "radio") {
    const groupKey = control.name || control.id;
    return groupKey.length > 0 && controls.some((candidate) =>
      candidate.type === "radio" &&
      (candidate.name || candidate.id) === groupKey &&
      candidate.checked
    );
  }
  if (control.type === "checkbox") return control.checked;
  if (control.type === "file") return control.fileCount > 0;
  return control.value.trim().length > 0;
}

const WORK_AUTHORIZATION_AUTOFILL_KEYS = new Set<CandidateFactKey>([
  "work_authorization.us.authorized",
  "work_authorization.us.sponsorship_required",
  "work_authorization.ca.authorized",
  "work_authorization.ca.sponsorship_required",
]);

function classifyWorkAuthorizationFact(control: ControlDescriptor): CandidateFactKey | null {
  const text = descriptorText(control);
  const country = /\b(?:united states|u s)\b/u.test(text)
    ? "us"
    : /\bcanada\b/u.test(text)
      ? "ca"
      : null;
  if (country === null || describesOtherPersonOrPast(text)) return null;
  if (/\b(?:legally )?authori[sz]ed to work\b/u.test(text)) {
    return `work_authorization.${country}.authorized`;
  }
  if (
    /\b(?:sponsor|sponsorship|visa)\b/u.test(text) &&
    /\b(?:need|require|requiring|future)\b/u.test(text)
  ) return `work_authorization.${country}.sponsorship_required`;
  return null;
}

function controlKind(control: ControlDescriptor): string {
  if (control.tagName === "textarea") return "LONG_TEXT";
  if (control.tagName === "select") return control.type === "select-multiple" ? "MULTI_SELECT" : "SINGLE_SELECT";
  if (control.type === "radio") return "SINGLE_SELECT";
  if (control.type === "checkbox") return "BOOLEAN";
  if (control.type === "file") return "FILE";
  return "TEXT";
}

/**
 * Exported for table-driven tests. Work authorization keeps its narrow
 * country/verb rules; every other fact needs the shared anchored label rules.
 * Autocomplete tokens, input types and keywords inside sentences never map.
 */
export function classifyFact(control: ControlDescriptor): CandidateFactKey | null {
  const workAuthorizationFact = classifyWorkAuthorizationFact(control);
  if (workAuthorizationFact !== null) return workAuthorizationFact;
  return classifyFieldFact({
    label: control.label.trim() || control.placeholder.trim() || control.name,
    kind: controlKind(control), inputType: control.type, name: control.name, domId: control.id,
  });
}

function classifyArtifact(control: ControlDescriptor): "RESUME" | "COVER_LETTER" | null {
  if (control.type !== "file") return null;
  const text = descriptorText(control);
  if (/\b(?:resume|résumé|cv|curriculum vitae)\b/iu.test(text)) return "RESUME";
  if (/\bcover letter\b/u.test(text)) return "COVER_LETTER";
  return null;
}

function accepts(acceptValue: string, artifact: MaterializedApplicationArtifact): boolean {
  if (acceptValue.trim() === "") return true;
  const tokens = acceptValue.toLowerCase().split(",").map((value) => value.trim());
  const extension = artifact.filename.toLowerCase().slice(artifact.filename.lastIndexOf("."));
  return tokens.some((token) =>
    token === artifact.mediaType.toLowerCase() || token === extension || token === "*/*"
  );
}

function selectArtifact(
  executionPackage: ApplicationFillExecutionPackage,
  family: "RESUME" | "COVER_LETTER",
  acceptValue: string,
): MaterializedApplicationArtifact | null {
  const candidates = executionPackage.artifacts
    .filter((artifact) => artifact.variant.startsWith(`${family}_`))
    .filter((artifact) => accepts(acceptValue, artifact))
    .sort((left, right) => {
      const leftRank = left.variant.endsWith("_PDF") ? 0 : 1;
      const rightRank = right.variant.endsWith("_PDF") ? 0 : 1;
      return leftRank - rightRank || left.variant.localeCompare(right.variant);
    });
  return candidates[0] ?? null;
}

async function installImmediateDomInterlock(page: Page): Promise<number> {
  return page.evaluate(() => {
    const globalState = globalThis as typeof globalThis & {
      __roledawnBlockedSubmitAttempts?: number;
      __roledawnSubmissionInterlockInstalled?: boolean;
    };
    if (!globalState.__roledawnSubmissionInterlockInstalled) {
      globalState.__roledawnSubmissionInterlockInstalled = true;
      globalState.__roledawnBlockedSubmitAttempts = 0;
      const block = (event?: Event) => {
        event?.preventDefault();
        event?.stopImmediatePropagation();
        globalState.__roledawnBlockedSubmitAttempts =
          (globalState.__roledawnBlockedSubmitAttempts ?? 0) + 1;
        return false;
      };
      globalThis.addEventListener("submit", block, true);
      Object.defineProperty(HTMLFormElement.prototype, "submit", {
        configurable: false,
        writable: false,
        value: function blockedSubmit() {
          return block();
        },
      });
      Object.defineProperty(HTMLFormElement.prototype, "requestSubmit", {
        configurable: false,
        writable: false,
        value: function blockedRequestSubmit() {
          return block();
        },
      });
    }
    const controls = document.querySelectorAll<
      HTMLButtonElement | HTMLInputElement
    >('button[type="submit"], form button:not([type]), input[type="submit"], input[type="image"]');
    for (const control of controls) {
      control.disabled = true;
      control.setAttribute("aria-disabled", "true");
      control.setAttribute("data-roledawn-submit-blocked", "true");
    }
    return controls.length;
  });
}

async function readControls(page: Page): Promise<readonly ControlDescriptor[]> {
  return page.locator("input, select, textarea, button").evaluateAll((elements) =>
    elements.map((element, index) => {
      const input = element as HTMLInputElement;
      // A label wrapping a select or textarea must not absorb its option or
      // default text: "Country" is the question, not every country name.
      const ownText = (node: Element | null | undefined) => {
        if (!node) return "";
        const clone = node.cloneNode(true) as Element;
        clone.querySelectorAll("select, textarea, option, optgroup, datalist, script, style, template").forEach((nested) => nested.remove());
        return clone.textContent ?? "";
      };
      const labels = "labels" in input && input.labels
        ? [...input.labels].map((label) => ownText(label)).join(" ")
        : "";
      const closestLabel = ownText(element.closest("label"));
      const fieldsetLegend = element.closest("fieldset")
        ?.querySelector(":scope > legend")?.textContent ?? "";
      const style = globalThis.getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      const tagName = element.tagName.toLowerCase() as ControlDescriptor["tagName"];
      return {
        index,
        tagName,
        type: "type" in input ? String(input.type ?? "").toLowerCase() : "",
        name: "name" in input ? String(input.name ?? "") : "",
        id: element.id ?? "",
        autocomplete: "autocomplete" in input ? String(input.autocomplete ?? "") : "",
        // A control inside its own <label> reports that text twice; anchored
        // label rules need the visible text once.
        label: [...new Set([fieldsetLegend, labels, closestLabel, element.getAttribute("aria-label") ?? ""]
          .map((text) => text.replace(/\s+/gu, " ").trim()).filter(Boolean))].join(" "),
        optionLabel: closestLabel,
        value: "value" in input ? String(input.value ?? "") : "",
        checked: "checked" in input ? Boolean(input.checked) : false,
        fileCount: "files" in input ? Number(input.files?.length ?? 0) : 0,
        placeholder: "placeholder" in input ? String(input.placeholder ?? "") : "",
        accept: "accept" in input ? String(input.accept ?? "") : "",
        required: ("required" in input ? Boolean(input.required) : false) ||
          element.getAttribute("aria-required")?.toLowerCase() === "true",
        disabled: "disabled" in input ? Boolean(input.disabled) : false,
        visible: input.type !== "hidden" && !element.hasAttribute("hidden") &&
          style.display !== "none" && style.visibility !== "hidden" &&
          bounds.width > 0 && bounds.height > 0,
        insideForm: element.closest("form") !== null,
      };
    })
  );
}

function takeover(reasonCode: string, blockedFieldCount: number): NoSubmitFormOutcome {
  return Object.freeze({
    kind: "TAKEOVER" as const,
    reasonCode,
    readbackHash: null,
    filledFieldCount: 0,
    uploadedArtifactCount: 0,
    blockedFieldCount,
  });
}

async function pageHasCaptcha(page: Page): Promise<boolean> {
  return (await page.locator([
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha"]',
    'iframe[src*="turnstile"]',
    '[class*="captcha" i]',
    '[id*="captcha" i]',
    '[data-sitekey]',
  ].join(", ")).count()) > 0;
}

const SELECT_SEMANTICS: Readonly<Partial<Record<CandidateFactKey, OptionSemantic>>> = Object.freeze({
  "location.country_code": "COUNTRY", "location.region": "REGION", "location.city": "CITY",
});

/** One unique exact option (location facts through fixed aliases), never the first loose match. */
async function chooseSelectOption(locator: Locator, value: string, factKey: CandidateFactKey): Promise<string> {
  const options = await locator.locator("option").evaluateAll((elements) =>
    elements.map((element) => ({
      value: (element as HTMLOptionElement).value,
      label: (element.textContent ?? "").trim(),
      disabled: (element as HTMLOptionElement).disabled,
    }))
  );
  let selected: string;
  try {
    selected = resolveOptionValue(options.filter((option) => !option.disabled && option.value !== ""), value, { semantic: SELECT_SEMANTICS[factKey] ?? null });
  } catch {
    throw new Error("APPLICATION_FILL_SELECT_OPTION_MISSING");
  }
  await locator.selectOption({ value: selected });
  if (await locator.inputValue() !== selected) {
    throw new Error("APPLICATION_FILL_SELECT_OPTION_READBACK_MISMATCH");
  }
  return value;
}

async function fillFact(locator: Locator, control: ControlDescriptor, value: string, factKey: CandidateFactKey): Promise<string> {
  if (control.tagName === "select") return chooseSelectOption(locator, value, factKey);
  if (control.type === "radio") {
    await locator.check();
    if (!await locator.isChecked()) throw new Error("APPLICATION_FILL_RADIO_READBACK_MISMATCH");
    return value;
  }
  if (control.type === "checkbox" || control.type === "file") {
    throw new Error("APPLICATION_FILL_CONTROL_TYPE_UNSUPPORTED");
  }
  await locator.fill(value);
  return locator.inputValue();
}

function assertExecutionBinding(
  startUrl: string,
  inputBinding: ComputerRuntimeProvisionRequest["binding"],
  executionPackage: ApplicationFillExecutionPackage,
): string {
  if (
    executionPackage.authorityScope !== "FILL_ONLY_NO_SUBMIT" ||
    executionPackage.submitAuthorized !== false ||
    executionPackage.destinationUrl !== startUrl ||
    executionPackage.binding.workspaceId !== inputBinding.workspaceId ||
    executionPackage.binding.candidateId !== inputBinding.candidateId ||
    executionPackage.binding.applicationId !== inputBinding.applicationId ||
    executionPackage.binding.revisionId !== inputBinding.revisionId ||
    executionPackage.binding.fillAttemptId !== inputBinding.fillAttemptId ||
    executionPackage.binding.computerSessionId !== inputBinding.computerSessionId
  ) throw new Error("APPLICATION_FILL_DRIVER_BINDING_MISMATCH");
  let parsed: URL;
  try {
    parsed = new URL(startUrl);
  } catch {
    throw new Error("APPLICATION_FILL_DRIVER_DESTINATION_INVALID");
  }
  const isHttps = parsed.protocol === "https:";
  const isSyntheticLoopback = parsed.protocol === "http:" &&
    (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
  if (!isHttps && !isSyntheticLoopback) {
    throw new Error("APPLICATION_FILL_DRIVER_DESTINATION_INVALID");
  }
  return parsed.origin;
}

export function createGreenhouseNoSubmitDriver(
  dependencies: GreenhouseNoSubmitDriverDependencies = {},
): NoSubmitFormDriver {
  const resolvePage = dependencies.resolvePage ?? browserbaseRuntimePage;
  const recordUpload = dependencies.recordUpload ?? recordBrowserbaseRuntimeUpload;
  return Object.freeze({
    driverRelease: GREENHOUSE_NO_SUBMIT_DRIVER_RELEASE,
    async fillToPreSubmitReview(input: NoSubmitDriverInput) {
      if (input.submitAuthorized !== false) throw new Error("APPLICATION_FILL_SUBMISSION_AUTHORITY_INVALID");
      const expectedOrigin = assertExecutionBinding(
        input.startUrl,
        input.binding,
        input.executionPackage,
      );
      const page = resolvePage(input.runtimeHandle);
      let current: URL;
      try {
        current = new URL(page.url());
      } catch {
        throw new Error("APPLICATION_FILL_DRIVER_PAGE_INVALID");
      }
      if (current.origin !== expectedOrigin) throw new Error("APPLICATION_FILL_DRIVER_ORIGIN_MISMATCH");

      await installImmediateDomInterlock(page);
      if (await pageHasCaptcha(page)) return takeover("APPLICATION_FILL_CAPTCHA_TAKEOVER", 1);
      if (LOGIN_PATH_PATTERN.test(current.pathname)) {
        return takeover("APPLICATION_FILL_ACCOUNT_LOGIN_TAKEOVER", 1);
      }

      const controls = await readControls(page);
      const interactive = controls.filter(isInteractiveField);
      if (interactive.some((control) => control.type === "password")) {
        return takeover("APPLICATION_FILL_ACCOUNT_LOGIN_TAKEOVER", 1);
      }
      const otpControls = interactive.filter((control) =>
        normalizeText(control.autocomplete) === "one time code" ||
        OTP_OR_MFA_PATTERN.test(descriptorText(control))
      );
      if (otpControls.length > 0) {
        return takeover("APPLICATION_FILL_OTP_MFA_TAKEOVER", otpControls.length);
      }
      const sensitiveControls = interactive.filter((control) => {
        const factKey = classifyFact(control);
        return !(factKey && WORK_AUTHORIZATION_AUTOFILL_KEYS.has(factKey)) &&
          SENSITIVE_OR_LEGAL_PATTERN.test(descriptorText(control));
      });
      const requiredSensitiveControls = sensitiveControls.filter((control) =>
        control.required && !requiredControlIsResolved(control, interactive)
      );
      if (requiredSensitiveControls.length > 0) {
        return takeover("APPLICATION_FILL_SENSITIVE_LEGAL_TAKEOVER", requiredSensitiveControls.length);
      }
      const blockedOptionalSensitiveIndexes = new Set(
        sensitiveControls.map((control) => control.index),
      );

      const factByKey = new Map(input.executionPackage.facts.map((fact) => [fact.factKey, fact] as const));
      const plan: PlannedFill[] = [];
      const unknownRequired: ControlDescriptor[] = [];
      const missingRequired: ControlDescriptor[] = [];
      const processedRadioGroups = new Set<string>();
      for (const control of interactive) {
        if (blockedOptionalSensitiveIndexes.has(control.index)) continue;
        const artifactFamily = classifyArtifact(control);
        if (artifactFamily !== null) {
          const artifact = selectArtifact(input.executionPackage, artifactFamily, control.accept);
          if (artifact) {
            plan.push(Object.freeze({ kind: "ARTIFACT" as const, control, artifact }));
          } else if (control.required && !requiredControlIsResolved(control, interactive)) {
            missingRequired.push(control);
          }
          continue;
        }
        const factKey = classifyFact(control);
        if (factKey !== null) {
          const fact = factByKey.get(factKey);
          if (control.type === "radio") {
            const groupControlKey = control.name || control.id;
            const groupKey = `${groupControlKey}:${factKey}`;
            if (processedRadioGroups.has(groupKey)) continue;
            processedRadioGroups.add(groupKey);
            const group = interactive.filter((candidate) =>
              candidate.type === "radio" &&
              (candidate.name || candidate.id) === groupControlKey &&
              classifyFact(candidate) === factKey
            );
            if (!fact) {
              if (
                group.some((candidate) => candidate.required) &&
                !requiredControlIsResolved(control, interactive)
              ) missingRequired.push(control);
              continue;
            }
            const normalizedValue = normalizeText(fact.value);
            const matchingControl = group.find((candidate) =>
              normalizeText(candidate.value) === normalizedValue ||
              normalizeText(candidate.optionLabel) === normalizedValue
            );
            if (!matchingControl) {
              if (
                group.some((candidate) => candidate.required) &&
                !requiredControlIsResolved(control, interactive)
              ) missingRequired.push(control);
              continue;
            }
            plan.push(Object.freeze({
              kind: "FACT" as const,
              control: matchingControl,
              factKey,
              value: fact.value,
            }));
            continue;
          }
          if (fact) {
            plan.push(Object.freeze({ kind: "FACT" as const, control, factKey, value: fact.value }));
          } else if (control.required && !requiredControlIsResolved(control, interactive)) {
            missingRequired.push(control);
          }
          continue;
        }
        if (control.required && !requiredControlIsResolved(control, interactive)) {
          unknownRequired.push(control);
        }
      }
      if (unknownRequired.length > 0) {
        return takeover("APPLICATION_FILL_UNKNOWN_REQUIRED_FIELD_TAKEOVER", unknownRequired.length);
      }
      if (missingRequired.length > 0) {
        return takeover("APPLICATION_FILL_REQUIRED_VALUE_MISSING_TAKEOVER", missingRequired.length);
      }
      if (plan.length === 0) {
        return Object.freeze({
          kind: "FAILED_SAFE" as const,
          reasonCode: "APPLICATION_FILL_SUPPORTED_FIELDS_NOT_FOUND",
          readbackHash: null,
          filledFieldCount: 0,
          uploadedArtifactCount: 0,
          blockedFieldCount: 0,
        });
      }

      const allControls = page.locator("input, select, textarea, button");
      const readback: Array<Readonly<Record<string, string | number>>> = [];
      let filledFieldCount = 0;
      let uploadedArtifactCount = 0;
      for (const item of plan) {
        if (new URL(page.url()).origin !== expectedOrigin) {
          throw new Error("APPLICATION_FILL_DRIVER_ORIGIN_CHANGED");
        }
        const locator = allControls.nth(item.control.index);
        if (item.kind === "FACT") {
          const actualValue = await fillFact(locator, item.control, item.value, item.factKey);
          if (actualValue !== item.value) throw new Error("APPLICATION_FILL_FIELD_READBACK_MISMATCH");
          filledFieldCount += 1;
          readback.push(Object.freeze({
            kind: "fact",
            control_index: item.control.index,
            fact_key: item.factKey,
            value: actualValue,
          }));
          continue;
        }
        const temporaryBuffer = Buffer.from(item.artifact.bytes);
        try {
          await locator.setInputFiles({
            name: item.artifact.filename,
            mimeType: item.artifact.mediaType,
            buffer: temporaryBuffer,
          });
        } finally {
          temporaryBuffer.fill(0);
        }
        const file = await locator.evaluate((element) => {
          const selected = (element as HTMLInputElement).files?.[0];
          return selected ? { name: selected.name, size: selected.size, type: selected.type } : null;
        });
        if (
          !file || file.name !== item.artifact.filename ||
          file.size !== item.artifact.byteSize || file.type !== item.artifact.mediaType
        ) throw new Error("APPLICATION_FILL_ARTIFACT_READBACK_MISMATCH");
        recordUpload(input.runtimeHandle, item.artifact.byteSize);
        uploadedArtifactCount += 1;
        readback.push(Object.freeze({
          kind: "artifact",
          control_index: item.control.index,
          artifact_version_id: item.artifact.artifactVersionId,
          variant: item.artifact.variant,
          filename: file.name,
          byte_size: file.size,
          sha256: item.artifact.sha256,
        }));
      }

      const finalUrl = new URL(page.url());
      if (finalUrl.origin !== expectedOrigin) throw new Error("APPLICATION_FILL_DRIVER_ORIGIN_CHANGED");
      const canonicalReadback = Object.freeze({
        schema_release: "greenhouse-fill-readback/1",
        application_id: input.binding.applicationId,
        revision_id: input.binding.revisionId,
        fill_attempt_id: input.binding.fillAttemptId,
        computer_session_id: input.binding.computerSessionId,
        page_url: finalUrl.toString(),
        values: Object.freeze(readback),
      });
      const readbackHash = createHash("sha256")
        .update(JSON.stringify(canonicalReadback), "utf8")
        .digest("hex");
      return Object.freeze({
        kind: "FILLED_TO_REVIEW" as const,
        readbackHash,
        filledFieldCount,
        uploadedArtifactCount,
        blockedFieldCount: blockedOptionalSensitiveIndexes.size,
      });
    },
  });
}
