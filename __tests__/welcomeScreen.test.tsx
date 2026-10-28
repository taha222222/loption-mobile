// Sign-in options with no provider credentials configured (the current
// state): the app must start, show every option, and explain unconfigured
// providers instead of crashing. E-mail stays available.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import WelcomeScreen from '../app/(auth)/welcome';
import SignupScreen from '../app/(auth)/signup';
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
const mockFlows = { google: jest.fn(), apple: jest.fn(), signUp: jest.fn() };
jest.mock('../src/services/authFlows', () => ({
  ...jest.requireActual('../src/services/authFlows'),
  signInWithGoogle: () => mockFlows.google(),
  signInWithApple: () => mockFlows.apple(),
  signUpWithEmail: (...a: any[]) => (mockFlows.signUp as any)(...a),
}));

beforeEach(() => {
  jest.clearAllMocks();
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
    expect(screen.getByText('Google n’est pas encore configuré')).toBeTruthy();
    expect(mockFlows.google).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Continuer avec Apple'));
    expect(screen.getByText('Apple n’est pas encore configuré')).toBeTruthy();
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
    await waitFor(() => expect(screen.getByText('Google n’est pas encore configuré')).toBeTruthy());
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('a cancelled sign-in shows nothing and stays on the screen', async () => {
    mockSettings.mockResolvedValue({ status: 'loaded', settings: { google: true, apple: true, email: true, mailerAutoconfirm: false } });
    mockFlows.google.mockResolvedValue({ kind: 'cancelled' });
    await render(<WelcomeScreen />);
    await fireEvent.press(screen.getByText('Continuer avec Google'));
    await waitFor(() => expect(mockFlows.google).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
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

describe('e-mail sign-up screen', () => {
  async function submit() {
    await render(<SignupScreen />);
    await fireEvent.changeText(screen.getByLabelText('E-mail'), 'client@exemple.ma');
    await fireEvent.changeText(screen.getByLabelText('Mot de passe'), 'secret123');
    await fireEvent.changeText(screen.getByLabelText('Confirmer le mot de passe'), 'secret123');
    await fireEvent.press(screen.getByText('Créer mon compte'));
  }

  it('says no e-mail was sent and stays on the form when delivery is not configured', async () => {
    mockFlows.signUp.mockResolvedValue({ kind: 'email_delivery_unavailable' });
    await submit();
    await waitFor(() => expect(screen.getByText('E-mail non envoyé')).toBeTruthy());
    expect(screen.getByText(/Aucun e-mail n’a été envoyé/)).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('goes to the verification screen only when the server accepted the request', async () => {
    mockFlows.signUp.mockResolvedValue({ kind: 'verification_sent', email: 'client@exemple.ma' });
    await submit();
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith({
        pathname: '/(auth)/verify-email',
        params: { email: 'client@exemple.ma', sent: '1' },
      })
    );
  });

  it('validates the form before calling the server', async () => {
    await render(<SignupScreen />);
    await fireEvent.changeText(screen.getByLabelText('E-mail'), 'pas-un-email');
    await fireEvent.changeText(screen.getByLabelText('Mot de passe'), 'court');
    await fireEvent.press(screen.getByText('Créer mon compte'));
    expect(screen.getByText('Cette adresse e-mail n’est pas valide.')).toBeTruthy();
    expect(screen.getByText(/au moins 8 caractères/)).toBeTruthy();
    expect(screen.getByText('Les mots de passe ne correspondent pas.')).toBeTruthy();
    expect(mockFlows.signUp).not.toHaveBeenCalled();
  });
});
