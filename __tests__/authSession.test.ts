// Auth lifecycle and sign-out cleanup, against a mocked Supabase client.
import { useAuthStore } from '../src/stores/authStore';
import { useCartStore } from '../src/stores/cartStore';
import { useUserStore } from '../src/stores/userStore';
import { useCollaboratorStore } from '../src/stores/collaboratorStore';
import { locationService } from '../src/services/locationService';

type Row = Record<string, any> | null;

const mockState: {
  rows: Record<string, (filterValue: string) => { data: Row; error: any }>;
  signOutError: any;
  authListeners: ((event: string, session: any) => void)[];
} = { rows: {}, signOutError: null, authListeners: [] };

const mockSupabase = {
  from: jest.fn((table: string) => {
    let filterValue = '';
    const builder: any = {
      select: () => builder,
      eq: (_column: string, value: string) => {
        filterValue = value;
        return builder;
      },
      maybeSingle: async () => (mockState.rows[table] ?? (() => ({ data: null, error: null })))(filterValue),
    };
    return builder;
  }),
  removeAllChannels: jest.fn(async () => []),
  auth: {
    onAuthStateChange: jest.fn((cb: (event: string, session: any) => void) => {
      mockState.authListeners.push(cb);
      return {
        data: {
          subscription: {
            unsubscribe: jest.fn(() => {
              mockState.authListeners = mockState.authListeners.filter((l) => l !== cb);
            }),
          },
        },
      };
    }),
    signInWithPassword: jest.fn(async ({ email }: { email: string }) => ({
      data: { session: sessionFor(email) },
      error: null,
    })),
    signOut: jest.fn(async () => ({ error: mockState.signOutError })),
  },
};

// Lazy getter: jest.mock is hoisted above the mockSupabase declaration.
jest.mock('../src/lib/supabase', () => ({
  get supabase() {
    return mockSupabase;
  },
}));
jest.mock('../src/services/locationService', () => ({
  locationService: { stopTracking: jest.fn(async () => {}) },
}));

function sessionFor(email: string) {
  return { access_token: 't', user: { id: `id-${email}`, email } };
}

const meal = { id: 'meal-1', name: 'Bowl', price: 69, calories: 450, protein: 35 };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  mockState.rows = {
    user_profiles: () => ({ data: { role: 'customer', is_admin: false }, error: null }),
  };
  mockState.signOutError = null;
  jest.clearAllMocks();
  await useCartStore.persist.rehydrate();
  useAuthStore.setState({ session: null, user: null, role: null, roleStatus: 'idle', isLoading: true });
  useCartStore.getState().reset();
  useUserStore.getState().reset();
});

describe('sign-in and role resolution', () => {
  it('resolves the role before reporting it and binds the cart to the user', async () => {
    await useAuthStore.getState().signIn('a@x.ma', 'pw');
    expect(useAuthStore.getState()).toMatchObject({ role: 'customer', roleStatus: 'resolved' });
    expect(useCartStore.getState().ownerId).toBe('id-a@x.ma');
  });

  it('reports an error instead of defaulting to customer when the profile query fails', async () => {
    mockState.rows.user_profiles = () => ({ data: null, error: { message: 'network down' } });
    await useAuthStore.getState().signIn('a@x.ma', 'pw');
    expect(useAuthStore.getState()).toMatchObject({ role: null, roleStatus: 'error' });
  });

  it('gives admins the admin role from the profile', async () => {
    mockState.rows.user_profiles = () => ({ data: { role: 'customer', is_admin: true }, error: null });
    await useAuthStore.getState().signIn('a@x.ma', 'pw');
    expect(useAuthStore.getState().role).toBe('admin');
  });
});

describe('sign-out', () => {
  it('clears user-scoped state, realtime channels and location tracking', async () => {
    await useAuthStore.getState().signIn('a@x.ma', 'pw');
    useCartStore.getState().addItem(meal);
    useUserStore.setState({ profile: { id: 'p' } as any, loadedUserId: 'id-a@x.ma', profileStatus: 'loaded' });
    useCollaboratorStore.setState({ orders: [{ id: 'o' } as any] });

    const { error } = await useAuthStore.getState().signOut();

    expect(error).toBeNull();
    expect(useAuthStore.getState()).toMatchObject({ session: null, user: null, role: null, roleStatus: 'idle' });
    expect(useCartStore.getState()).toMatchObject({ items: [], ownerId: null });
    expect(useUserStore.getState()).toMatchObject({ profile: null, loadedUserId: null, profileStatus: 'unloaded' });
    expect(useCollaboratorStore.getState().orders).toEqual([]);
    expect(mockSupabase.removeAllChannels).toHaveBeenCalled();
    expect(locationService.stopTracking).toHaveBeenCalled();
  });

  it('keeps the session and reports the error when the server sign-out fails', async () => {
    await useAuthStore.getState().signIn('a@x.ma', 'pw');
    useCartStore.getState().addItem(meal);
    mockState.signOutError = { message: 'offline' };

    const { error } = await useAuthStore.getState().signOut();

    expect(error).toEqual({ message: 'offline' });
    expect(useAuthStore.getState().user?.id).toBe('id-a@x.ma');
    expect(useCartStore.getState().items).toHaveLength(1);
  });
});

