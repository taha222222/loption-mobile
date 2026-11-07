// src/services/menuApi.ts
// Reads for the product page: the meal, its configured choices (only what
// exists in public.meal_option_groups / meal_options, active and
// available), and its popularity (public.meal_popularity: distinct
// customers who received it). RLS-scoped reads with the anon key only.
import { supabase } from '../lib/supabase';
import type { OptionGroup } from '../menu/customization';

export interface MealDetail {
  id: string;
  name: string;
  price: number;
  description: string | null;
  imageUrl: string | null;
  calories: number;
  protein: number;
  carbs: number | null;
  fat: number | null;
  available: boolean;
}

export type MealDetailResult = { ok: true; meal: MealDetail; groups: OptionGroup[] } | { ok: false; reason: 'not_found' | 'error' };

interface GroupRow {
  id: string;
  name: string;
  min_select: number;
  max_select: number;
  sort_order: number;
  meal_options: { id: string; name: string; price_delta: number | string; sort_order: number }[] | null;
}

export function toGroups(rows: GroupRow[]): OptionGroup[] {
  return [...rows]
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .map((g) => ({
      id: g.id,
      name: g.name,
      minSelect: g.min_select,
      maxSelect: g.max_select,
      options: [...(g.meal_options ?? [])]
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
        .map((o) => ({ id: o.id, name: o.name, priceDelta: Number(o.price_delta) })),
    }))
    // A group without any available choice cannot be satisfied: hidden (the
    // server refuses the meal if such a group is required).
    .filter((g) => g.options.length > 0);
}

export async function fetchMealDetail(mealId: string): Promise<MealDetailResult> {
  try {
    const [meal, groups] = await Promise.all([
      supabase.from('meals').select('id, name, price, description, image_url, calories, protein, carbs, fat, available').eq('id', mealId).maybeSingle(),
      supabase
        .from('meal_option_groups')
        .select('id, name, min_select, max_select, sort_order, meal_options (id, name, price_delta, sort_order)')
        .eq('meal_id', mealId),
    ]);
    if (meal.error) return { ok: false, reason: 'error' };
    if (!meal.data) return { ok: false, reason: 'not_found' };
    const m = meal.data as Record<string, unknown>;
    return {
      ok: true,
      meal: {
        id: String(m.id),
        name: String(m.name),
        price: Number(m.price),
        description: typeof m.description === 'string' && m.description.trim() ? m.description.trim() : null,
        imageUrl: typeof m.image_url === 'string' && m.image_url ? m.image_url : null,
        calories: Number(m.calories ?? 0),
        protein: Number(m.protein ?? 0),
        carbs: m.carbs == null ? null : Number(m.carbs),
        fat: m.fat == null ? null : Number(m.fat),
        available: m.available !== false,
      },
      // A server without the choices tables (not migrated yet) means no choices.
      groups: groups.error ? [] : toGroups((groups.data ?? []) as GroupRow[]),
    };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

// Meals that have choices (the menu's "+" opens the product page for them).
export async function fetchMealsWithChoices(): Promise<Set<string>> {
  try {
    const { data, error } = await supabase.from('meal_option_groups').select('meal_id');
    if (error || !data) return new Set();
    return new Set((data as { meal_id: string }[]).map((r) => r.meal_id));
  } catch {
    return new Set();
  }
}

// Popularity, cached for 10 minutes per meal; null when unavailable.
const popularityCache = new Map<string, { at: number; value: number | null }>();
export async function fetchMealPopularity(mealId: string, now = Date.now()): Promise<number | null> {
  const hit = popularityCache.get(mealId);
  if (hit && now - hit.at < 10 * 60 * 1000) return hit.value;
  try {
    const { data, error } = await supabase.rpc('meal_popularity', { p_meal: mealId });
    const value = error || typeof data !== 'number' ? null : data;
    popularityCache.set(mealId, { at: now, value });
    return value;
  } catch {
    return null;
  }
}
export const clearPopularityCache = () => popularityCache.clear();
