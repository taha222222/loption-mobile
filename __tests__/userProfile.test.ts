// Profile creation and saving against a mocked Supabase client.
import { useUserStore } from '../src/stores/userStore';
const mockCalls: { table: string; op: string; payload?: any; options?: any; filter?: [string, any] }[] = [];
let mockRows: any[] = [];
let mockFailNext: { op: string; error: any } | null = null;

function mockBuilder(table: string) {
  const state: any = { table, op: 'select' };
  const result = () => {
    if (mockFailNext && mockFailNext.op === state.op) {
      const error = mockFailNext.error;
      mockFailNext = null;
      return { data: null, error };
    }
    if (state.op === 'select') return { data: mockRows.find((r) => r.user_id === state.filter?.[1]) ?? null, error: null };
    if (state.op === 'upsert') {
      if (!mockRows.some((r) => r.user_id === state.payload.user_id)) mockRows.push({ id: 'p1', ...state.payload, onboarding_completed_at: null });
      return { data: null, error: null };
    }
    if (state.op === 'update') {
      const row = mockRows.find((r) => r.user_id === state.filter?.[1]);
      if (!row) return { data: null, error: null };
      Object.assign(row, state.payload);
      // Server-derived values (the database trigger) for the saved answers.
      if (row.gender === 'man' && row.age === 30) Object.assign(row, { bmr_kcal: 1649, tdee_kcal: 2556 });
      return { data: { ...row }, error: null };
    }
    return { data: null, error: null };
  };
  const api: any = {
    select: () => api,
    eq: (col: string, value: any) => {
      state.filter = [col, value];
      mockCalls.push({ table, op: state.op, payload: state.payload, filter: state.filter });
      return api;
    },
    upsert: (payload: any, options: any) => {
      state.op = 'upsert';
      state.payload = payload;
      mockCalls.push({ table, op: 'upsert', payload, options });
      return Promise.resolve(result());
    },
    update: (payload: any) => {
      state.op = 'update';
      state.payload = payload;
      return api;
    },
    maybeSingle: async () => result(),
  };
  return api;
}

jest.mock('../src/lib/supabase', () => ({
  get supabase() {
    return { from: (table: string) => mockBuilder(table) };
  },
}));

beforeEach(() => {
  mockCalls.length = 0;
  mockRows = [];
  mockFailNext = null;
  useUserStore.getState().reset();
});

describe('profile creation on first sign-in', () => {
  it('creates the missing profile with only the user id (role is decided by the database), then loads it', async () => {
    await useUserStore.getState().loadProfile('u1');
    const upsert = mockCalls.find((c) => c.op === 'upsert')!;
    expect(upsert.payload).toEqual({ user_id: 'u1' });
    expect(upsert.options).toEqual({ onConflict: 'user_id', ignoreDuplicates: true });
    expect(useUserStore.getState()).toMatchObject({ profileStatus: 'loaded', profile: { user_id: 'u1' } });
  });

  it('does not create a second profile for an account that already has one (e.g. another provider)', async () => {
    mockRows = [{ id: 'p0', user_id: 'u1', onboarding_completed_at: '2026-10-01T00:00:00Z' }];
    await useUserStore.getState().loadProfile('u1');
    expect(mockCalls.some((c) => c.op === 'upsert')).toBe(false);
    expect(mockRows).toHaveLength(1);
  });

  it('refreshes an already loaded profile in the background (no "loading" flip that would remount screens)', async () => {
    mockRows = [{ id: 'p0', user_id: 'u1', onboarding_completed_at: '2026-10-01T00:00:00Z', first_order_offer_status: 'eligible' }];
    await useUserStore.getState().loadProfile('u1');
    const statuses: string[] = [];
    const unsubscribe = useUserStore.subscribe((s) => statuses.push(s.profileStatus));
    mockRows[0].first_order_offer_status = 'applied';
    await useUserStore.getState().loadProfile('u1');
    unsubscribe();
    expect(statuses).not.toContain('loading');
    expect(useUserStore.getState().profile?.first_order_offer_status).toBe('applied');
  });

  it('reports an error state (retry offered) instead of "onboarding not done" when loading fails', async () => {
    mockFailNext = { op: 'select', error: { message: 'network' } };
    await useUserStore.getState().loadProfile('u1');
    expect(useUserStore.getState().profileStatus).toBe('error');
  });
});

describe('saving onboarding', () => {
  beforeEach(async () => {
    mockRows = [{ id: 'p1', user_id: 'u1', onboarding_completed_at: null }];
    await useUserStore.getState().loadProfile('u1');
  });

  it('saves only the answers; derived values come back from the server', async () => {
    const result = await useUserStore
      .getState()
      .saveOnboardingAnswers('u1', { gender: 'man', age: 30, weight: 70, height: 175, activity_level: 'moderate' });
    const update = mockCalls.filter((c) => c.op === 'update').pop()!;
    expect(Object.keys(update.payload).sort()).toEqual(['activity_level', 'age', 'gender', 'height', 'updated_at', 'weight']);
    expect(update.filter).toEqual(['user_id', 'u1']);
    expect(result).toMatchObject({ ok: true, profile: { bmr_kcal: 1649, tdee_kcal: 2556 } });
    expect(useUserStore.getState().calculateTDEE()).toBe(2556);
  });

  it('marks completion with a single column (the server stamps the time)', async () => {
    await useUserStore.getState().completeOnboarding('u1');
    const update = mockCalls.filter((c) => c.op === 'update').pop()!;
    expect(Object.keys(update.payload).sort()).toEqual(['onboarding_completed_at', 'updated_at']);
  });

  it('shows a clear message when the server refuses a value', async () => {
    mockFailNext = { op: 'update', error: { code: '22023', message: 'age must be between 13 and 100 years' } };
    const result = await useUserStore
      .getState()
      .saveOnboardingAnswers('u1', { gender: 'man', age: 30, weight: 70, height: 175, activity_level: 'moderate' });
    expect(result).toMatchObject({ ok: false, code: '22023' });
  });

  it('saves a manual delivery address without coordinates', async () => {
    const result = await useUserStore.getState().saveDeliveryAddress('u1', '  12 Rue Exemple, Casablanca ', null);
    expect(result.ok).toBe(true);
    const update = mockCalls.filter((c) => c.op === 'update').pop()!;
    expect(update.payload).toMatchObject({
      delivery_address: '12 Rue Exemple, Casablanca',
      delivery_latitude: null,
      delivery_longitude: null,
    });
  });

  it('returns 0 (no estimate) for an unspecified sex input instead of using a formula', async () => {
    await useUserStore
      .getState()
      .saveOnboardingAnswers('u1', { gender: 'unspecified', age: 30, weight: 70, height: 175, activity_level: 'moderate' });
    expect(useUserStore.getState().calculateBMR()).toBe(0);
    expect(useUserStore.getState().calculateDailyCalories()).toBe(0);
  });
});
