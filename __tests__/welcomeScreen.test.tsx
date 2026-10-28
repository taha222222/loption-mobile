// Sign-in options with no provider credentials configured (the current
// state): the app must start, show every option, and explain unconfigured
// providers instead of crashing. E-mail stays available.
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import WelcomeScreen from '../app/(auth)/welcome';
import { FirstOrderOfferBanner } from '../src/components/v2';

jest.mock('../src/lib/supabase', () => ({ supabase: { auth: {} } }));
const mockRouter = { push: jest.fn(), replace: jest.fn(), canGoBack: () => true, back: jest.fn() };
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
}));
const mockSettings = jest.fn();
jest.mock('../src/services/authProviders', () => ({ fetchAuthProviderSettings: () => mockSettings() }));
const mockFlows = { google: jest.fn(), apple: jest.fn() };
jest.mock('../src/services/authFlows', () => ({
  ...jest.requireActual('../src/services/authFlows'),
  signInWithGoogle: () => mockFlows.google(),
  signInWithApple: () => mockFlows.apple(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('welcome screen without provider credentials', () => {
  it('marks Google and Apple as not configured and explains on press, without starting a flow', async () => {
    mockSettings.mockResolvedValue({
      status: 'loaded',
      settings: { google: false, apple: false, email: true, mailerAutoconfirm: false },
    });
    await render(<WelcomeScreen />);
    await waitFor(() => expect(screen.getAllByText('Pas encore configuré')).toHaveLength(2));
    await fireEvent.press(screen.getByText('Continuer avec Google'));
    expect(Alert.alert).toHaveBeenCalledWith('Google n’est pas encore configuré', expect.any(String));
    expect(mockFlows.google).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Continuer avec Apple'));
    expect(Alert.alert).toHaveBeenCalledWith('Apple n’est pas encore configuré', expect.any(String));
    expect(mockFlows.apple).not.toHaveBeenCalled();
  });

  it('keeps e-mail sign-up and log-in available', async () => {
    mockSettings.mockResolvedValue({ status: 'unknown' });
    await render(<WelcomeScreen />);
    await fireEvent.press(screen.getByText('S’inscrire avec un e-mail'));
    expect(mockRouter.push).toHaveBeenCalledWith('/(auth)/signup');
    await fireEvent.press(screen.getByText(/Se connecter/));
    expect(mockRouter.push).toHaveBeenCalledWith('/(auth)/login');
  });

  it('when settings are unreachable, tries the provider and reports its outcome', async () => {
    mockSettings.mockResolvedValue({ status: 'unknown' });
    mockFlows.google.mockResolvedValue({ kind: 'not_configured', provider: 'google' });
    await render(<WelcomeScreen />);
    await fireEvent.press(screen.getByText('Continuer avec Google'));
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Google n’est pas encore configuré', expect.any(String)));
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('a cancelled sign-in shows nothing and stays on the screen', async () => {
    mockSettings.mockResolvedValue({ status: 'loaded', settings: { google: true, apple: true, email: true, mailerAutoconfirm: false } });
    mockFlows.google.mockResolvedValue({ kind: 'cancelled' });
    await render(<WelcomeScreen />);
    await fireEvent.press(screen.getByText('Continuer avec Google'));
    await waitFor(() => expect(mockFlows.google).toHaveBeenCalled());
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});

describe('first-order offer banner', () => {
  it('shows the free delivery offer only to eligible customers', async () => {
    await render(<FirstOrderOfferBanner status="eligible" />);
    expect(screen.getByText('Livraison offerte sur votre première commande !')).toBeTruthy();
  });

  it.each(['not_eligible', 'unavailable', null, undefined] as const)('shows nothing for %s', async (status) => {
    await render(<FirstOrderOfferBanner status={status} />);
    expect(screen.queryByText(/Livraison offerte/)).toBeNull();
  });

  it('confirms when the offer has been applied', async () => {
    await render(<FirstOrderOfferBanner status="applied" />);
    expect(screen.getByText('Livraison offerte appliquée à votre première commande.')).toBeTruthy();
  });
});
