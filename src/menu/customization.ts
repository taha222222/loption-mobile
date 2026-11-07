// src/menu/customization.ts
// The choices a customer makes on a meal (sauce, extras, removals), as the
// kitchen configured them (public.meal_option_groups / meal_options). Pure:
// selection rules and the price shown while choosing. The server
// (checkout_price) re-validates every choice and computes the price that is
// charged; nothing here is authoritative.

export interface MealOption {
  id: string;
  name: string;
  priceDelta: number; // TTC extra, >= 0
}

export interface OptionGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: MealOption[];
}

export interface ChosenOption {
  id: string;
  name: string;
  group: string;
  price: number;
}

const cents = (mad: number) => Math.round(mad * 100);

export const isRequired = (g: OptionGroup) => g.minSelect > 0;
export const isSingleChoice = (g: OptionGroup) => g.maxSelect === 1;

// "Obligatoire · 1 choix", "Facultatif · jusqu’à 2".
export function groupHint(g: OptionGroup): string {
  if (g.minSelect > 0) {
    return g.minSelect === g.maxSelect ? `Obligatoire · ${g.minSelect} choix` : `Obligatoire · ${g.minSelect} à ${g.maxSelect} choix`;
  }
  return g.maxSelect === 1 ? 'Facultatif · 1 choix' : `Facultatif · jusqu’à ${g.maxSelect}`;
}

// Tapping a choice: a single-choice group swaps; a multiple-choice group
// toggles, never beyond its maximum.
export function toggleOption(groups: OptionGroup[], selected: string[], groupId: string, optionId: string): string[] {
  const group = groups.find((g) => g.id === groupId);
  if (!group || !group.options.some((o) => o.id === optionId)) return selected;
  const inGroup = new Set(group.options.map((o) => o.id));
  if (selected.includes(optionId)) {
    // A required single choice stays selected (it can only be swapped).
    if (isSingleChoice(group) && isRequired(group)) return selected;
    return selected.filter((id) => id !== optionId);
  }
  if (isSingleChoice(group)) return [...selected.filter((id) => !inGroup.has(id)), optionId];
  const count = selected.filter((id) => inGroup.has(id)).length;
  if (count >= group.maxSelect) return selected;
  return [...selected, optionId];
}

// Groups whose required choices are missing (by name), in display order.
export function missingChoices(groups: OptionGroup[], selected: string[]): string[] {
  return groups
    .filter((g) => g.options.filter((o) => selected.includes(o.id)).length < g.minSelect)
    .map((g) => g.name);
}

export function chosenOptions(groups: OptionGroup[], selected: string[]): ChosenOption[] {
  const out: ChosenOption[] = [];
  for (const g of groups) {
    for (const o of g.options) if (selected.includes(o.id)) out.push({ id: o.id, name: o.name, group: g.name, price: o.priceDelta });
  }
  return out;
}

// Unit price shown while choosing (base + extras), in centimes-safe MAD.
export function unitPrice(basePrice: number, options: readonly { price: number }[]): number {
  return (cents(basePrice) + options.reduce((s, o) => s + cents(o.price), 0)) / 100;
}

// One cart line per meal and set of choices: the same meal with other
// choices is another line.
export function lineKey(mealId: string, optionIds: readonly string[]): string {
  return optionIds.length ? `${mealId}|${[...optionIds].sort().join(',')}` : mealId;
}

// "Harissa · Fromage (+5 MAD) · Sans oignon"
export function describeOptions(options: readonly ChosenOption[]): string {
  return options.map((o) => (o.price > 0 ? `${o.name} (+${formatMad(o.price)})` : o.name)).join(' · ');
}

// Customer-facing amounts in MAD (DH): "65 MAD", "59,50 MAD", "1 250 MAD".
export function formatMad(value: number): string {
  const cents = Math.round(value * 100);
  const whole = Math.trunc(Math.abs(cents) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  const rest = Math.abs(cents) % 100;
  return `${cents < 0 ? '-' : ''}${whole}${rest ? `,${rest.toString().padStart(2, '0')}` : ''}\u00A0MAD`;
}

// Popularity line from the server count (distinct customers who received
// the meal). Hidden below the minimum: a small number is not a signal.
export const POPULARITY_MIN_CUSTOMERS = 10;
export function popularityLabel(customers: number | null | undefined): string | null {
  if (customers == null || !Number.isFinite(customers) || customers < POPULARITY_MIN_CUSTOMERS) return null;
  if (customers < 100) return `Déjà commandé par ${customers} clients`;
  const step = customers < 1000 ? 10 : 100;
  const floor = Math.floor(customers / step) * step;
  return `Déjà commandé par plus de ${floor.toLocaleString('fr-FR').replace(/ | /g, ' ')} clients`;
}
