// src/stores/onboardingDraft.ts
// Unsaved onboarding answers, kept on this device per account so the flow
// resumes where the customer left it if the app closes. Nothing here is
// trusted or sent anywhere: the answers are validated and stored on the
// server only when the customer finishes the last step. The draft holds
// health data, so it is removed on completion and when the account signs
// out of this device.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ActivityLevel, SexInput } from '../nutrition/energy';

export interface OnboardingDraft {
  step: number;
  showResult: boolean;
  sex: SexInput | null;
  ageText: string;
  weightText: string;
  heightText: string;
  activity: ActivityLevel | null;
}

const keyFor = (userId: string) => `loption.onboarding.draft.v1.${userId}`;
const SEX: readonly string[] = ['man', 'woman', 'unspecified'];
const ACTIVITY: readonly string[] = ['sedentary', 'light', 'moderate', 'active', 'very_active'];

export async function loadOnboardingDraft(userId: string): Promise<OnboardingDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (!raw) return null;
    const d = JSON.parse(raw);
    // Anything malformed is ignored rather than trusted.
    return {
      step: Number.isInteger(d.step) && d.step >= 0 && d.step <= 4 ? d.step : 0,
      showResult: d.showResult === true,
      sex: SEX.includes(d.sex) ? d.sex : null,
      ageText: typeof d.ageText === 'string' ? d.ageText.slice(0, 3) : '',
      weightText: typeof d.weightText === 'string' ? d.weightText.slice(0, 5) : '',
      heightText: typeof d.heightText === 'string' ? d.heightText.slice(0, 5) : '',
      activity: ACTIVITY.includes(d.activity) ? d.activity : null,
    };
  } catch {
    return null;
  }
}

export async function saveOnboardingDraft(userId: string, draft: OnboardingDraft): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(draft));
  } catch {
    // Not persisted: the flow still works, it just will not resume after a restart.
  }
}

export async function clearOnboardingDraft(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(keyFor(userId));
  } catch {
    // Best effort.
  }
}
