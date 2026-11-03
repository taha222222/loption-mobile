// In-app account deletion: typed confirmation, server refusal messages, and
// the device cleared after a confirmed deletion. Server rules are tested in
// supabase/tests/run_v1_account_deletion.sh.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import DeleteAccountScreen from '../app/(app)/delete-account';
import { deleteMyAccount } from '../src/services/accountApi';
import { useAuthStore } from '../src/stores/authStore';

const mockRpc = jest.fn();
jest.mock('../src/lib/supabase', () => ({ supabase: { rpc: (...a: any[]) => mockRpc(...a) } }));
const mockMotion = { clearSnapshotsAsync: jest.fn(async () => undefined), setBackgroundEnabledAsync: jest.fn(async () => false) };
jest.mock('../src/activity/motionNative', () => ({ motion: () => mockMotion }));
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ signOut: jest.fn(async () => ({ error: null })) } as any);
});

describe('deleteMyAccount', () => {
  it('maps server answers to plain messages; nothing is claimed deleted on failure', async () => {
    mockRpc.mockResolvedValueOnce({ error: null });
    await expect(deleteMyAccount('SUPPRIMER')).resolves.toEqual({ ok: true });
    expect(mockRpc).toHaveBeenCalledWith('delete_my_account', { p_confirmation: 'SUPPRIMER' });
    mockRpc.mockResolvedValueOnce({ error: { code: 'PGRST202', message: 'Could not find the function public.delete_my_account' } });
    await expect(deleteMyAccount('SUPPRIMER')).resolves.toMatchObject({ ok: false, reason: 'not_available' });
    mockRpc.mockResolvedValueOnce({ error: { code: '42501', message: 'staff, driver and partner accounts are closed by L\'OPTION support' } });
    await expect(deleteMyAccount('SUPPRIMER')).resolves.toMatchObject({ ok: false, reason: 'staff' });
    mockRpc.mockResolvedValueOnce({ error: { message: 'Network request failed' } });
    await expect(deleteMyAccount('SUPPRIMER')).resolves.toMatchObject({ ok: false, reason: 'network', message: /Rien n’a été supprimé/ });
  });
});

describe('delete account screen', () => {
  it('needs the typed confirmation, then deletes, clears the phone sensor data and signs out', async () => {
    mockRpc.mockResolvedValue({ error: null });
    await render(<DeleteAccountScreen />);
    expect(screen.getByText(/vos pas, distances et séances/)).toBeTruthy();
    expect(screen.getByText(/vos commandes passées, détachées de votre compte/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Supprimer définitivement'));
    expect(mockRpc).not.toHaveBeenCalled(); // disabled until confirmed
    await fireEvent.changeText(screen.getByLabelText('Tapez SUPPRIMER pour confirmer'), 'supprimer');
    await fireEvent.press(screen.getByText('Supprimer définitivement'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/(auth)/login'));
    expect(mockMotion.clearSnapshotsAsync).toHaveBeenCalled();
    expect(useAuthStore.getState().signOut).toHaveBeenCalled();
  });

  it('on a refusal says so and keeps the account signed in', async () => {
    mockRpc.mockResolvedValue({ error: { code: '42501', message: 'staff, driver and partner accounts are closed by L\'OPTION support' } });
    await render(<DeleteAccountScreen />);
    await fireEvent.changeText(screen.getByLabelText('Tapez SUPPRIMER pour confirmer'), 'SUPPRIMER');
    await fireEvent.press(screen.getByText('Supprimer définitivement'));
    await waitFor(() => expect(screen.getByText('Compte non supprimé')).toBeTruthy());
    expect(useAuthStore.getState().signOut).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});
