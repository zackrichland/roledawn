import type { Locator } from "playwright-core";
import type { RemoteSearchComboboxState } from "./agents-aria-combobox.ts";

const DOM_ID = /^[A-Za-z0-9_:.-]{1,256}$/u;

/** Ashby's reviewed location control displays its saved result in the input.
 * Its highlighted menu option (aria-selected) is only keyboard focus. */
export async function readAshbyLocation(control: Locator): Promise<RemoteSearchComboboxState | null> {
  return control.evaluate(element => {
    if (!(element instanceof HTMLInputElement) || element.disabled ||
      !element.matches('.ashby-application-form-input-autocomplete[role="combobox"][aria-autocomplete="list"]') ||
      element.closest(".ashby-application-form-field-entry")?.getAttribute("data-field-path") !== "_systemfield_location" ||
      element.getAttribute("aria-expanded") !== "false") return null;
    return { selectedLabel: element.value.trim() };
  });
}

export async function selectAshbyLocation(
  control: Locator, query: string, choose: (labels: readonly string[]) => string | null, signal?: AbortSignal,
): Promise<string> {
  const active = () => { if (signal?.aborted) throw new Error("AGENTS_FILL_CANCELLED"); };
  active();
  if (!query.trim() || query.length > 200 || /[\u0000-\u001f\u007f]/u.test(query)) throw new Error("AGENTS_FILL_OPTION_AMBIGUOUS");
  const initial = await readAshbyLocation(control);
  if (!initial || initial.selectedLabel) throw new Error("AGENTS_FILL_FIELD_DRIFT");
  let clicked = false;
  let chosen: string | null = null;
  try {
    await control.fill(query, { timeout: 5_000 });
    const deadline = Date.now() + 5_000;
    let previous = "";
    let stable = 0;
    let menuId = "";
    let observed: { id: string; label: string; usable: boolean }[] = [];
    while (Date.now() < deadline) {
      active();
      const state = await control.evaluate(element => {
        const id = element.getAttribute("aria-controls") ?? "";
        const menu = document.getElementById(id);
        return {
          id, text: (element as HTMLInputElement).value, expanded: element.getAttribute("aria-expanded"),
          valid: menu?.getAttribute("role") === "listbox", busy: Boolean(menu?.querySelector(".ashby-application-form-input-autocomplete-popup-loading")),
          options: [...menu?.querySelectorAll('.ashby-application-form-input-autocomplete-popup-result[role="option"]') ?? []].map(item => ({
            id: item.id, label: (item.textContent ?? "").replace(/\s+/gu, " ").trim(),
            usable: item.tagName === "DIV" && item.getAttribute("aria-disabled") !== "true" && !item.querySelector("button, input, a[href], form"),
          })),
        };
      });
      if (state.text !== query) throw new Error("AGENTS_FILL_OPTION_AMBIGUOUS");
      const key = JSON.stringify([state.id, state.options]);
      stable = state.valid && state.expanded === "true" && !state.busy && state.options.length > 0 && key === previous ? stable + 1 : 0;
      previous = key;
      if (stable >= 2) { menuId = state.id; observed = state.options; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!DOM_ID.test(menuId) || !observed.length || observed.length > 50 || observed.some(item =>
      !DOM_ID.test(item.id) || !item.usable || !item.label || item.label.length > 1_000)) throw new Error("AGENTS_FILL_OPTION_AMBIGUOUS");
    chosen = choose(observed.map(item => item.label));
    const targets = observed.filter(item => item.label === chosen);
    if (!chosen || targets.length !== 1) throw new Error("AGENTS_FILL_OPTION_AMBIGUOUS");
    // The locator remains tied to the listbox controlled by this input.
    const target = control.page().locator(`[role="listbox"][id="${menuId}"] .ashby-application-form-input-autocomplete-popup-result[id="${targets[0].id}"]`);
    if (await target.count() !== 1 || (await target.innerText()).replace(/\s+/gu, " ").trim() !== chosen) throw new Error("AGENTS_FILL_FIELD_DRIFT");
    active();
    await target.click({ timeout: 2_000 });
    clicked = true;
  } finally {
    if (!clicked) {
      // Clearing with fill("") would autosave a null value. Escape only closes
      // the search and the run stops before any final submission.
      await control.press("Escape", { timeout: 1_000 }).catch(() => undefined);
    }
  }
  const after = await readAshbyLocation(control);
  if (!after || after.selectedLabel !== chosen) throw new Error("AGENTS_FILL_READBACK_MISMATCH");
  return chosen!;
}