describe('account switching', () => {
  it('never shows one account’s persisted cart to another account', async () => {
    await useAuthStore.getState().signIn('a@x.ma', 'pw');
    useCartStore.getState().addItem(meal);

    // Simulate an app restart where B signs in without A having signed out.
    useAuthStore.setState({ session: null, user: null, role: null, roleStatus: 'idle' });
    await useCartStore.persist.rehydrate();
    expect(useCartStore.getState().items).toHaveLength(1);

    await useAuthStore.getState().signIn('b@x.ma', 'pw');
    expect(useCartStore.getState()).toMatchObject({ items: [], ownerId: 'id-b@x.ma' });
  });

  it('keeps the cart when the same user signs back in', async () => {
    await useAuthStore.getState().signIn('a@x.ma', 'pw');
    useCartStore.getState().addItem(meal);
    useAuthStore.setState({ session: null, user: null, role: null, roleStatus: 'idle' });
    await useCartStore.persist.rehydrate();

    await useAuthStore.getState().signIn('a@x.ma', 'pw');
    expect(useCartStore.getState().items).toHaveLength(1);
  });
});

describe('auth listener lifecycle', () => {
  it('registers a single listener and removes it on cleanup', async () => {
    const cleanupA = useAuthStore.getState().initialize();
    const cleanupB = useAuthStore.getState().initialize();
    expect(mockSupabase.auth.onAuthStateChange).toHaveBeenCalledTimes(1);

    mockState.authListeners[0]('INITIAL_SESSION', sessionFor('a@x.ma'));
    await flush();
    await flush();
    expect(useAuthStore.getState()).toMatchObject({ isLoading: false, role: 'customer' });

    cleanupA();
    cleanupB();
    expect(mockState.authListeners).toHaveLength(0);
  });

  it('does not re-resolve the role on token refresh for the same user', async () => {
    const cleanup = useAuthStore.getState().initialize();
    mockState.authListeners[0]('INITIAL_SESSION', sessionFor('a@x.ma'));
    await flush();
    await flush();
    mockSupabase.from.mockClear();

    mockState.authListeners[0]('TOKEN_REFRESHED', sessionFor('a@x.ma'));
    await flush();
    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(useAuthStore.getState().role).toBe('customer');
    cleanup();
  });

  it('clears state when another device signs the user out (SIGNED_OUT event)', async () => {
    const cleanup = useAuthStore.getState().initialize();
    mockState.authListeners[0]('INITIAL_SESSION', sessionFor('a@x.ma'));
    await flush();
    await flush();
    useCartStore.getState().addItem(meal);

    mockState.authListeners[0]('SIGNED_OUT', null);
    await flush();
    await flush();
    expect(useAuthStore.getState()).toMatchObject({ user: null, role: null });
    expect(useCartStore.getState().items).toEqual([]);
    cleanup();
  });
});

describe('sign-up', () => {
  it('always creates a customer profile regardless of caller input', async () => {
    const insert = jest.fn(async () => ({ error: null }));
    (mockSupabase.auth as any).signUp = jest.fn(async () => ({
      data: { user: { id: 'new' }, session: null },
      error: null,
    }));
    mockSupabase.from.mockImplementationOnce(() => ({ insert }) as any);

    await useAuthStore.getState().signUp('n@x.ma', 'pw', { full_name: 'N', role: 'admin', is_admin: true });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ role: 'customer', is_admin: false }));
  });
});

describe('shared device with a staff login', () => {
  it('discards another customer’s persisted cart when a driver signs in', async () => {
    await useAuthStore.getState().signIn('a@x.ma', 'pw');
    useCartStore.getState().addItem(meal);
    useAuthStore.setState({ session: null, user: null, role: null, roleStatus: 'idle' });
    await useCartStore.persist.rehydrate();

    mockState.rows.user_profiles = () => ({ data: { role: 'driver', is_admin: false }, error: null });
    await useAuthStore.getState().signIn('driver@x.ma', 'pw');
    expect(useAuthStore.getState().role).toBe('driver');
    expect(useCartStore.getState().items).toEqual([]);
  });
});
