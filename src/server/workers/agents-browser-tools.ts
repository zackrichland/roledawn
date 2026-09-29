import { createHash } from "node:crypto";

import type { Frame, Page } from "playwright-core";

import { AGENT_QUESTION_LIMITS, validateAgentQuestionDescriptors, type AgentQuestionDescriptor } from "../../domain/application-agent-questions.ts";
import type { MaterializedApplicationArtifact } from "./application-fill-materializer.ts";
import {
  inspectAriaCombobox, inspectRemoteSearchCombobox, searchRemoteComboboxOption, selectAriaComboboxOption,
  type AriaComboboxState, type RemoteSearchComboboxState,
} from "./agents-aria-combobox.ts";
import { chooseSearchResult, MAX_SEARCHABLE_OPTIONS, MODEL_OPTION_SAMPLE, resolveOptionValue, type OptionMatch } from "./agents-option-match.ts";
import { APPLICATION_FILL_CAPTCHA_TAKEOVER, frameShowsCaptchaChallenge, isHcaptchaFrameUrl } from "./agents-captcha.ts";

const CONTROL_SELECTOR = 'input, select, textarea, [role="combobox"], [role="textbox"], [role="checkbox"], [role="radio"]';
// "Ethnicity", "Hispanic/Latino", "Pronouns" and "Veterans" are demographic
// questions too; only their own saved answer or the candidate may fill them.
const PRIVATE_PATTERN = /\b(?:gender|race|racial|ethnic\w*|hispanic|latin[aeox]|veteran\w*|disabilit\w*|sexual orientation|pronouns?|birth|age|citizen\w*|nationality|passport|religio\w*|marital|pregnan\w*|authori[sz]\w*|sponsor\w*|visa|eligible|eligibility|legal\w*|criminal|conviction|background check|certif\w*|attest\w*|signature|consent|terms|privacy|eeo)\b/iu;

export type AgentFieldValue = string | boolean | readonly string[];
export type AgentFieldKind = AgentQuestionDescriptor["kind"] | "FILE" | "UNSUPPORTED";
type RawControl = {
  index: number; tag: string; type: string; role: string; name: string; id: string; label: string; optionLabel: string;
  autocomplete: string; placeholder: string; required: boolean; readOnly: boolean;
  form: string; value: string; checked: boolean; selected: string[];
  valid: boolean; accept: string; multiple: boolean;
  options: { value: string; label: string }[];
  files: { name: string; size: number; type: string }[];
  /** React Select only: the closed control's visible state (selection, placeholder, search text). */
  menuState: string | null;
  aria?: AriaComboboxState;
  remote?: RemoteSearchComboboxState;
};
type MenuRead = Readonly<{ aria: AriaComboboxState | null; remote: RemoteSearchComboboxState | null }>;

export type AgentBrowserField = Readonly<{
  fieldId: string;
  fingerprint: string;
  label: string;
  kind: AgentFieldKind;
  inputType: string;
  name: string;
  domId: string;
  autocomplete: string;
  placeholder: string;
  required: boolean;
  readOnly: boolean;
  candidateOnly: boolean;
  options: readonly Readonly<{ value: string; label: string }>[];
  accept: string;
  multiple: boolean;
  hasValue: boolean;
  valid: boolean;
  /** Number of observed options; `options` is the full list server-side. */
  optionCount: number;
  /**
   * A long list (more than a question can carry) or a type-to-search control.
   * The model sees a sample; the server resolves exact values against the
   * full list or live results, and the candidate is asked in free text.
   */
  searchable: boolean;
}>;

type LocatedField = Readonly<{
  field: AgentBrowserField;
  frame: Frame;
  indexes: readonly number[];
  value: AgentFieldValue;
  files: readonly Readonly<{ name: string; size: number; type: string }>[];
  aria?: AriaComboboxState;
  remote?: boolean;
}>;

export type AgentBrowserSnapshot = Readonly<{
  origin: string;
  pageUrl: string;
  fields: readonly AgentBrowserField[];
  takeoverReason: string | null;
  navigationRequired: boolean;
}>;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const boundedText = (value: string, limit: number) => value.trim().length > 0 && Array.from(value).length <= limit && !CONTROL_CHARACTERS.test(value);
/** The same per-option rules a question applies, for lists too long to ask as choices. */
function assertSearchableOptions(options: readonly Readonly<{ value: string; label: string }>[]): void {
  if (options.length > MAX_SEARCHABLE_OPTIONS || new Set(options.map((option) => option.value)).size !== options.length ||
    options.some((option) => !boundedText(option.value, 500) || !boundedText(option.label, 500))) throw new Error("AGENTS_FILL_OPTIONS_UNREPRESENTABLE");
}

