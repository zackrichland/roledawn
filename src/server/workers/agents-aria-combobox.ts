import type { Frame, Locator } from "playwright-core";

import { MAX_SEARCHABLE_OPTIONS } from "./agents-option-match.ts";

// Brackets appear in Greenhouse multi-select ids ("question_123[]"). Quotes and
// backslashes never do, so a quoted attribute selector stays injection-free.
const SAFE_DOM_ID = /^[A-Za-z0-9][A-Za-z0-9_:.[\]-]{0,255}$/u;
export type AriaComboboxState = Readonly<{
  listboxId: string;
  options: readonly Readonly<{ optionId: string; value: string; label: string }>[];
  selectedValue: string | null;
  /**
   * React Select multi-selects: options are identified by label (the library
   * re-numbers option ids as choices move into chips), and the chosen labels
   * are read back from the chips.
   */
  multiple?: true;
  selectedLabels?: readonly string[];
}>;
export type AriaComboboxOptions = Readonly<{ allowReactSelectDisplay?: boolean; remoteSearch?: boolean }>;
/** A React Select whose options come only from typed search text. */
export type RemoteSearchComboboxState = Readonly<{ selectedLabel: string }>;

function assertActive(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("AGENTS_FILL_CANCELLED");
}

async function openMenu(frame: Frame, control: Locator, signal?: AbortSignal, options?: AriaComboboxOptions): Promise<Readonly<{ menu: Locator; listboxId: string; wasExpanded: boolean }> | null> {
  assertActive(signal);
  if (await control.count() !== 1) return null;
  const before = await control.evaluate((element) => ({
    role: element.getAttribute("role"), popup: element.getAttribute("aria-haspopup"),
    expanded: element.getAttribute("aria-expanded"),
    searchText: element instanceof HTMLInputElement ? element.value : "",
    disabled: element.getAttribute("aria-disabled") === "true" || (element instanceof HTMLInputElement && element.disabled),
  }));
  if (before.role !== "combobox" || before.disabled || before.searchText.trim() ||
    (before.popup && before.popup !== "listbox" && !(options?.allowReactSelectDisplay && before.popup === "true")) || !["true", "false"].includes(before.expanded ?? "")) return null;
  const wasExpanded = before.expanded === "true";
  if (!wasExpanded) {
    assertActive(signal);
    // A fixed field-scoped key opens only the observed combobox. Never Enter,
    // Tab, a model-provided key, or a form/navigation button.
    await control.press("ArrowDown", { timeout: 1_000 });
  }
  const declaration = await control.evaluate((element) => ({
    expanded: element.getAttribute("aria-expanded"),
    controlled: element.getAttribute("aria-controls") || element.getAttribute("aria-owns") || "",
  }));
  if (declaration.expanded !== "true" || !SAFE_DOM_ID.test(declaration.controlled)) return null;
  const menu = frame.locator(`[role="listbox"][id="${declaration.controlled}"]`);
  if (await menu.count() !== 1 || !await menu.isVisible()) return null;
  return { menu, listboxId: declaration.controlled, wasExpanded };
}

async function closeMenu(control: Locator, wasExpanded: boolean): Promise<void> {
  if (!wasExpanded && await control.getAttribute("aria-expanded") === "true") {
    await control.press("Escape", { timeout: 1_000 });
    if (await control.getAttribute("aria-expanded") === "true") throw new Error("AGENTS_FILL_COMBOBOX_CLOSE_FAILED");
  }
}

