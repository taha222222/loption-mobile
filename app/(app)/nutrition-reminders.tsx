import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../src/theme';
import { BrandButton, FormMessage, Screen, ScreenHeader, SectionHeader, Stepper, SurfaceCard } from '../../src/components/v2';
import { deviceTimeZone } from '../../src/nutrition/dates';
import { reminderTimesProblem, shiftTime } from '../../src/nutrition/reminders';
import {
  DEFAULT_PREFERENCES,
  fetchPreferences,
  NotificationPreferences,
  savePreferences,
} from '../../src/services/nutritionApi';
import { notificationService } from '../../src/services/notificationService';
import {
  getNotificationPermission,
  openAppSettings,
  PermissionState,
  requestNotificationPermission,
} from '../../src/services/permissions';
import { useAuthStore } from '../../src/stores/authStore';

function loadSettings() {
  return Promise.all([fetchPreferences(), getNotificationPermission()]).then(([prefs, permission]) => ({ prefs, permission }));
}

type TimeKey = 'daily_time' | 'progress_time' | 'evening_time' | 'quiet_start' | 'quiet_end';

// Opt-in tracking reminders. Off by default; sent by the server at the
// customer's local times, never during quiet hours, at most 2 per day.
export default function NutritionRemindersScreen() {
  const user = useAuthStore((s) => s.user);
  const role = useAuthStore((s) => s.role);
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ title: string; text: string; tone: 'error' | 'info' } | null>(null);

  const apply = (r: Awaited<ReturnType<typeof loadSettings>>) => {
    setPermission(r.permission);
    setLoadError(!!r.prefs.error);
    if (r.prefs.error) return;
    setPrefs(r.prefs.data ?? { ...DEFAULT_PREFERENCES, time_zone: deviceTimeZone() });
  };
  const load = () => loadSettings().then(apply);

  useEffect(() => {
    let active = true;
    loadSettings().then((r) => active && apply(r));
    return () => {
      active = false;
    };
  }, []);

  const update = (patch: Partial<NotificationPreferences>) => {
    setMessage(null);
    setPrefs((p) => (p ? { ...p, ...patch } : p));
  };

  const askPermission = async () => {
    const result = await requestNotificationPermission();
    setPermission(result);
    if (result === 'granted' && user && role) await notificationService.registerPushTokenIfPermitted(user.id, role);
  };

  const save = async () => {
    if (!prefs) return;
    const problem = reminderTimesProblem(prefs);
    if (problem) {
      setMessage({ title: 'Horaires à corriger', text: problem, tone: 'error' });
      return;
    }
    setSaving(true);
    const result = await savePreferences({ ...prefs, time_zone: deviceTimeZone() });
    setSaving(false);
    setMessage(
      result.error
        ? { title: 'Non enregistré', text: 'Vérifiez votre connexion et réessayez.', tone: 'error' }
        : {
            title: 'Préférences enregistrées',
            text: prefs.reminders_enabled
              ? permission === 'granted'
                ? 'Vos rappels sont programmés selon votre fuseau horaire.'
                : 'Activez les notifications de l’appareil pour recevoir vos rappels.'
              : 'Les rappels sont désactivés.',
            tone: 'info',
          }
    );
  };

  const timeStepper = (key: TimeKey, label: string) =>
    prefs ? (
      <Stepper
        label={label}
        value={prefs[key]}
        canDecrease
        canIncrease
        onDecrease={() => update({ [key]: shiftTime(prefs[key], -15) } as Partial<NotificationPreferences>)}
        onIncrease={() => update({ [key]: shiftTime(prefs[key], 15) } as Partial<NotificationPreferences>)}
      />
    ) : null;

  if (!prefs && !loadError) {
    return (
      <Screen contentStyle={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.brand} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <ScreenHeader
        title="Rappels"
        subtitle="Suivi nutritionnel"
        right={
          <TouchableOpacity onPress={() => router.back()} style={styles.close} accessibilityRole="button" accessibilityLabel="Fermer">
            <Ionicons name="close" size={22} color={theme.colors.ink} />
          </TouchableOpacity>
        }
      />
      {loadError ? (
        <View style={styles.section}>
          <FormMessage title="Préférences indisponibles" message="Vérifiez votre connexion." actionLabel="Réessayer" onAction={load} />
        </View>
      ) : null}

      {prefs ? (
        <>
          <View style={styles.section}>
            <SurfaceCard style={styles.card}>
              <ToggleRow
                label="Recevoir des rappels de suivi"
                hint="Au plus 2 par jour, jamais pendant vos heures de silence. Désactivable à tout moment."
                value={prefs.reminders_enabled}
                onChange={(v) => update({ reminders_enabled: v })}
              />
            </SurfaceCard>
            {prefs.reminders_enabled && permission !== 'granted' ? (
              permission === 'blocked' || permission === 'denied' ? (
                <FormMessage
                  title="Notifications désactivées sur l’appareil"
                  message="Pour recevoir les rappels : Réglages du téléphone › L’OPTION › Notifications."
                  actionLabel="Ouvrir les réglages"
                  onAction={openAppSettings}
                />
              ) : (
                <FormMessage
                  title="Autorisation nécessaire"
                  message="Les rappels arrivent sous forme de notifications. Vous pouvez refuser : l’application reste utilisable."
                  tone="info"
                  actionLabel="Autoriser les notifications"
                  onAction={askPermission}
                />
              )
            ) : null}
          </View>

          {prefs.reminders_enabled ? (
            <>
              <View style={styles.section}>
                <SectionHeader inset={false} title="Rappels" />
                <SurfaceCard style={styles.card}>
                  <ToggleRow
                    label="Objectif du jour"
                    hint="« Votre objectif du jour est prêt »"
                    value={prefs.daily_target_enabled}
                    onChange={(v) => update({ daily_target_enabled: v })}
                  />
                  {prefs.daily_target_enabled ? timeStepper('daily_time', 'Heure') : null}
                  <ToggleRow
                    label="Progression"
                    hint="Seulement si vous avez enregistré des repas ce jour-là."
                    value={prefs.progress_enabled}
                    onChange={(v) => update({ progress_enabled: v })}
                  />
                  {prefs.progress_enabled ? timeStepper('progress_time', 'Heure') : null}
                  <ToggleRow
                    label="Rappel du soir"
                    hint="Seulement si rien n’est enregistré ce jour-là."
                    value={prefs.evening_enabled}
                    onChange={(v) => update({ evening_enabled: v })}
                  />
                  {prefs.evening_enabled ? timeStepper('evening_time', 'Heure') : null}
                  <ToggleRow
                    label="Paliers de régularité"
                    hint="7, 14, 30 jours de suivi d’affilée."
                    value={prefs.milestones_enabled}
                    onChange={(v) => update({ milestones_enabled: v })}
                  />
                  <ToggleRow
                    label="Relance si inactif"
                    hint="Après 3 jours sans saisie ; au plus 2 par mois, 7 jours d’intervalle."
                    value={prefs.reengagement_enabled}
                    onChange={(v) => update({ reengagement_enabled: v })}
                  />
                </SurfaceCard>
              </View>
              <View style={styles.section}>
                <SectionHeader inset={false} title="Heures de silence" />
                <SurfaceCard style={styles.card}>
                  {timeStepper('quiet_start', 'Début')}
                  {timeStepper('quiet_end', 'Fin')}
                </SurfaceCard>
                <Text style={styles.note}>{`Fuseau horaire : ${deviceTimeZone()}`}</Text>
              </View>
            </>
          ) : null}

          <View style={styles.section}>
            {message ? <FormMessage title={message.title} message={message.text} tone={message.tone} /> : null}
            <BrandButton title="Enregistrer" onPress={save} loading={saving} />
          </View>
        </>
      ) : null}
    </Screen>
  );
}

function ToggleRow({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.toggle}>
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ true: theme.colors.brand, false: theme.colors.hairline }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  close: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
  },
  section: {
    paddingHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  card: {
    gap: theme.spacing.sm,
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  toggleText: {
    flex: 1,
  },
  toggleLabel: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.ink,
  },
  toggleHint: {
    fontSize: theme.typography.sizes.xs,
    lineHeight: theme.typography.lineHeights.xs,
    color: theme.colors.inkMuted,
  },
  note: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.inkMuted,
  },
});