/**
 * Phone widgets (intl-tel-input) reformat what is typed: "+15551230100" reads
 * back as "+1 555-123-0100", or as "(555) 123-0100" once the calling code
 * moves to the widget's country selector. The same digits, or the same digits
 * after a leading 1-3 digit calling code, are the same number; letters,
 * extensions and any other difference are not.
 */
export function samePhoneNumber(actual: string, expected: string): boolean {
  if ([actual, expected].some((value) => !/^[\d\s().+-]+$/u.test(value))) return false;
  const have = actual.replace(/\D/gu, "");
  const want = expected.replace(/\D/gu, "");
  if (have.length < 7 || want.length < 7) return false;
  if (have === want) return true;
  const calling = want.length - have.length;
  return expected.trim().startsWith("+") && !actual.trim().startsWith("+") && calling >= 1 && calling <= 3 && want.endsWith(have);
}

/** What the model sees: long lists become a sample, a count and `searchable`. */
export function modelFieldView(field: AgentBrowserField): AgentBrowserField {
  return field.searchable && field.options.length > MODEL_OPTION_SAMPLE
    ? Object.freeze({ ...field, options: field.options.slice(0, MODEL_OPTION_SAMPLE) }) : field;
}

function kind(control: RawControl): AgentFieldKind {
  if (control.role === "combobox" && control.tag !== "select") return control.aria || control.remote ? "SINGLE_SELECT" : "UNSUPPORTED";
  if (!["input", "select", "textarea"].includes(control.tag)) return "UNSUPPORTED";
  if (control.tag === "textarea") return "LONG_TEXT";
  if (control.tag === "select") return control.options.length ? control.multiple ? "MULTI_SELECT" : "SINGLE_SELECT" : "UNSUPPORTED";
  if (control.type === "file") return "FILE";
  if (control.type === "checkbox") return "BOOLEAN";
  if (control.type === "radio") return "SINGLE_SELECT";
  if (["password", "range", "color"].includes(control.type)) return "UNSUPPORTED";
  return "TEXT";
}

