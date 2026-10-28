import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import OnboardingRoute from '../app/onboarding';
import { useAuthStore } from '../src/stores/authStore';
import { useUserStore } from '../src/stores/userStore';

jest.mock('../src/lib/supabase', () => ({ supabase: {} }));
jest.mock('../src/components/navigation/RouteGate', () => ({
  RouteGate: ({ children }: { children: React.ReactNode }) => children,
}));

const saveOnboardingAnswers = jest.fn();
const completeOnboarding = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ user: { id: 'u1' } as any });
  useUserStore.setState({
    profile: { id: 'p1', user_id: 'u1', onboarding_completed_at: null } as any,
    loadedUserId: 'u1',
    profileStatus: 'loaded',
    saveOnboardingAnswers,
    completeOnboarding,
  });
  saveOnboardingAnswers.mockImplementation(async () => {
    const profile = { ...useUserStore.getState().profile!, bmr_kcal: 1649, tdee_kcal: 2556 };
    useUserStore.setState({ profile });
    return { ok: true, profile };
  });
  completeOnboarding.mockResolvedValue({ ok: true, profile: {} });
});

const next = () => fireEvent.press(screen.getByText('Continuer'));

async function answerAll() {
  await fireEvent.press(screen.getByText('Homme'));
  await next();
  await fireEvent.changeText(screen.getByLabelText('Âge'), '30');
  await next();
  await fireEvent.changeText(screen.getByLabelText('Poids'), '70');
  await next();
  await fireEvent.changeText(screen.getByLabelText('Taille'), '175');
  await next();
  await fireEvent.press(screen.getByText('Modérément actif'));
}

describe('nutrition onboarding', () => {
  it('shows progress and blocks Continue until a choice is made', async () => {
    await render(<OnboardingRoute />);
    expect(screen.getByText('Étape 1 sur 5')).toBeTruthy();
    await next();
    expect(screen.getByText('Choisissez une option pour continuer.')).toBeTruthy();
    expect(screen.getByText('Étape 1 sur 5')).toBeTruthy();
  });

  it('shows clear validation messages for missing and invalid values', async () => {
    await render(<OnboardingRoute />);
    await fireEvent.press(screen.getByText('Femme'));
    await next();
    await next();
    expect(screen.getByText('Ce champ est obligatoire.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Âge'), '-4');
    expect(screen.getByText(/Saisissez un nombre/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Âge'), '8');
    expect(screen.getByText('Saisissez une valeur entre 13 et 100 ans.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Âge'), '29');
    await next();
    expect(screen.getByText('Étape 3 sur 5')).toBeTruthy();
    await next();
    await fireEvent.changeText(screen.getByLabelText('Poids'), '500');
    expect(screen.getByText('Saisissez une valeur entre 30 et 300 kg.')).toBeTruthy();
  });

  it('keeps answers when going back and forward', async () => {
    await render(<OnboardingRoute />);
    await fireEvent.press(screen.getByText('Homme'));
    await next();
    await fireEvent.changeText(screen.getByLabelText('Âge'), '41');
    await next();
    await fireEvent.press(screen.getByLabelText('Étape précédente'));
    expect(screen.getByLabelText('Âge').props.value).toBe('41');
    await fireEvent.press(screen.getByLabelText('Étape précédente'));
    expect(screen.getByRole('radio', { name: 'Homme' }).props.accessibilityState).toMatchObject({ selected: true });
  });

  it('saves only the answers, shows the server estimate as an estimate, then completes', async () => {
    await render(<OnboardingRoute />);
    await answerAll();
    await fireEvent.press(screen.getByText('Calculer mon estimation'));
    await waitFor(() => expect(screen.getByText('Votre estimation')).toBeTruthy());
    expect(saveOnboardingAnswers).toHaveBeenCalledWith('u1', {
      gender: 'man',
      age: 30,
      weight: 70,
      height: 175,
      activity_level: 'moderate',
    });
    expect(screen.getByText(/1\s649 kcal \/ jour/)).toBeTruthy();
    expect(screen.getByText(/2\s556 kcal \/ jour/)).toBeTruthy();
    expect(screen.getByText(/Ce n’est pas un avis médical/)).toBeTruthy();
    expect(completeOnboarding).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Continuer'));
    await waitFor(() => expect(completeOnboarding).toHaveBeenCalledWith('u1'));
  });

  it('shows a retryable error when saving fails, without losing answers', async () => {
    saveOnboardingAnswers.mockResolvedValueOnce({ ok: false, message: 'Enregistrement impossible.' });
    await render(<OnboardingRoute />);
    await answerAll();
    await fireEvent.press(screen.getByText('Calculer mon estimation'));
    await waitFor(() => expect(screen.getByText('Enregistrement impossible.')).toBeTruthy());
    await fireEvent.press(screen.getByText('Réessayer'));
    await waitFor(() => expect(screen.getByText('Votre estimation')).toBeTruthy());
    expect(saveOnboardingAnswers).toHaveBeenCalledTimes(2);
  });

  it('does not show an estimate when the sex input is unspecified', async () => {
    saveOnboardingAnswers.mockImplementation(async () => ({ ok: true, profile: {} }));
    await render(<OnboardingRoute />);
    await fireEvent.press(screen.getByText('Je préfère ne pas répondre'));
    await next();
    await fireEvent.changeText(screen.getByLabelText('Âge'), '30');
    await next();
    await fireEvent.changeText(screen.getByLabelText('Poids'), '70');
    await next();
    await fireEvent.changeText(screen.getByLabelText('Taille'), '175');
    await next();
    await fireEvent.press(screen.getByText('Sédentaire'));
    await fireEvent.press(screen.getByText('Calculer mon estimation'));
    await waitFor(() => expect(screen.getByText('Profil enregistré')).toBeTruthy());
    expect(screen.queryByText(/kcal \/ jour/)).toBeNull();
  });
});
