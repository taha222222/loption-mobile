// Notification / location introduction after onboarding. The OS permission
// APIs are mocked: these tests check the app's handling of each answer, not
// the real iOS/Android permission dialogs.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import SetupRoute from '../app/setup';
import { useAuthStore } from '../src/stores/authStore';
import { useSetupStore } from '../src/stores/setupStore';
import { useUserStore } from '../src/stores/userStore';

jest.mock('../src/lib/supabase', () => ({ supabase: {} }));
jest.mock('../src/components/navigation/RouteGate', () => ({
  RouteGate: ({ children }: { children: React.ReactNode }) => children,
}));

const mockPerm = {
  notification: jest.fn(),
  requestNotification: jest.fn(),
  location: jest.fn(),
  requestLocation: jest.fn(),
  suggest: jest.fn(),
  openSettings: jest.fn(async () => {}),
};
jest.mock('../src/services/permissions', () => ({
  getNotificationPermission: () => mockPerm.notification(),
  requestNotificationPermission: () => mockPerm.requestNotification(),
  getLocationPermission: () => mockPerm.location(),
  requestLocationPermission: () => mockPerm.requestLocation(),
  suggestDeliveryAddress: () => mockPerm.suggest(),
  openAppSettings: () => mockPerm.openSettings(),
}));
// Served cities as the server would list them (delivery_zones).
const mockServed: { list: string[] | null } = { list: ['casablanca'] };
jest.mock('../src/delivery/cities', () => ({
  ...jest.requireActual('../src/delivery/cities'),
  fetchServedCities: async () => mockServed.list,
}));
const mockPush = { register: jest.fn(async () => 'ExponentPushToken[x]'), save: jest.fn(async () => {}) };
jest.mock('../src/services/notificationService', () => ({
  notificationService: {
    registerForPushNotificationsAsync: () => mockPush.register(),
    savePushToken: (...a: any[]) => (mockPush.save as any)(...a),
  },
}));

const saveDeliveryAddress = jest.fn();
const markDone = jest.fn(async () => {});

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ user: { id: 'u1' } as any });
  useUserStore.setState({ profile: { id: 'p1', user_id: 'u1', delivery_address: null } as any, saveDeliveryAddress });
  useSetupStore.setState({ markDone });
  saveDeliveryAddress.mockResolvedValue({ ok: true, profile: {} });
  mockPerm.notification.mockResolvedValue('undetermined');
  mockPerm.location.mockResolvedValue('undetermined');
  mockServed.list = ['casablanca'];
});

async function toLocationStep() {
  await render(<SetupRoute />);
  await waitFor(() => expect(screen.getByText('Plus tard')).toBeTruthy());
  await fireEvent.press(screen.getByText('Plus tard'));
  await waitFor(() => expect(screen.getByText('Où livrer vos repas ?')).toBeTruthy());
}

describe('notifications step', () => {
  it('explains the benefits before asking, and asks only on tap', async () => {
    await render(<SetupRoute />);
    await waitFor(() => expect(screen.getByText('Activer les notifications')).toBeTruthy());
    expect(screen.getByText('Départ du livreur et livraison')).toBeTruthy();
    expect(mockPerm.requestNotification).not.toHaveBeenCalled();
  });

  it('registers the push token when granted and moves on', async () => {
    mockPerm.requestNotification.mockResolvedValue('granted');
    await render(<SetupRoute />);
    await waitFor(() => expect(screen.getByText('Activer les notifications')).toBeTruthy());
    await fireEvent.press(screen.getByText('Activer les notifications'));
    await waitFor(() => expect(screen.getByText('Où livrer vos repas ?')).toBeTruthy());
    expect(mockPush.save).toHaveBeenCalledWith('u1', 'ExponentPushToken[x]', 'customer');
  });

  it('on denial explains how to enable later and lets the user continue', async () => {
    mockPerm.requestNotification.mockResolvedValue('blocked');
    await render(<SetupRoute />);
    await waitFor(() => expect(screen.getByText('Activer les notifications')).toBeTruthy());
    await fireEvent.press(screen.getByText('Activer les notifications'));
    await waitFor(() => expect(screen.getByText(/Réglages du téléphone › L’OPTION › Notifications/)).toBeTruthy());
    expect(mockPerm.requestNotification).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Réessayer')).toBeNull(); // the OS will not prompt again
    await fireEvent.press(screen.getByText('Ouvrir les réglages'));
    expect(mockPerm.openSettings).toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Continuer sans notifications'));
    await waitFor(() => expect(screen.getByText('Où livrer vos repas ?')).toBeTruthy());
  });

  it('does not prompt again when permission was previously denied', async () => {
    mockPerm.notification.mockResolvedValue('blocked');
    await render(<SetupRoute />);
    await waitFor(() => expect(screen.getByText('Continuer sans notifications')).toBeTruthy());
    expect(screen.queryByText('Activer les notifications')).toBeNull();
    expect(mockPerm.requestNotification).not.toHaveBeenCalled();
  });

  it('skips the step when already granted', async () => {
    mockPerm.notification.mockResolvedValue('granted');
    await render(<SetupRoute />);
    await waitFor(() => expect(screen.getByText('Où livrer vos repas ?')).toBeTruthy());
    expect(mockPerm.requestNotification).not.toHaveBeenCalled();
  });
});