async function readMenu(menu: Locator, listboxId: string, control: Locator, options?: AriaComboboxOptions): Promise<AriaComboboxState | null> {
  const react = options?.allowReactSelectDisplay ? await control.evaluate((element) => {
    const shell = element.closest(".select-shell");
    if (!shell || shell.querySelectorAll('[role="combobox"]').length !== 1 || !element.closest(".select__control")) return null;
    const multi = Boolean(shell.querySelector(".select__value-container--is-multi"));
    const values = [...shell.querySelectorAll(".select__single-value")];
    if (values.length > 1 || multi && values.length > 0) return null;
    const chips = multi ? [...shell.querySelectorAll(".select__multi-value__label")].map((node) => (node.textContent ?? "").replace(/\s+/gu, " ").trim()) : [];
    return { listboxId: `react-select-${element.id}-listbox`, optionPrefix: `react-select-${element.id}-option-`, selectedLabel: (values[0]?.textContent ?? "").replace(/\s+/gu, " ").trim(), multi, chips };
  }) : null;
  const allowMultiple = Boolean(react?.multi && react.listboxId === listboxId);
  const raw = await menu.evaluate((element, multiAllowed) => {
    if (element.getAttribute("aria-busy") === "true" || (element.getAttribute("aria-multiselectable") === "true" && !multiAllowed)) return null;
    const options = [...element.querySelectorAll('[role="option"]')];
    return options.map((option) => ({
      optionId: option.id, value: option.getAttribute("data-value") ?? option.getAttribute("value") ?? option.id,
      label: (option.getAttribute("aria-label") || option.textContent || "").replace(/\s+/gu, " ").trim(),
      selected: option.getAttribute("aria-selected"), disabled: option.getAttribute("aria-disabled") === "true",
      reactSelected: option.classList.contains("select__option--is-selected"),
      visible: getComputedStyle(option).display !== "none" && getComputedStyle(option).visibility !== "hidden",
      dangerous: ["BUTTON", "INPUT", "A", "FORM"].includes(option.tagName) || Boolean(option.querySelector("button, input, a[href], form")),
      setSize: option.getAttribute("aria-setsize"),
    }));
  }, allowMultiple);
  if (allowMultiple && react) return multiState(raw, listboxId, react.optionPrefix, react.chips);
  const reactMode = Boolean(react && react.listboxId === listboxId && raw?.every((option) => option.selected === null && option.optionId.startsWith(react.optionPrefix)));
  // Long static lists (countries, states, schools) are supported when every
  // option is rendered; a virtualized list fails the set-size check below.
  if (!raw || raw.length < 1 || raw.length > MAX_SEARCHABLE_OPTIONS || raw.some((option) =>
    !SAFE_DOM_ID.test(option.optionId) || !option.value || option.value.length > 1_000 ||
    !option.label || option.label.length > 1_000 || option.dangerous ||
    (!reactMode && !["true", "false"].includes(option.selected ?? "")) ||
    (option.setSize !== null && Number(option.setSize) !== raw.length)
  )) return null;
  const enabled = raw.filter((option) => !option.disabled && option.visible);
  if (enabled.length < 1 || new Set(enabled.map((option) => option.optionId)).size !== enabled.length ||
    new Set(enabled.map((option) => option.value)).size !== enabled.length) return null;
  const selected = enabled.filter((option) => reactMode ? option.reactSelected : option.selected === "true");
  if (selected.length > 1) return null;
  if (reactMode && (selected.length === 0 ? Boolean(react!.selectedLabel) : selected[0].label !== react!.selectedLabel || enabled.filter((option) => option.label === react!.selectedLabel).length !== 1)) return null;
  return Object.freeze({ listboxId, options: enabled.map(({ optionId, value, label }) => ({ optionId, value, label })), selectedValue: selected[0]?.value ?? null });
}

type RawOption = Readonly<{ optionId: string; value: string; label: string; selected: string | null; disabled: boolean; reactSelected: boolean; visible: boolean; dangerous: boolean; setSize: string | null }>;

/**
 * A React Select multi-select. Chosen options usually leave the menu and become
 * chips, and the library re-numbers the remaining option ids, so an option is
 * identified by its label: the stable option list is the menu plus the chips.
 */