async function rawControls(frame: Frame, leverLabels = false): Promise<RawControl[]> {
  return frame.locator(CONTROL_SELECTOR).evaluateAll((elements, useLeverLabels) => elements.flatMap((element, index) => {
    const native = element as HTMLInputElement;
    const type = String(native.type ?? element.getAttribute("role") ?? "").toLowerCase();
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    if (native.disabled || element.getAttribute("aria-disabled") === "true" || ["hidden", "submit", "reset", "button", "image"].includes(type) ||
      (type !== "file" && (element.closest('[hidden], [aria-hidden="true"]') || style.display === "none" ||
        style.visibility === "hidden" || bounds.width === 0 || bounds.height === 0))) return [];
    // A label wrapping a select or textarea must not absorb its option or
    // default text: "Country" is the question, not every country name.
    const ownText = (node: Element | null | undefined) => {
      if (!node) return "";
      const clone = node.cloneNode(true) as Element;
      clone.querySelectorAll("select, textarea, option, optgroup, datalist, script, style, template").forEach((nested) => nested.remove());
      return clone.textContent ?? "";
    };
    const labelledBy = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/u)
      .map((id) => ownText(document.getElementById(id))).join(" ");
    const labels = [...(native.labels ?? [])].map((label) => ownText(label)).join(" ");
    const legend = element.closest("fieldset")?.querySelector(":scope > legend")?.textContent ?? "";
    const leverHeading = useLeverLabels ? element.closest(".application-field")?.parentElement?.querySelector(":scope > .application-label") : null;
    let uploadHeading = "";
    if (type === "file") {
      let ancestor = element.parentElement;
      for (let depth = 0; ancestor && depth < 7 && ancestor.tagName !== "FORM"; depth += 1, ancestor = ancestor.parentElement) {
        if (ancestor.querySelectorAll('input[type="file"]').length > 1) break;
        const headings = [...ancestor.querySelectorAll(':scope > legend, :scope > label, :scope > h2, :scope > h3, :scope > [class*="label"]')]
          .map((heading) => (heading.textContent ?? "").replace(/\s+/gu, " ").trim())
          .filter((text) => text.length > 0 && text.length <= 160 && !/^(?:attach|upload|choose file|browse)\b/iu.test(text));
        if (headings.length === 1) { uploadHeading = headings[0]; break; }
      }
    }
    const label = leverHeading?.textContent?.replace(/\s+/gu, " ").trim() || [...new Set([legend, uploadHeading, labelledBy, element.getAttribute("aria-label"), labels || ownText(element.closest("label"))]
      .filter(Boolean).map((text) => text!.replace(/\s+/gu, " ").trim()))].join(" ");
    const form = native.form;
    const options = element instanceof HTMLSelectElement
      ? [...element.options].filter((option) => !option.disabled && option.value.trim() !== "").map((option) => ({ value: option.value, label: option.text.trim() }))
      : [];
    return [{
      index, tag: element.tagName.toLowerCase(), type, role: element.getAttribute("role") ?? "", name: native.name ?? "", id: element.id,
      label: label || native.placeholder || native.name || element.id || "Unlabelled field",
      optionLabel: [labelledBy, element.getAttribute("aria-label"), labels || ownText(element.closest("label"))]
        .filter(Boolean).join(" ").replace(/\s+/gu, " ").trim(),
      autocomplete: native.autocomplete ?? "", placeholder: native.placeholder ?? "",
      required: Boolean(native.required) || element.getAttribute("aria-required") === "true" || Boolean(leverHeading?.querySelector(".required")) || type === "file" && Boolean(element.closest('.file-upload[aria-required="true"]')),
      readOnly: (Boolean(native.readOnly) && element.getAttribute("role") !== "combobox") || element.getAttribute("aria-readonly") === "true",
      form: form ? JSON.stringify([form.id, form.getAttribute("name"), form.getAttribute("action"), form.method]) : "outside-form",
      value: native.value ?? "", checked: Boolean(native.checked),
      selected: element instanceof HTMLSelectElement ? [...element.selectedOptions].map((option) => option.value) : [],
      valid: element.getAttribute("aria-invalid") !== "true" && (native.validity ? native.validity.valid : false), accept: native.accept ?? "", multiple: Boolean(native.multiple),
      options, files: native.files ? [...native.files].map((file) => ({ name: file.name, size: file.size, type: file.type })) : [],
      menuState: (() => {
        const shell = element.getAttribute("role") === "combobox" && element.getAttribute("aria-expanded") === "false" ? element.closest(".select-shell") : null;
        if (!shell || shell.querySelectorAll('[role="combobox"]').length !== 1) return null;
        return JSON.stringify([native.value ?? "", element.getAttribute("aria-haspopup"), element.getAttribute("aria-invalid"),
          [...shell.querySelectorAll(".select__single-value, .select__multi-value, .select__placeholder")]
            .map((node) => `${node.className}:${(node.textContent ?? "").replace(/\s+/gu, " ").trim()}`)]);
      })(),
    }];
  }), leverLabels);
}