describe('location step', () => {
  it('falls back to manual address entry when location is denied, and saves the typed address', async () => {
    mockPerm.requestLocation.mockResolvedValue('denied');
    await toLocationStep();
    await fireEvent.press(screen.getByText('Autoriser la localisation'));
    await waitFor(() => expect(screen.getByText('Votre adresse de livraison')).toBeTruthy());
    expect(mockPerm.suggest).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText('Adresse'), '12 Rue Exemple, Maarif, Casablanca');
    await fireEvent.press(screen.getByText('Enregistrer l’adresse'));
    // The city typed last in the address is recognised and sent with it.
    await waitFor(() => expect(saveDeliveryAddress).toHaveBeenCalledWith('u1', '12 Rue Exemple, Maarif, Casablanca', null, 'casablanca'));
    expect(markDone).toHaveBeenCalledWith('u1');
  });

  it('never treats a granted permission as a saved address: the suggestion must be confirmed', async () => {
    mockPerm.requestLocation.mockResolvedValue('granted');
    mockPerm.suggest.mockResolvedValue({ kind: 'found', address: 'Bd Anfa, Casablanca', latitude: 33.59, longitude: -7.63 });
    await toLocationStep();
    await fireEvent.press(screen.getByText('Autoriser la localisation'));
    await waitFor(() => expect(screen.getByLabelText('Adresse').props.value).toBe('Bd Anfa, Casablanca'));
    expect(saveDeliveryAddress).not.toHaveBeenCalled();
    expect(markDone).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Enregistrer l’adresse'));
    await waitFor(() =>
      expect(saveDeliveryAddress).toHaveBeenCalledWith('u1', 'Bd Anfa, Casablanca', { latitude: 33.59, longitude: -7.63 }, 'casablanca')
    );
  });

  it('outside Casablanca the address is saved and the customer is told delivery is not available in their city yet', async () => {
    mockPerm.requestLocation.mockResolvedValue('granted');
    mockPerm.suggest.mockResolvedValue({ kind: 'found', address: 'Av. Mohammed V', latitude: 34.02, longitude: -6.84, city: 'Rabat' });
    await toLocationStep();
    await fireEvent.press(screen.getByText('Autoriser la localisation'));
    await waitFor(() => expect(screen.getByLabelText('Adresse').props.value).toBe('Av. Mohammed V'));
    await fireEvent.press(screen.getByText('Enregistrer l’adresse'));
    await waitFor(() => expect(screen.getByText('Pas encore dans votre ville')).toBeTruthy());
    expect(saveDeliveryAddress).toHaveBeenCalledWith('u1', 'Av. Mohammed V', { latitude: 34.02, longitude: -6.84 }, 'rabat');
    expect(screen.getByText(/La livraison n’est pas encore disponible à Rabat/)).toBeTruthy();
    expect(markDone).not.toHaveBeenCalled(); // the customer reads the message first
    await fireEvent.press(screen.getByText('Continuer'));
    expect(markDone).toHaveBeenCalledWith('u1');
  });

  it('asks for the city when it cannot be recognised, and accepts it from the city chips', async () => {
    await toLocationStep();
    await fireEvent.press(screen.getByText('Saisir mon adresse'));
    await fireEvent.changeText(screen.getByLabelText('Adresse'), '12 Rue Exemple, Maarif');
    await fireEvent.press(screen.getByText('Enregistrer l’adresse'));
    expect(screen.getByText('Choisissez la ville de votre adresse.')).toBeTruthy();
    expect(saveDeliveryAddress).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Casablanca'));
    await fireEvent.press(screen.getByText('Enregistrer l’adresse'));
    await waitFor(() => expect(saveDeliveryAddress).toHaveBeenCalledWith('u1', '12 Rue Exemple, Maarif', null, 'casablanca'));
    expect(markDone).toHaveBeenCalledWith('u1'); // Casablanca is served: no message
  });

  it('handles a location error by asking for the address', async () => {
    mockPerm.requestLocation.mockResolvedValue('granted');
    mockPerm.suggest.mockResolvedValue({ kind: 'error' });
    await toLocationStep();
    await fireEvent.press(screen.getByText('Autoriser la localisation'));
    await waitFor(() => expect(screen.getByText(/n’a pas pu être déterminée/)).toBeTruthy());
  });

  it('validates the manual address and lets the user skip', async () => {
    await toLocationStep();
    await fireEvent.press(screen.getByText('Saisir mon adresse'));
    await fireEvent.changeText(screen.getByLabelText('Adresse'), 'abc');
    await fireEvent.press(screen.getByText('Enregistrer l’adresse'));
    expect(screen.getByText(/Saisissez une adresse de livraison complète/)).toBeTruthy();
    expect(saveDeliveryAddress).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Plus tard'));
    expect(markDone).toHaveBeenCalledWith('u1'); // declining never blocks the home screen
  });
});