function multiState(raw: readonly RawOption[] | null, listboxId: string, optionPrefix: string, chips: readonly string[]): AriaComboboxState | null {
  // React Select sets aria-selected on options everywhere except Apple
  // platforms, so a hosted Linux browser sees "false" where a Mac sees nothing.
  // A "true" option must already be a chip.
  if (!raw || raw.length > MAX_SEARCHABLE_OPTIONS || chips.some((label) => !label || label.length > 1_000) || new Set(chips).size !== chips.length ||
    raw.some((option) => !SAFE_DOM_ID.test(option.optionId) || !option.optionId.startsWith(optionPrefix) ||
      !(option.selected === null || option.selected === "false" || option.selected === "true" && chips.includes(option.label)) ||
      !option.label || option.label.length > 1_000 || option.dangerous)) return null;
  const rendered = raw.filter((option) => !option.disabled && option.visible).map((option) => option.label);
  if (new Set(rendered).size !== rendered.length) return null;
  const labels = [...new Set([...rendered, ...chips])].sort((left, right) => left.localeCompare(right));
  if (labels.length < 1) return null;
  return Object.freeze({
    listboxId, options: labels.map((label) => ({ optionId: "", value: label, label })),
    selectedValue: null, multiple: true, selectedLabels: Object.freeze([...chips].sort((left, right) => left.localeCompare(right))),
  });
}

/** Missing, filtered, remote, virtualized or unverified menus remain unsupported. */
export async function inspectAriaCombobox(frame: Frame, control: Locator, signal?: AbortSignal, options?: AriaComboboxOptions): Promise<AriaComboboxState | null> {
  let opened: Awaited<ReturnType<typeof openMenu>> = null;
  const wasExpanded = await control.getAttribute("aria-expanded") === "true";
  try {
    opened = await openMenu(frame, control, signal, options);
    return opened ? await readMenu(opened.menu, opened.listboxId, control, options) : null;
  } finally {
    await closeMenu(control, opened?.wasExpanded ?? wasExpanded);
  }
}

export async function selectAriaComboboxOption(
  frame: Frame, control: Locator, expected: AriaComboboxState, value: string, signal?: AbortSignal,
  options?: AriaComboboxOptions,
): Promise<void> {
  let opened: Awaited<ReturnType<typeof openMenu>> = null;
  try {
    opened = await openMenu(frame, control, signal, options);
    if (!opened) throw new Error("AGENTS_FILL_COMBOBOX_UNAVAILABLE");
    const current = await readMenu(opened.menu, opened.listboxId, control, options);
    if (!current || current.listboxId !== expected.listboxId || JSON.stringify(current.options) !== JSON.stringify(expected.options)) {
      throw new Error("AGENTS_FILL_FIELD_DRIFT");
    }
    const option = current.options.find((item) => item.value === value);
    if (!option) throw new Error("AGENTS_FILL_OPTION_NOT_OBSERVED");
    const locator = opened.menu.locator(`[role="option"][id="${option.optionId}"]`);
    if (await locator.count() !== 1) throw new Error("AGENTS_FILL_FIELD_DRIFT");
    assertActive(signal);
    // This is the sole new click capability: one observed option inside the
    // combobox's declared listbox, whose complete schema was checked above.
    await locator.click({ timeout: 2_000 });
  } finally {
    await closeMenu(control, false);
  }
  const actual = await inspectAriaCombobox(frame, control, signal, options);
  if (!actual || actual.listboxId !== expected.listboxId || JSON.stringify(actual.options) !== JSON.stringify(expected.options) || actual.selectedValue !== value) {
    throw new Error("AGENTS_FILL_READBACK_MISMATCH");
  }
}

/**
 * Chooses the given labels in a React Select multi-select, one observed option
 * click at a time, then requires the chips to equal exactly those labels.
 * Existing unrequested chips are never removed; they fail the readback.
 */