/** Fixed browser operations only. No model-supplied script, selector, URL or click. */
export function createAgentBrowserTools(page: Page, destinationUrl: string, options?: Readonly<{
  permittedPassiveFrameUrls?: readonly string[]; allowReactSelectDisplay?: boolean; leverLabels?: boolean;
  /** Only when the delivery policy permits the page's own search lookups. */
  remoteSearch?: boolean;
  /**
   * The site's invisible hCaptcha only scores the browser on submit. Continue
   * while nothing asks the person to act; any visible challenge, checkbox
   * widget, prompt or other CAPTCHA provider still hands over. Never solved.
   */
  invisibleHcaptcha?: boolean;
}>) {
  const destination = new URL(destinationUrl);
  if (destination.username || destination.password || (destination.protocol !== "https:" &&
    !(destination.protocol === "http:" && ["localhost", "127.0.0.1"].includes(destination.hostname)))) {
    throw new Error("AGENTS_FILL_DESTINATION_INVALID");
  }
  const expectedOrigin = destination.origin;
  // Reading a React Select menu means opening it: about a dozen browser round
  // trips per control, on every inspection. A closed menu whose visible state
  // and surrounding form are unchanged keeps its last verified read. Any
  // selection, search text or form change re-reads it, and a selection always
  // re-reads the live menu before clicking (a changed list is drift).
  const menuReads = new Map<string, Readonly<{ structure: string; reads: Map<string, MenuRead> }>>();
  let latest = new Map<string, LocatedField>();
  const writes = new Map<string, Readonly<{ value?: AgentFieldValue; artifact?: MaterializedApplicationArtifact; phone?: boolean }>>();
  const readsBack = (actual: AgentFieldValue, expected: AgentFieldValue, phone: boolean) => hash(actual) === hash(expected) ||
    phone && typeof actual === "string" && typeof expected === "string" && samePhoneNumber(actual, expected);
  let initialValues: Map<string, string> | null = null;

  function assertOrigin() {
    if (new URL(page.url()).origin !== expectedOrigin) throw new Error("AGENTS_FILL_ORIGIN_MISMATCH");
  }

  async function inspect(signal?: AbortSignal): Promise<AgentBrowserSnapshot> {
    if (signal?.aborted) throw new Error("AGENTS_FILL_CANCELLED");
    assertOrigin();
    const next = new Map<string, LocatedField>();
    let takeoverReason: string | null = null;
    let navigationRequired = false;
    for (const [frameIndex, frame] of page.frames().entries()) {
      if (frame.url() !== "about:blank" && new URL(frame.url()).origin !== expectedOrigin) {
        if (options?.permittedPassiveFrameUrls?.includes(frame.url())) continue;
        // hCaptcha's own documents are judged by their iframe's visibility below.
        if (options?.invisibleHcaptcha && isHcaptchaFrameUrl(frame.url())) continue;
        if (/captcha|turnstile/iu.test(frame.url())) takeoverReason = APPLICATION_FILL_CAPTCHA_TAKEOVER;
        else takeoverReason ??= "AGENTS_FILL_CROSS_ORIGIN_FRAME_TAKEOVER";
        continue;
      }
      if (options?.invisibleHcaptcha) {
        const foreignCaptcha = await frame.locator('iframe[src*="captcha"], iframe[src*="turnstile"], [data-sitekey]').evaluateAll((elements) => elements.some((element) =>
          element instanceof HTMLIFrameElement
            ? !/^https:\/\/newassets\.hcaptcha\.com\/captcha\/v1\/[A-Za-z0-9._-]{1,80}\/static\/hcaptcha\.html(?:[?#]|$)/u.test(element.src)
            : element.classList.contains("g-recaptcha") || element.classList.contains("cf-turnstile")));
        if (foreignCaptcha || await frameShowsCaptchaChallenge(frame)) takeoverReason = APPLICATION_FILL_CAPTCHA_TAKEOVER;
      } else if (await frame.locator('iframe[src*="captcha"], iframe[src*="turnstile"], [data-sitekey]').evaluateAll((elements, permitted) =>
        elements.some((element) => !(element instanceof HTMLIFrameElement) || !permitted.includes(element.src)), [...options?.permittedPassiveFrameUrls ?? []])) {
        takeoverReason = APPLICATION_FILL_CAPTCHA_TAKEOVER;
      }
      navigationRequired ||= await frame.locator("button, input[type=button], a[role=button]").evaluateAll((elements) =>
        elements.some((element) => {
          const bounds = element.getBoundingClientRect();
          return bounds.width > 0 && bounds.height > 0 &&
            /^(?:next|continue|save and continue|next step)\b/iu.test((element.textContent || (element as HTMLInputElement).value || "").trim());
        }));
      const controls = await rawControls(frame, options?.leverLabels);
      const containsIdentityGate = controls.some((control) => control.type === "password" || control.autocomplete === "one-time-code");
      const structure = hash(controls.map((control) => [control.tag, control.type, control.role, control.id, control.name, control.label, control.required, control.form]));
      const frameKey = `${frameIndex}:${frame.url()}`;
      if (menuReads.get(frameKey)?.structure !== structure) menuReads.set(frameKey, { structure, reads: new Map() });
      const reads = menuReads.get(frameKey)!.reads;
      if (!takeoverReason && !containsIdentityGate) {
        for (const control of controls) {
          if (control.role !== "combobox" || control.tag === "select" || control.readOnly) continue;
          const readKey = options?.allowReactSelectDisplay && control.menuState !== null ? `${control.index}:${control.id}:${control.menuState}` : null;
          let read = readKey ? reads.get(readKey) : undefined;
          if (!read) {
            const aria = await inspectAriaCombobox(frame, frame.locator(CONTROL_SELECTOR).nth(control.index), signal, options);
            read = { aria, remote: aria ? null : await inspectRemoteSearchCombobox(frame, frame.locator(CONTROL_SELECTOR).nth(control.index), signal, options) };
            if (readKey) reads.set(readKey, read);
          }
          const state = read.aria;
          if (state) {
            control.aria = state;
            control.options = state.options.map(({ value, label }) => ({ value, label }));
            control.value = state.selectedValue ?? "";
            control.valid = !control.required || state.selectedValue !== null;
          } else {
            // Search-only menus: the selected display is the value, never search text.
            const remote = read.remote;
            if (remote) {
              control.remote = remote;
              control.options = [];
              control.value = remote.selectedLabel;
              control.valid = !control.required || remote.selectedLabel.length > 0;
            }
          }
        }
      }
      const consumed = new Set<number>();
      const occurrences = new Map<string, number>();
      for (const control of controls) {
        if (consumed.has(control.index)) continue;
        if (control.type === "password") takeoverReason = "APPLICATION_FILL_ACCOUNT_LOGIN_TAKEOVER";
        if (control.autocomplete === "one-time-code" || /\b(?:otp|mfa|verification code|security code|one[ -]time)\b/iu.test(control.label)) {
          takeoverReason = "APPLICATION_FILL_OTP_MFA_TAKEOVER";
        }
        const grouped = (control.type === "radio" || control.type === "checkbox") && control.name
          ? controls.filter((other) => other.type === control.type && other.name === control.name && other.form === control.form)
          : [control];
        const group = control.type === "radio" || grouped.length > 1 ? grouped : [control];
        group.forEach((item) => consumed.add(item.index));
        const fieldKind = control.type === "checkbox" && group.length > 1 ? "MULTI_SELECT" : kind(control);
        const options = control.type === "radio" || (control.type === "checkbox" && group.length > 1)
          ? group.map((item) => ({ value: item.value, label: item.optionLabel || item.label })) : control.options;
        const label = group.length > 1 ? [...new Set(group.map((item) => item.label))].join(" / ") : control.label;
        const descriptor = {
          frameIndex, frameUrl: frame.url(), form: control.form, tag: control.tag, type: control.type, role: control.role,
          name: control.name, id: control.id, label, autocomplete: control.autocomplete,
          placeholder: control.placeholder, required: group.some((item) => item.required),
          readOnly: group.some((item) => item.readOnly), kind: fieldKind, options,
          accept: control.accept, multiple: control.multiple,
          aria: control.aria ? { listboxId: control.aria.listboxId, options: control.aria.options } : null,
          // Present only for search-only controls so existing fingerprints are unchanged.
          ...(control.remote ? { remoteSearch: true } : {}),
        };
        const descriptorHash = hash(descriptor);
        const occurrence = occurrences.get(descriptorHash) ?? 0;
        occurrences.set(descriptorHash, occurrence + 1);
        const fingerprint = hash({ ...descriptor, occurrence });
        const value: AgentFieldValue = control.type === "radio"
          ? group.find((item) => item.checked)?.value ?? ""
          : control.type === "checkbox" && group.length > 1
            ? group.filter((item) => item.checked).map((item) => item.value).sort()
            : control.type === "checkbox" ? control.checked
              : fieldKind === "MULTI_SELECT" ? [...control.selected].sort() : control.value;
        const hasValue = fieldKind === "FILE" ? control.files.length > 0
          : typeof value === "boolean" ? value : typeof value === "string" ? value.trim().length > 0 : value.length > 0;
        // A single native select or rendered listbox longer than a question can
        // carry is resolved server-side and asked as free text. Radio and
        // multi-select groups keep the question limit.
        const longList = fieldKind === "SINGLE_SELECT" && group.length === 1 && (control.tag === "select" || Boolean(control.aria)) &&
          options.length > AGENT_QUESTION_LIMITS.options;
        let field: AgentBrowserField = Object.freeze({
          fieldId: `field_${fingerprint}`, fingerprint, label, kind: fieldKind, inputType: control.type,
          name: control.name, domId: control.id, autocomplete: control.autocomplete, placeholder: control.placeholder,
          required: descriptor.required, readOnly: descriptor.readOnly,
          candidateOnly: PRIVATE_PATTERN.test(`${label} ${control.name}`), options, accept: control.accept,
          multiple: control.multiple, hasValue,
          valid: control.type === "radio" ? hasValue : group.every((item) => item.valid),
          optionCount: options.length, searchable: longList || Boolean(control.remote),
        });
        if (field.kind !== "FILE" && field.kind !== "UNSUPPORTED") {
          try {
            validateAgentQuestionDescriptors([{
              fieldId: field.fieldId, fingerprint, label, kind: field.searchable ? "TEXT" : field.kind,
              required: field.required, options: field.searchable ? [] : options, reasonCode: "MISSING_EXACT_ANSWER",
            }]);
            if (longList) assertSearchableOptions(options);
          } catch {
            // An unrepresentable question must not abort unrelated known fills
            // or count as a completed required control, even if it has a value.
            field = Object.freeze({ ...field, kind: "UNSUPPORTED", searchable: false });
          }
        }
        next.set(field.fieldId, { field, frame, indexes: group.map((item) => item.index), value, files: control.files, aria: control.aria, remote: Boolean(control.remote) });
      }
    }
    if (/\/(?:login|log-in|signin|sign-in|account)(?:\/|$)/iu.test(new URL(page.url()).pathname)) {
      takeoverReason = "APPLICATION_FILL_ACCOUNT_LOGIN_TAKEOVER";
    }
    latest = next;
    initialValues ??= new Map([...next].filter(([, item]) => item.field.hasValue)
      .map(([id, item]) => [id, hash({ value: item.value, files: item.files })]));
    return Object.freeze({ origin: expectedOrigin, pageUrl: page.url(), fields: [...next.values()].map((item) => item.field), takeoverReason, navigationRequired });
  }

  async function locate(fieldId: string, signal?: AbortSignal): Promise<LocatedField> {
    const before = latest.get(fieldId);
    if (!before) throw new Error("AGENTS_FILL_FIELD_UNKNOWN");
    const snapshot = await inspect(signal);
    if (snapshot.takeoverReason) throw new Error(snapshot.takeoverReason);
    const current = latest.get(fieldId);
    if (!current || current.field.fingerprint !== before.field.fingerprint) throw new Error("AGENTS_FILL_FIELD_DRIFT");
    if (current.field.readOnly || (current.field.hasValue && !writes.has(fieldId))) {
      throw new Error("AGENTS_FILL_CANDIDATE_VALUE_PRESERVED");
    }
    return current;
  }

  function optionValue(field: AgentBrowserField, answer: string, match?: OptionMatch): string {
    // Exact normalized equality against the FULL option list, never "closest".
    return resolveOptionValue(field.options, answer, match);
  }

  /**
   * `match` carries the location semantics of an approved fact (or of the
   * field's own anchored label for a candidate answer). It widens exact
   * matching to fixed aliases ("US" and "United States of America") only.
   */
  async function fillValue(fieldId: string, answer: AgentFieldValue, signal?: AbortSignal, match?: OptionMatch): Promise<void> {
    const located = await locate(fieldId, signal);
    const { field, frame, indexes } = located;
    const controls = frame.locator(CONTROL_SELECTOR);
    if (signal?.aborted) throw new Error("AGENTS_FILL_CANCELLED");
    let expected: AgentFieldValue;
    if (field.kind === "TEXT" || field.kind === "LONG_TEXT") {
      if (typeof answer !== "string" || answer.length > 8_000) throw new Error("AGENTS_FILL_ANSWER_TYPE_INVALID");
      expected = answer;
      await controls.nth(indexes[0]).fill(answer, { timeout: 5_000 });
    } else if (field.kind === "BOOLEAN") {
      if (typeof answer !== "boolean") throw new Error("AGENTS_FILL_ANSWER_TYPE_INVALID");
      expected = answer;
      await controls.nth(indexes[0]).setChecked(answer, { timeout: 5_000 });
    } else if (field.kind === "SINGLE_SELECT" && located.remote) {
      if (typeof answer !== "string") throw new Error("AGENTS_FILL_ANSWER_TYPE_INVALID");
      // Type the approved value; select only a result that equals it or starts
      // with it and is confirmed by the candidate's own region/country facts.
      expected = await searchRemoteComboboxOption(frame, controls.nth(indexes[0]), answer, (labels) => chooseSearchResult(labels, answer, match), signal, options);
    } else if (field.kind === "SINGLE_SELECT") {
      if (typeof answer !== "string") throw new Error("AGENTS_FILL_ANSWER_TYPE_INVALID");
      expected = optionValue(field, answer, match);
      if (located.aria) {
        await selectAriaComboboxOption(frame, controls.nth(indexes[0]), located.aria, expected, signal, options);
      } else if (field.inputType === "radio") {
        const optionIndex = field.options.findIndex((option) => option.value === expected);
        await controls.nth(indexes[optionIndex]).check({ timeout: 5_000 });
      } else await controls.nth(indexes[0]).selectOption(expected, { timeout: 5_000 });
    } else if (field.kind === "MULTI_SELECT") {
      if (!Array.isArray(answer) || answer.some((value) => typeof value !== "string")) throw new Error("AGENTS_FILL_ANSWER_TYPE_INVALID");
      expected = [...new Set(answer.map((value) => optionValue(field, value)))].sort();
      if (field.inputType === "checkbox") {
        for (const [index, option] of field.options.entries()) {
          if (signal?.aborted) throw new Error("AGENTS_FILL_CANCELLED");
          await controls.nth(indexes[index]).setChecked(expected.includes(option.value), { timeout: 5_000 });
        }
      } else await controls.nth(indexes[0]).selectOption([...expected], { timeout: 5_000 });
    } else throw new Error("AGENTS_FILL_CONTROL_UNSUPPORTED");
    writes.set(fieldId, { value: expected, phone: field.kind === "TEXT" && field.inputType === "tel" });
    await verifyWrites(signal);
  }

  async function upload(fieldId: string, artifact: MaterializedApplicationArtifact, signal?: AbortSignal): Promise<void> {
    const { field, frame, indexes } = await locate(fieldId, signal);
    if (field.kind !== "FILE") throw new Error("AGENTS_FILL_CONTROL_UNSUPPORTED");
    const accepted = field.accept.toLowerCase().split(",").map((value) => value.trim()).filter(Boolean);
    const extension = artifact.filename.toLowerCase().slice(artifact.filename.lastIndexOf("."));
    if (accepted.length && !accepted.some((token) => token === artifact.mediaType || token === extension || token === "*/*")) {
      throw new Error("AGENTS_FILL_ARTIFACT_TYPE_UNSUPPORTED");
    }
    if (artifact.bytes.byteLength !== artifact.byteSize || createHash("sha256").update(artifact.bytes).digest("hex") !== artifact.sha256) {
      throw new Error("AGENTS_FILL_ARTIFACT_HASH_MISMATCH");
    }
    const temporary = Buffer.from(artifact.bytes);
    try {
      if (signal?.aborted) throw new Error("AGENTS_FILL_CANCELLED");
      await frame.locator(CONTROL_SELECTOR).nth(indexes[0]).setInputFiles({ name: artifact.filename, mimeType: artifact.mediaType, buffer: temporary }, { timeout: 5_000 });
    } finally { temporary.fill(0); }
    writes.set(fieldId, { artifact });
    await verifyWrites(signal);
  }

  async function verifyWrites(signal?: AbortSignal): Promise<AgentBrowserSnapshot> {
    const snapshot = await inspect(signal);
    for (const [id, priorHash] of initialValues ?? []) {
      const current = latest.get(id);
      if (!current || hash({ value: current.value, files: current.files }) !== priorHash) throw new Error("AGENTS_FILL_CANDIDATE_VALUE_CHANGED");
    }
    for (const [id, expected] of writes) {
      const current = latest.get(id);
      if (!current) throw new Error("AGENTS_FILL_FIELD_DRIFT");
      if (expected.value !== undefined && !readsBack(current.value, expected.value, Boolean(expected.phone))) throw new Error("AGENTS_FILL_READBACK_MISMATCH");
      if (expected.artifact) {
        const artifact = expected.artifact;
        const selected = current.files;
        if (selected.length !== 1 || selected[0].name !== artifact.filename || selected[0].size !== artifact.byteSize || selected[0].type !== artifact.mediaType) {
          throw new Error("AGENTS_FILL_ARTIFACT_READBACK_MISMATCH");
        }
        const actualHash = await current.frame.locator(CONTROL_SELECTOR).nth(current.indexes[0]).evaluate(async (element) => {
          const file = (element as HTMLInputElement).files?.[0];
          if (!file) return null;
          const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
          return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
        });
        if (actualHash !== artifact.sha256) throw new Error("AGENTS_FILL_ARTIFACT_READBACK_MISMATCH");
      }
    }
    assertOrigin();
    return snapshot;
  }

  return Object.freeze({
    inspect, fillValue, upload, verifyWrites,
    async verifyValue(fieldId: string, answer: AgentFieldValue, signal?: AbortSignal, match?: OptionMatch): Promise<boolean> {
      const prior = latest.get(fieldId);
      if (!prior) return false;
      await inspect(signal);
      const current = latest.get(fieldId);
      if (!current || current.field.fingerprint !== prior.field.fingerprint) throw new Error("AGENTS_FILL_FIELD_DRIFT");
      let expected: AgentFieldValue = answer;
      try {
        if (current.field.kind === "SINGLE_SELECT" && current.remote) {
          if (typeof answer !== "string" || typeof current.value !== "string" || !current.value) return false;
          expected = chooseSearchResult([current.value], answer, match) ?? "";
        } else if (current.field.kind === "SINGLE_SELECT") {
          if (typeof answer !== "string") return false;
          expected = optionValue(current.field, answer, match);
        } else if (current.field.kind === "MULTI_SELECT") {
          if (!Array.isArray(answer)) return false;
          expected = [...new Set(answer.map((value) => optionValue(current.field, value)))].sort();
        } else if (current.field.kind === "FILE" || current.field.kind === "UNSUPPORTED") return false;
      } catch (error) {
        // No unique exact option: the existing value is simply not verified.
        if (error instanceof Error && error.message === "AGENTS_FILL_OPTION_AMBIGUOUS") return false;
        throw error;
      }
      return readsBack(current.value, expected, current.field.kind === "TEXT" && current.field.inputType === "tel");
    },
    hasWritten: (fieldId: string) => writes.has(fieldId),
    async verifyFileSelections(artifacts: readonly MaterializedApplicationArtifact[]) {
      for (const current of latest.values()) {
        if (current.field.kind !== "FILE" || !current.field.hasValue) continue;
        if (current.files.length !== 1) throw new Error("AGENTS_FILL_ARTIFACT_NOT_AUTHORIZED");
        const selected = current.files[0];
        const candidates = artifacts.filter((artifact) => artifact.filename === selected.name && artifact.byteSize === selected.size && artifact.mediaType === selected.type);
        const actualHash = await current.frame.locator(CONTROL_SELECTOR).nth(current.indexes[0]).evaluate(async (element) => {
          const file = (element as HTMLInputElement).files?.[0];
          if (!file) return null;
          const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
          return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
        });
        if (!candidates.some((artifact) => artifact.sha256 === actualHash)) throw new Error("AGENTS_FILL_ARTIFACT_NOT_AUTHORIZED");
      }
      assertOrigin();
    },
    counts: () => ({ filledFieldCount: [...writes.values()].filter((value) => value.value !== undefined).length, uploadedArtifactCount: [...writes.values()].filter((value) => value.artifact).length }),
    readbackHash: () => hash({ pageUrl: page.url(), fields: [...latest].map(([id, item]) => ({ fieldId: id, value: item.value, files: item.files })) }),
  });
}

/** Defense in depth; the runtime adapter must independently block submission egress. */
export async function installAgentDomSubmitInterlock(page: Page): Promise<void> {
  for (const frame of page.frames()) {
    await frame.evaluate(() => {
      const state = globalThis as typeof globalThis & { __roledawnAgentSubmitBlocked?: boolean };
      if (state.__roledawnAgentSubmitBlocked) return;
      state.__roledawnAgentSubmitBlocked = true;
      document.addEventListener("submit", (event) => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
      document.addEventListener("click", (event) => {
        const element = event.target instanceof Element ? event.target.closest('button, input[type="submit"], input[type="image"]') : null;
        if (element && (element.closest("form") || /submit|apply|send/iu.test(element.textContent ?? ""))) {
          event.preventDefault(); event.stopImmediatePropagation();
        }
      }, true);
      for (const name of ["submit", "requestSubmit"] as const) {
        if (Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, name)?.configurable !== false) {
          Object.defineProperty(HTMLFormElement.prototype, name, { configurable: false, writable: false, value() {} });
        }
      }
    });
  }
}
