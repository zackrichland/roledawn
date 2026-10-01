import type { Locator } from "playwright-core";

export type LeverLocationState = Readonly<{ selectedLabel: string; selection: string; paired: boolean }>;

/** Lever clears unselected search text on blur. Only the native selected pair counts. */
export async function readLeverLocation(control: Locator): Promise<LeverLocationState | null> {
  return control.evaluate(element => {
    if (!(element instanceof HTMLInputElement) || element.disabled ||
      !element.matches('#application-form input.location-input#location-input[name="location"][type="text"]')) return null;
    const wrapper = element.closest(".application-field");
    const hidden = wrapper?.querySelectorAll('input#selected-location[type="hidden"][name="selectedLocation"]');
    if (hidden?.length !== 1 || wrapper?.querySelectorAll(".dropdown-container .dropdown-results").length !== 1) return null;
    const selection = (hidden[0] as HTMLInputElement).value;
    if (selection.length > 16_000) return null;
    if (!selection) return { selectedLabel: element.value, selection: "", paired: !element.value };
    try {
      const parsed = JSON.parse(selection);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof parsed.name !== "string") return { selectedLabel: element.value, selection, paired: false };
      return { selectedLabel: element.value, selection, paired: parsed.name === element.value && Boolean(element.value.trim()) };
    } catch { return { selectedLabel: element.value, selection, paired: false }; }
  });
}

export async function selectLeverLocation(control: Locator, query: string,
  choose: (labels: readonly string[]) => string | null, signal?: AbortSignal, replaceOwnWrite = false): Promise<string> {
  const active = () => { if (signal?.aborted) throw new Error("AGENTS_FILL_CANCELLED"); };
  active();
  const initial = await readLeverLocation(control);
  if (!initial || initial.selectedLabel && !replaceOwnWrite || !query.trim() || query.length > 100) throw new Error("AGENTS_FILL_FIELD_DRIFT");
  // The reviewed client starts its debounced lookup on keydown, not input.
  await control.fill("", { timeout: 5_000 });
  await control.pressSequentially(query, { timeout: 5_000 });
  let previous = ""; let stable = 0;
  const deadline = Date.now() + 10_000;
  let observed: { id: string; label: string; usable: boolean }[] = [];
  while (Date.now() < deadline) {
    active();
    const state = await control.evaluate(element => {
      const menu = element.closest(".application-field")?.querySelector(".dropdown-container");
      return { text: (element as HTMLInputElement).value,
        visible: Boolean(menu && getComputedStyle(menu).display !== "none"),
        options: [...menu?.querySelectorAll(".dropdown-results > .dropdown-location") ?? []].map(item => ({
          id: item.id, label: (item.textContent ?? "").trim(),
          usable: item.tagName === "DIV" && !item.querySelector("button, input, a[href], form"),
        })) };
    });
    if (state.text !== query) throw new Error("AGENTS_FILL_FIELD_DRIFT");
    const key = JSON.stringify(state.options);
    stable = state.visible && state.options.length > 0 && previous === key ? stable + 1 : 0;
    previous = key;
    if (stable >= 2) { observed = state.options; break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!observed.length || observed.length > 50 || observed.some(item => !/^location-\d{1,3}$/u.test(item.id) ||
    !item.usable || !item.label || item.label.length > 1_000)) throw new Error("AGENTS_FILL_OPTION_AMBIGUOUS");
  const chosen = choose(observed.map(item => item.label));
  const targets = observed.filter(item => item.label === chosen);
  if (!chosen || targets.length !== 1) throw new Error("AGENTS_FILL_OPTION_AMBIGUOUS");
  const target = control.locator("..").locator(`.dropdown-results > .dropdown-location[id="${targets[0].id}"]`);
  if (await target.count() !== 1 || (await target.textContent())?.trim() !== chosen) throw new Error("AGENTS_FILL_FIELD_DRIFT");
  active();
  await target.click({ timeout: 2_000 });
  await control.blur({ timeout: 2_000 });
  const after = await readLeverLocation(control);
  if (after?.selectedLabel !== chosen || !after.selection || !after.paired) throw new Error("AGENTS_FILL_READBACK_MISMATCH");
  return chosen;
}