export async function selectAriaComboboxOptions(
  frame: Frame, control: Locator, expected: AriaComboboxState, labels: readonly string[], signal?: AbortSignal,
  options?: AriaComboboxOptions,
): Promise<void> {
  const wanted = [...new Set(labels)].sort((left, right) => left.localeCompare(right));
  if (!expected.multiple || wanted.length < 1 || !wanted.every((label) => expected.options.some((option) => option.value === label))) {
    throw new Error("AGENTS_FILL_OPTION_NOT_OBSERVED");
  }
  for (const label of wanted) {
    let opened: Awaited<ReturnType<typeof openMenu>> = null;
    try {
      opened = await openMenu(frame, control, signal, options);
      if (!opened) throw new Error("AGENTS_FILL_COMBOBOX_UNAVAILABLE");
      const current = await readMenu(opened.menu, opened.listboxId, control, options);
      if (!current?.multiple || current.listboxId !== expected.listboxId || JSON.stringify(current.options) !== JSON.stringify(expected.options)) {
        throw new Error("AGENTS_FILL_FIELD_DRIFT");
      }
      if (current.selectedLabels?.includes(label)) continue;
      const optionId = await opened.menu.evaluate((element, wantedLabel) => {
        const matches = [...element.querySelectorAll('[role="option"]')].filter((option) =>
          (option.getAttribute("aria-label") || option.textContent || "").replace(/\s+/gu, " ").trim() === wantedLabel);
        return matches.length === 1 ? matches[0].id : null;
      }, label);
      if (!optionId || !SAFE_DOM_ID.test(optionId)) throw new Error("AGENTS_FILL_OPTION_NOT_OBSERVED");
      const locator = opened.menu.locator(`[role="option"][id="${optionId}"]`);
      if (await locator.count() !== 1) throw new Error("AGENTS_FILL_FIELD_DRIFT");
      assertActive(signal);
      await locator.click({ timeout: 2_000 });
    } finally {
      await closeMenu(control, false);
    }
  }
  const actual = await inspectAriaCombobox(frame, control, signal, options);
  if (!actual?.multiple || actual.listboxId !== expected.listboxId || JSON.stringify(actual.options) !== JSON.stringify(expected.options) ||
    JSON.stringify(actual.selectedLabels) !== JSON.stringify(wanted)) {
    throw new Error("AGENTS_FILL_READBACK_MISMATCH");
  }
}

/** A single-value React Select whose menu is populated only by typed search. */
async function remoteSearchShape(control: Locator) {
  if (await control.count() !== 1) return null;
  const shape = await control.evaluate((element) => {
    if (!(element instanceof HTMLInputElement) || element.getAttribute("role") !== "combobox" || element.disabled || element.getAttribute("aria-disabled") === "true") return null;
    const shell = element.closest(".select-shell");
    if (!shell || shell.querySelectorAll('[role="combobox"]').length !== 1 || !element.closest(".select__control")) return null;
    if (!["list", "both"].includes(element.getAttribute("aria-autocomplete") ?? "") || !["true", "false"].includes(element.getAttribute("aria-expanded") ?? "") ||
      !["true", "listbox", null].includes(element.getAttribute("aria-haspopup"))) return null;
    if (shell.querySelector(".select__value-container--is-multi, .select__multi-value")) return null;
    const values = [...shell.querySelectorAll(".select__single-value")];
    if (values.length > 1) return null;
    return { id: element.id, selectedLabel: (values[0]?.textContent ?? "").replace(/\s+/gu, " ").trim(), searchText: element.value };
  });
  return shape && SAFE_DOM_ID.test(shape.id) ? shape : null;
}

/**
 * Recognizes a type-to-search React Select (for example a location
 * autocomplete). Only enabled when the delivery policy permits its lookup
 * requests. Its value is the selected display only, never search text.
 */
export async function inspectRemoteSearchCombobox(frame: Frame, control: Locator, signal?: AbortSignal, options?: AriaComboboxOptions): Promise<RemoteSearchComboboxState | null> {
  if (!options?.allowReactSelectDisplay || !options.remoteSearch) return null;
  const shape = await remoteSearchShape(control);
  if (!shape || shape.searchText.trim()) return null;
  // An empty search must offer no options; a static menu is handled by
  // inspectAriaCombobox and a partially rendered one stays unsupported.
  let opened: Awaited<ReturnType<typeof openMenu>> = null;
  const wasExpanded = await control.getAttribute("aria-expanded") === "true";
  try {
    opened = await openMenu(frame, control, signal, options);
    if (opened && await opened.menu.locator('[role="option"]').count() > 0) return null;
  } finally {
    await closeMenu(control, opened?.wasExpanded ?? wasExpanded);
  }
  return Object.freeze({ selectedLabel: shape.selectedLabel });
}

/**
 * Types the approved value, waits for stable results, and clicks the single
 * result `choose` accepts. Anything else clears the typed text and throws
 * AGENTS_FILL_OPTION_AMBIGUOUS so the field stays with the candidate.
 */
