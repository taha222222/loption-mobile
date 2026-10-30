import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Switch, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../src/theme';
import {
  BrandButton,
  confirmAction,
  FormMessage,
  IconButton,
  OptionCard,
  Screen,
  ScreenHeader,
  SectionHeader,
  SurfaceCard,
} from '../../src/components/v2';
import { formatDistance, formatDuration, formatPace, paceSecondsPerKm, speedKmh } from '../../src/activity/gps';
import { KIND_ICON, KIND_LABEL } from '../../src/activity/labels';
import type { WorkoutKind } from '../../src/activity/types';
import { activeSeconds, KINDS_WITH_DISTANCE } from '../../src/activity/workoutSession';
import { requestWorkoutGps, watchWorkoutLocation } from '../../src/activity/workoutGps';
import { useWorkoutStore } from '../../src/stores/workoutStore';

const KINDS: WorkoutKind[] = ['walk', 'run', 'cycle', 'gym'];
const HEARTBEAT_MS = 15_000;

const timeOf = (iso: string) => new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

// Record a walk, run, ride or gym session. Time comes from timestamps, so
// it stays right in the background; GPS distance is measured only while
// this screen is open and only if the customer chose it for this session.
export default function WorkoutScreen() {
  const params = useLocalSearchParams<{ kind?: string }>();
  const initialKind = KINDS.includes(params.kind as WorkoutKind) ? (params.kind as WorkoutKind) : 'walk';
  const { active, notice, start, pause, resume, beat, addPoint, finish, discard } = useWorkoutStore();
  const [kind, setKind] = useState<WorkoutKind>(initialKind);
  const [useGps, setUseGps] = useState(true);
  const [gpsState, setGpsState] = useState<'off' | 'on' | 'denied' | 'error'>('off');
  const [now, setNow] = useState(() => new Date());
  const [message, setMessage] = useState<{ title: string; text: string; tone: 'error' | 'info' } | null>(null);
  const [saving, setSaving] = useState(false);
  const stopGps = useRef<null | (() => void)>(null);

  const running = active?.status === 'running';
  const wantsGps = !!active?.gps.enabled;

  // Display clock and heartbeat while running.
  useEffect(() => {
    if (!running) return;
    const tick = setInterval(() => setNow(new Date()), 1000);
    const hb = setInterval(beat, HEARTBEAT_MS);
    const sub = AppState.addEventListener('change', () => beat());
    return () => {
      clearInterval(tick);
      clearInterval(hb);
      sub.remove();
    };
  }, [running, beat]);

  // GPS subscription: only for a running session that asked for it, only
  // while this screen is mounted (foreground).
  useEffect(() => {
    if (!running || !wantsGps) return;
    let cancelled = false;
    (async () => {
      try {
        const stop = await watchWorkoutLocation(addPoint);
        if (cancelled) stop();
        else {
          stopGps.current = stop;
          setGpsState('on');
        }
      } catch {
        if (!cancelled) setGpsState('error');
      }
    })();
    return () => {
      cancelled = true;
      stopGps.current?.();
      stopGps.current = null;
    };
  }, [running, wantsGps, addPoint]);

  const onStart = async () => {
    setMessage(null);
    let gps = useGps && KINDS_WITH_DISTANCE.includes(kind);
    if (gps) {
      const permission = await requestWorkoutGps();
      if (permission !== 'granted') {
        gps = false;
        setGpsState('denied');
        setMessage({
          title: 'GPS non autorisé',
          text: 'La séance démarre sans distance. Vous pouvez autoriser la localisation dans les réglages du téléphone.',
          tone: 'info',
        });
      }
    }
    setNow(new Date());
    const r = start(kind, { gps });
    if (!r.ok) setMessage({ title: 'Séance en cours', text: 'Terminez d’abord la séance en cours.', tone: 'error' });
  };

  const onFinish = useCallback(async () => {
    setSaving(true);
    const r = await finish();
    setSaving(false);
    if (!r.ok) {
      if (r.reason === 'too_short') {
        setMessage({ title: 'Séance trop courte', text: 'Une séance doit durer au moins une minute.', tone: 'error' });
      }
      return;
    }
    setGpsState('off');
    setMessage(
      r.uploaded
        ? { title: 'Séance enregistrée', text: 'Retrouvez-la dans votre historique.', tone: 'info' }
        : { title: 'Séance gardée sur l’appareil', text: 'Elle sera envoyée dès que la connexion revient.', tone: 'info' }
    );
  }, [finish]);

  const seconds = active ? activeSeconds(active, now) : 0;
  const distance = active?.gps.enabled ? active.gps.distanceM : null;
  const pace = active && (active.kind === 'walk' || active.kind === 'run') ? formatPace(paceSecondsPerKm(distance, seconds)) : null;
  const speed = active?.kind === 'cycle' ? speedKmh(distance, seconds) : null;

  return (
    <Screen scroll>
      <ScreenHeader
        title={active ? KIND_LABEL[active.kind] : 'Nouvelle séance'}
        subtitle="Activité"
        right={<IconButton icon="close" label="Fermer" onPress={() => router.back()} />}
      />

      {active ? (
        <>
          {active.interrupted ? (
            <View style={styles.section}>
              <FormMessage
                title="Séance interrompue"
                message={`L’application a été fermée pendant la séance. Le temps est arrêté à ${timeOf(active.lastSeenAt)} : reprenez ou terminez.`}
                tone="info"
              />
            </View>
          ) : null}

          <View style={styles.section}>
            <SurfaceCard style={styles.live}>
              <View style={styles.liveHeader}>
                <Ionicons name={KIND_ICON[active.kind] as any} size={20} color={theme.colors.brand} />
                <Text style={styles.liveState}>{running ? 'En cours' : 'En pause'}</Text>
              </View>
              <Text style={styles.timer} accessibilityLabel={`Durée ${formatDuration(seconds)}`}>
                {formatDuration(seconds)}
              </Text>
              {active.gps.enabled ? (
                <View style={styles.metrics}>
                  <Metric label="Distance (GPS)" value={formatDistance(distance) ?? '—'} />
                  {pace ? <Metric label="Allure" value={pace} /> : null}
                  {speed !== null ? <Metric label="Vitesse moyenne" value={`${String(speed).replace('.', ',')} km/h`} /> : null}
                </View>
              ) : (
                <Text style={styles.hint}>
                  {active.kind === 'gym'
                    ? 'Minuteur de séance. Les exercices ne sont pas détectés automatiquement.'
                    : 'Sans GPS : seule la durée est enregistrée.'}
                </Text>
              )}
              {active.gps.enabled ? (
                <Text style={styles.hint}>
                  {gpsState === 'error'
                    ? 'GPS indisponible pour le moment.'
                    : 'La distance est mesurée quand cet écran est ouvert ; elle n’est pas estimée pendant les interruptions.'}
                </Text>
              ) : null}
            </SurfaceCard>
          </View>

          <View style={[styles.section, styles.controls]}>
            {running ? (
              <BrandButton title="Pause" variant="soft" onPress={pause} style={styles.control} />
            ) : (
              <BrandButton title="Reprendre" variant="soft" onPress={resume} style={styles.control} />
            )}
            <BrandButton title="Terminer" onPress={onFinish} loading={saving} style={styles.control} />
          </View>
          <View style={styles.section}>
            <BrandButton
              title="Abandonner la séance"
              variant="soft"
              onPress={() => confirmAction('Abandonner la séance ?', 'Elle ne sera pas enregistrée.', 'Abandonner', discard)}
            />
          </View>
        </>
      ) : (
        <>
          <View style={styles.section}>
            <SectionHeader inset={false} title="Type de séance" />
            {KINDS.map((k) => (
              <OptionCard key={k} title={KIND_LABEL[k]} icon={KIND_ICON[k] as any} selected={kind === k} onPress={() => setKind(k)} />
            ))}
          </View>
          {KINDS_WITH_DISTANCE.includes(kind) ? (
            <View style={styles.section}>
              <SurfaceCard style={styles.toggle}>
                <View style={styles.toggleText}>
                  <Text style={styles.toggleLabel}>Mesurer la distance avec le GPS</Text>
                  <Text style={styles.hint}>
                    Uniquement pendant cette séance, écran ouvert. Le trajet n’est pas conservé : seule la distance est enregistrée.
                  </Text>
                </View>
                <Switch
                  value={useGps}
                  onValueChange={setUseGps}
                  accessibilityLabel="Mesurer la distance avec le GPS"
                  trackColor={{ true: theme.colors.brand, false: theme.colors.hairline }}
                />
              </SurfaceCard>
            </View>
          ) : null}
          <View style={styles.section}>
            <BrandButton title={`Démarrer · ${KIND_LABEL[kind]}`} onPress={onStart} />
            <Text style={styles.hint}>
              Les calories d’une séance enregistrée ici sont une estimation (MET × poids × durée), calculée par le serveur.
            </Text>
          </View>
        </>
      )}

      {message || notice ? (
        <View style={styles.section}>
          {message ? <FormMessage title={message.title} message={message.text} tone={message.tone} /> : null}
          {notice ? <FormMessage title="Séances" message={notice} tone="info" /> : null}
        </View>
      ) : null}

      <View style={styles.section}>
        <BrandButton title="Historique des séances" variant="soft" onPress={() => router.push('/(app)/workout-history')} />
      </View>
    </Screen>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  live: {
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing['2xl'],
  },
  liveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  liveState: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.inkMuted,
  },
  timer: {
    fontSize: theme.typography.sizes.display,
    lineHeight: theme.typography.lineHeights.display,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
  },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: theme.spacing.xl,
  },
  metric: {
    alignItems: 'center',
  },
  metricValue: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.ink,
    fontVariant: ['tabular-nums'],
  },
  metricLabel: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.inkMuted,
  },
  hint: {
    fontSize: theme.typography.sizes.xs,
    lineHeight: theme.typography.lineHeights.xs,
    color: theme.colors.inkMuted,
    textAlign: 'left',
  },
  controls: {
    flexDirection: 'row',
  },
  control: {
    flex: 1,
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  toggleText: {
    flex: 1,
    gap: 2,
  },
  toggleLabel: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.ink,
  },
});
