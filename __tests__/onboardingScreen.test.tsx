import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import OnboardingRoute from '../app/onboarding';
import { useAuthStore } from '../src/stores/authStore';
import { useUserStore } from '../src/stores/userStore';

jest.mock('../src/lib/supabase', () => ({ supabase: {} }));
jest.mock('../src/components/navigation/RouteGate', () => ({
  RouteGate: ({ children }: { children: React.ReactNode }) => children,
}));

const saveOnboardingAnswers = jest.fn();
const completeOnboarding = jest.fn();

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
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
const DRAFT_KEY = 'loption.onboarding.draft.v1.u1';

// Renders the real route and waits for the device draft lookup to finish.
async function renderOnboarding() {
  await render(<OnboardingRoute />);
  await screen.findByText(/Étape \d sur 5/);
}

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
    await renderOnboarding();
    expect(screen.getByText('Étape 1 sur 5')).toBeTruthy();
    await next();
    expect(screen.getByText('Choisissez une option pour continuer.')).toBeTruthy();
    expect(screen.getByText('Étape 1 sur 5')).toBeTruthy();
  });

  it('shows clear validation messages for missing and invalid values', async () => {
    await renderOnboarding();
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
    await renderOnboarding();
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
    await renderOnboarding();
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
    await renderOnboarding();
    await answerAll();
    await fireEvent.press(screen.getByText('Calculer mon estimation'));
    await waitFor(() => expect(screen.getByText('Enregistrement impossible.')).toBeTruthy());
    await fireEvent.press(screen.getByText('Réessayer'));
    await waitFor(() => expect(screen.getByText('Votre estimation')).toBeTruthy());
    expect(saveOnboardingAnswers).toHaveBeenCalledTimes(2);
  });

  it('does not show an estimate when the sex input is unspecified', async () => {
    saveOnboardingAnswers.mockImplementation(async () => ({ ok: true, profile: {} }));
    await renderOnboarding();
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

  it('restores a draft after the app was closed (same step, same answers)', async () => {
    await AsyncStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ step: 2, showResult: false, sex: 'woman', ageText: '41', weightText: '68,5', heightText: '', activity: null })
    );
    await renderOnboarding();
    expect(screen.getByText('Étape 3 sur 5')).toBeTruthy();
    expect(screen.getByLabelText('Poids').props.value).toBe('68,5');
    await fireEvent.press(screen.getByLabelText('Étape précédente'));
    expect(screen.getByLabelText('Âge').props.value).toBe('41');
  });

  it('saves the draft on this device as the customer answers', async () => {
    await renderOnboarding();
    await fireEvent.press(screen.getByText('Femme'));
    await next();
    await fireEvent.changeText(screen.getByLabelText('Âge'), '29');
    await waitFor(async () => {
      const draft = JSON.parse((await AsyncStorage.getItem(DRAFT_KEY)) ?? '{}');
      expect(draft).toMatchObject({ step: 1, sex: 'woman', ageText: '29' });
    });
  });

  it('ignores a malformed draft instead of trusting it', async () => {
    await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify({ step: 99, sex: 'robot', ageText: 12345, activity: 'couch' }));
    await renderOnboarding();
    expect(screen.getByText('Étape 1 sur 5')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Femme' }).props.accessibilityState).toMatchObject({ selected: false });
  });

  it('removes the draft once completion is saved on the server', async () => {
    await renderOnboarding();
    await answerAll();
    await fireEvent.press(screen.getByText('Calculer mon estimation'));
    await waitFor(() => expect(screen.getByText('Votre estimation')).toBeTruthy());
    expect(await AsyncStorage.getItem(DRAFT_KEY)).not.toBeNull();
    await fireEvent.press(screen.getByText('Continuer'));
    await waitFor(async () => expect(await AsyncStorage.getItem(DRAFT_KEY)).toBeNull());
  });

  it('keeps the draft when completion fails, so nothing is lost', async () => {
    completeOnboarding.mockResolvedValueOnce({ ok: false, message: 'Enregistrement impossible.' });
    await renderOnboarding();
    await answerAll();
    await fireEvent.press(screen.getByText('Calculer mon estimation'));
    await waitFor(() => expect(screen.getByText('Votre estimation')).toBeTruthy());
    await fireEvent.press(screen.getByText('Continuer'));
    await waitFor(() => expect(screen.getByText('Enregistrement impossible.')).toBeTruthy());
    expect(await AsyncStorage.getItem(DRAFT_KEY)).not.toBeNull();
  });
});