export async function searchRemoteComboboxOption(
  frame: Frame, control: Locator, query: string, choose: (labels: readonly string[]) => string | null,
  signal?: AbortSignal, options?: AriaComboboxOptions,
): Promise<string> {
  assertActive(signal);
  if (!options?.allowReactSelectDisplay || !options.remoteSearch || !query.trim() || query.length > 200 || /[\u0000-\u001f\u007f]/u.test(query)) {
    throw new Error("AGENTS_FILL_OPTION_AMBIGUOUS");
  }
  const before = await remoteSearchShape(control);
  if (!before || before.searchText || before.selectedLabel) throw new Error("AGENTS_FILL_FIELD_DRIFT");
  const listboxId = `react-select-${before.id}-listbox`;
  const optionPrefix = `react-select-${before.id}-option-`;
  let chosen: string | null = null;
  let clicked = false;
  try {
    await control.focus({ timeout: 1_000 });
    assertActive(signal);
    // The typed text is the approved value itself: no model text, key or selector.
    await control.pressSequentially(query, { delay: 15, timeout: 5_000 });
    let observed: { id: string; label: string; usable: boolean }[] = [];
    let previous = "";
    let stable = 0;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      assertActive(signal);
      const state = await control.evaluate((element, id) => {
        const menu = document.getElementById(id);
        const busy = Boolean(element.closest(".select-shell")?.querySelector(".select__menu-notice--loading")) || menu?.getAttribute("aria-busy") === "true";
        const items = menu && menu.getAttribute("role") === "listbox" ? [...menu.querySelectorAll('[role="option"]')] : [];
        return {
          expanded: element.getAttribute("aria-expanded"), text: (element as HTMLInputElement).value, busy,
          options: items.map((item) => ({
            id: item.id, label: (item.getAttribute("aria-label") || item.textContent || "").replace(/\s+/gu, " ").trim(),
            usable: item.getAttribute("aria-disabled") !== "true" && !["BUTTON", "INPUT", "A", "FORM"].includes(item.tagName) && !item.querySelector("button, input, a[href], form"),
          })),
        };
      }, listboxId);
      // Inline completion or rewriting of the typed text: nothing is selected
      // and the text is cleared below, leaving the field for the candidate.
      if (state.text !== query) throw new Error("AGENTS_FILL_OPTION_AMBIGUOUS");
      const key = JSON.stringify(state.options);
      // Results must settle: remote lookups can briefly show earlier prefixes.
      if (state.expanded === "true" && !state.busy && state.options.length > 0) {
        stable = key === previous ? stable + 1 : 0;
        if (stable >= 2) { observed = state.options; break; }
      } else stable = 0;
      previous = key;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!observed.length || observed.length > MAX_SEARCHABLE_OPTIONS || observed.some((item) =>
      !item.usable || !SAFE_DOM_ID.test(item.id) || !item.id.startsWith(optionPrefix) || !item.label || item.label.length > 1_000)) {
      throw new Error("AGENTS_FILL_OPTION_AMBIGUOUS");
    }
    chosen = choose(observed.map((item) => item.label));
    const targets = observed.filter((item) => item.label === chosen);
    if (!chosen || targets.length !== 1) throw new Error("AGENTS_FILL_OPTION_AMBIGUOUS");
    const locator = frame.locator(`[role="listbox"][id="${listboxId}"] [role="option"][id="${targets[0].id}"]`);
    if (await locator.count() !== 1) throw new Error("AGENTS_FILL_FIELD_DRIFT");
    assertActive(signal);
    await locator.click({ timeout: 2_000 });
    clicked = true;
  } finally {
    if (!clicked) {
      // Leave no partial search text behind when no single result qualified.
      await control.fill("", { timeout: 1_000 }).catch(() => undefined);
      await closeMenu(control, false).catch(() => undefined);
    }
  }
  const after = await remoteSearchShape(control);
  if (!after || after.selectedLabel !== chosen || after.searchText) throw new Error("AGENTS_FILL_READBACK_MISMATCH");
  await closeMenu(control, false);
  return chosen!;
}
