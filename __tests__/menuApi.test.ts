// The product page on a server that does not have the checkout migration
// yet (the hosted project today): no `meals.description`, no choice tables,
// no popularity function. The meal must still open, without those parts.
import { clearPopularityCache, fetchMealDetail, fetchMealPopularity, fetchMealsWithChoices } from '../src/services/menuApi';

const MEAL = { id: 'm1', name: 'Bol poulet', price: 65, image_url: null, calories: 600, protein: 40, carbs: 50, fat: 12, available: true };
const mockSelects: string[] = [];
const mockServer = { migrated: false };

jest.mock('../src/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: (cols: string) => {
        mockSelects.push(`${table}:${cols}`);
        const missingColumn = { data: null, error: { code: '42703', message: 'column meals.description does not exist' } };
        const missingTable = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.meal_option_groups' in the schema cache" } };
        if (table === 'meal_option_groups') {
          const r = mockServer.migrated ? { data: [], error: null } : missingTable;
          return Object.assign(Promise.resolve(r), { eq: async () => r });
        }
        return {
          eq: () => ({
            maybeSingle: async () =>
              cols.includes('description') && !mockServer.migrated
                ? missingColumn
                : { data: mockServer.migrated ? { ...MEAL, description: 'Poulet grillé.' } : MEAL, error: null },
          }),
        };
      },
    }),
    rpc: async () => (mockServer.migrated ? { data: 12, error: null } : { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }),
  },
}));

beforeEach(() => {
  mockSelects.length = 0;
  clearPopularityCache();
});

describe('product page on a server without the checkout migration', () => {
  it('opens the meal without description or choices instead of failing', async () => {
    mockServer.migrated = false;
    const r = await fetchMealDetail('m1');
    expect(r).toEqual({ ok: true, meal: expect.objectContaining({ id: 'm1', name: 'Bol poulet', price: 65, description: null }), groups: [] });
    expect(mockSelects.filter((s) => s.startsWith('meals:'))).toHaveLength(2); // retried without `description`
    expect(await fetchMealPopularity('m1')).toBeNull(); // hidden, never invented
    expect((await fetchMealsWithChoices()).size).toBe(0); // "+" adds directly
  });

  it('on a migrated server reads the description in one request', async () => {
    mockServer.migrated = true;
    const r = await fetchMealDetail('m1');
    expect(r.ok && r.meal.description).toBe('Poulet grillé.');
    expect(mockSelects.filter((s) => s.startsWith('meals:'))).toHaveLength(1);
    expect(await fetchMealPopularity('m1')).toBe(12);
  });
});
