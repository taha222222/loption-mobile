import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { theme } from '../../src/theme';
import {
  ActivityIcon,
  BrandButton,
  confirmAction,
  FormMessage,
  IconButton,
  RouteSketch,
  Screen,
  ScreenHeader,
  SurfaceCard,
} from '../../src/components/v2';
import { GymLogger } from '../../src/components/workout/GymLogger';
import { formatDistance, formatDuration, formatPace, paceSecondsPerKm, speedKmh } from '../../src/activity/gps';
import { KIND_GLYPH, KIND_HINT, KIND_LABEL } from '../../src/activity/labels';
import type { WorkoutKind } from '../../src/activity/types';
import { activeSeconds, gpsSignal, KINDS_WITH_DISTANCE } from '../../src/activity/workoutSession';
import { requestWorkoutGps, watchWorkoutLocation } from '../../src/activity/workoutGps';
import { useWorkoutStore } from '../../src/stores/workoutStore';

const KINDS: WorkoutKind[] = ['walk', 'run', 'cycle', 'gym'];
const HEARTBEAT_MS = 15_000;
const DRAIN_MS = 4_000;

const timeOf = (iso: string) => new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

const SIGNAL_TEXT = {
  searching: 'Recherche du signal GPS…',
  weak: 'Signal GPS faible : la distance reprendra avec le signal.',
  lost: 'Localisation désactivée : la distance n’est plus mesurée.',
} as const;

// Record a walk, run, ride or gym session. Time comes from timestamps, so
// it stays right in the background. GPS runs only for a session that asked
// for it, from start to pause/finish/discard (screen off included where the
// build supports it); nothing is recorded outside a session.
export default function WorkoutScreen() {
  const params = useLocalSearchParams<{ kind?: string }>();
  const initialKind = KINDS.includes(params.kind as WorkoutKind) ? (params.kind as WorkoutKind) : 'walk';
  const store = useWorkoutStore();
  const { active, notice, gpsMode, lastSummary } = store;
  const [kind, setKind] = useState<WorkoutKind>(initialKind);
  const [useGps, setUseGps] = useState(true);
  const [explainGps, setExplainGps] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [message, setMessage] = useState<{ title: string; text: string; tone: 'error' | 'info' } | null>(null);
  const [saving, setSaving] = useState(false);
  const stopScreenGps = useRef<null | (() => void)>(null);

  const running = active?.status === 'running';
  const wantsGps = !!active?.gps.enabled && !active.gps.lost;

  // Display clock, heartbeat, GPS buffer and permission checks while running.
  useEffect(() => {
    if (!running) return;
    const tick = setInterval(() => setNow(new Date()), 1000);
    const hb = setInterval(store.beat, HEARTBEAT_MS);
    const drain = setInterval(() => void store.drainGps(), DRAIN_MS);
    const sub = AppState.addEventListener('change', (s) => {
      store.beat();
      if (s === 'active') {
        void store.drainGps();
        void store.checkGpsPermission();
      }
    });
    return () => {
      clearInterval(tick);
      clearInterval(hb);
      clearInterval(drain);
      sub.remove();
    };
  }, [running, store]);

  // Fallback without background location support: on-screen updates only.
  useEffect(() => {
    if (!running || !wantsGps || gpsMode !== 'screen') return;
    let cancelled = false;
    (async () => {
      try {
        const stop = await watchWorkoutLocation(store.addPoint);
        if (cancelled) stop();
        else stopScreenGps.current = stop;
      } catch {
        /* shown as a weak signal */
      }
    })();
    return () => {
      cancelled = true;
      stopScreenGps.current?.();
      stopScreenGps.current = null;
    };
  }, [running, wantsGps, gpsMode, store]);

  const begin = async (gps: boolean) => {
    setExplainGps(false);
    setMessage(null);
    let withGps = gps;
    if (withGps) {
      const permission = await requestWorkoutGps();
      if (permission !== 'granted') {
        withGps = false;
        setMessage({
          title: 'Séance sans GPS',
          text: 'La localisation n’est pas autorisée : seule la durée est enregistrée. Vous pouvez l’autoriser dans les réglages du téléphone.',
          tone: 'info',
        });
      }
    }
    setNow(new Date());
    const r = await store.start(kind, { gps: withGps });
    if (!r.ok) setMessage({ title: 'Séance en cours', text: 'Terminez d’abord la séance en cours.', tone: 'error' });
  };

  const onStart = () => {
    const gps = useGps && KINDS_WITH_DISTANCE.includes(kind);
    if (gps) setExplainGps(true); // explain before the system prompt
    else void begin(false);
  };

  const onFinish = useCallback(async () => {
    setSaving(true);
    const r = await store.finish();
    setSaving(false);
    if (!r.ok && r.reason === 'too_short') {
      setMessage({ title: 'Séance trop courte', text: 'Une séance doit durer au moins une minute. Reprenez-la ou abandonnez-la.', tone: 'error' });
    }
  }, [store]);

  // ------------------------------------------------------------ summary
  if (!active && lastSummary) {
    const s = lastSummary.session;
    const pace = s.kind === 'walk' || s.kind === 'run' ? formatPace(paceSecondsPerKm(s.distanceM, s.activeSeconds)) : null;
    const speed = s.kind === 'cycle' ? speedKmh(s.distanceM, s.activeSeconds) : null;
    const sets = s.gym?.reduce((n, e) => n + e.sets.length, 0) ?? 0;
    return (
      <Screen scroll>
        <ScreenHeader title="Bravo !" subtitle="Séance terminée" right={<IconButton icon="close" label="Fermer" onPress={() => router.back()} />} />
        <View style={styles.section}>
          <SurfaceCard style={styles.live}>
            <ActivityIcon name={KIND_GLYPH[s.kind]} size={84} />
            <Text style={styles.kindTitle}>{KIND_LABEL[s.kind]}</Text>
            <Text style={styles.timer}>{formatDuration(s.activeSeconds)}</Text>
            <Text style={styles.hint}>
              {timeOf(s.startedAt)} – {timeOf(s.endedAt)}
            </Text>
            <View style={styles.metrics}>
              {s.distanceM !== null ? <Metric label="Distance" value={formatDistance(s.distanceM) ?? '—'} /> : null}
              {pace ? <Metric label="Allure moyenne" value={pace} /> : null}
              {speed !== null ? <Metric label="Vitesse moyenne" value={`${String(speed).replace('.', ',')} km/h`} /> : null}
              {s.steps != null ? <Metric label="Pas" value={s.steps.toLocaleString('fr-FR')} /> : null}
              {s.kind === 'gym' ? <Metric label="Exercices" value={String(s.gym?.length ?? 0)} /> : null}
              {s.kind === 'gym' ? <Metric label="Séries" value={String(sets)} /> : null}
            </View>
          </SurfaceCard>
        </View>
        {lastSummary.route.length > 1 ? (
          <View style={styles.section}>
            <RouteSketch points={lastSummary.route} />
            <Text style={styles.hint}>Le tracé reste sur votre téléphone ; seule la distance est enregistrée.</Text>
          </View>
        ) : null}
        <View style={styles.section}>
          <FormMessage
            title={lastSummary.uploaded ? 'Séance enregistrée' : 'Séance gardée sur le téléphone'}
            message={
              lastSummary.uploaded
                ? 'Les calories de la séance sont estimées et ajoutées à votre bilan du jour.'
                : 'Elle sera envoyée automatiquement dès que la connexion revient.'
            }
            tone="info"
          />
          {notice ? <FormMessage title="Séances" message={notice} tone="info" /> : null}
          <BrandButton title="Voir mon bilan" onPress={() => router.replace('/(app)/tracking')} />
          <BrandButton title="Nouvelle séance" variant="soft" onPress={() => useWorkoutStore.setState({ lastSummary: null })} />
        </View>
      </Screen>
    );
  }

  // ------------------------------------------------------------ live
  if (active) {
    const seconds = activeSeconds(active, now);
    const distance = active.gps.enabled ? active.gps.distanceM : null;
    const pace = active.kind === 'walk' || active.kind === 'run' ? formatPace(paceSecondsPerKm(distance, seconds)) : null;
    const speed = active.kind === 'cycle' ? speedKmh(distance, seconds) : null;
    const signal = gpsSignal(active, now.getTime());
    return (
      <Screen scroll>
        <ScreenHeader
          title={KIND_LABEL[active.kind]}
          subtitle={running ? 'En cours' : 'En pause'}
          right={<IconButton icon="chevron-down" label="Réduire" onPress={() => router.back()} />}
        />
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
            <ActivityIcon name={KIND_GLYPH[active.kind]} size={72} />
            <Text style={styles.timer} accessibilityLabel={`Durée ${formatDuration(seconds)}`}>
              {formatDuration(seconds)}
            </Text>
            {active.gps.enabled ? (
              <View style={styles.metrics}>
                <Metric label="Distance" value={formatDistance(distance) ?? '—'} />
                {pace ? <Metric label="Allure" value={pace} /> : null}
                {speed !== null ? <Metric label="Vitesse" value={`${String(speed).replace('.', ',')} km/h`} /> : null}
              </View>
            ) : active.kind !== 'gym' ? (
              <Text style={styles.hint}>Sans GPS : la durée est enregistrée{active.kind === 'cycle' ? '' : ', et vos pas par le téléphone'}.</Text>
            ) : null}
            {signal === 'searching' || signal === 'weak' || signal === 'lost' ? (
              <Text style={[styles.signal, signal === 'lost' && styles.signalLost]}>{SIGNAL_TEXT[signal]}</Text>
            ) : null}
            {active.gps.enabled && gpsMode === 'screen' && running ? (
              <Text style={styles.hint}>Gardez cet écran ouvert : cette version de l’app ne mesure pas la distance écran verrouillé.</Text>
            ) : null}
          </SurfaceCard>
        </View>

        <View style={[styles.section, styles.controls]}>
          {running ? (
            <BrandButton title="Pause" variant="soft" onPress={() => void store.pause()} style={styles.control} />
          ) : (
            <BrandButton title="Reprendre" variant="soft" onPress={() => void store.resume()} style={styles.control} />
          )}
          <BrandButton title="Terminer" onPress={onFinish} loading={saving} style={styles.control} />
        </View>

        {active.kind === 'gym' && active.gym ? (
          <View style={styles.section}>
            <GymLogger
              intensity={active.gym.intensity}
              exercises={active.gym.exercises}
              onIntensity={store.setIntensity}
              onAddExercise={store.addExercise}
              onRemoveExercise={store.removeExercise}
              onAddSet={store.addSet}
              onRemoveLastSet={store.removeLastSet}
            />
          </View>
        ) : null}

        {message || notice ? (
          <View style={styles.section}>
            {message ? <FormMessage title={message.title} message={message.text} tone={message.tone} /> : null}
            {notice ? <FormMessage title="Séances" message={notice} tone="info" /> : null}
          </View>
        ) : null}

        <View style={styles.section}>
          <BrandButton
            title="Abandonner la séance"
            variant="soft"
            onPress={() => confirmAction('Abandonner la séance ?', 'Elle ne sera pas enregistrée.', 'Abandonner', () => void store.discard())}
          />
        </View>
      </Screen>
    );
  }

  // ------------------------------------------------------------ choose
  return (
    <Screen scroll>
      <ScreenHeader title="Nouvelle séance" subtitle="Activité" right={<IconButton icon="close" label="Fermer" onPress={() => router.back()} />} />
      <View style={styles.section}>
        <View style={styles.grid}>
          {KINDS.map((k) => (
            <TouchableOpacity
              key={k}
              accessibilityRole="button"
              accessibilityState={{ selected: kind === k }}
              accessibilityLabel={KIND_LABEL[k]}
              onPress={() => setKind(k)}
              style={[styles.tile, kind === k && styles.tileSelected]}
            >
              <ActivityIcon name={KIND_GLYPH[k]} size={64} />
              <Text style={styles.tileLabel}>{KIND_LABEL[k]}</Text>
              <Text style={styles.tileHint}>{KIND_HINT[k]}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {KINDS_WITH_DISTANCE.includes(kind) ? (
        <View style={styles.section}>
          <SurfaceCard style={styles.toggle}>
            <View style={styles.toggleText}>
              <Text style={styles.toggleLabel}>Mesurer la distance (GPS)</Text>
              <Text style={styles.hint}>Seulement pendant cette séance.</Text>
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

      {explainGps ? (
        <View style={styles.section}>
          <SurfaceCard style={styles.explain}>
            <ActivityIcon name="distance" size={48} />
            <Text style={styles.toggleLabel}>Pourquoi la localisation ?</Text>
            <Text style={styles.body}>
              Pour mesurer la distance et l’allure de cette séance, même écran verrouillé. Le GPS s’arrête dès que vous mettez en
              pause, terminez ou abandonnez. Votre tracé reste sur ce téléphone.
            </Text>
            <BrandButton title="Continuer" onPress={() => void begin(true)} />
            <BrandButton title="Démarrer sans GPS" variant="soft" onPress={() => void begin(false)} />
          </SurfaceCard>
        </View>
      ) : (
        <View style={styles.section}>
          <BrandButton title={`Démarrer · ${KIND_LABEL[kind]}`} onPress={onStart} />
          <Text style={styles.hint}>Les calories d’une séance sont une estimation selon l’effort, votre poids et la durée.</Text>
        </View>
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.xl,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 2,
    borderColor: theme.colors.hairline,
  },
  tileSelected: { borderColor: theme.colors.workout, backgroundColor: theme.colors.workoutSoft },
  tileLabel: { fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  tileHint: { fontSize: theme.typography.sizes.xs, color: theme.colors.inkMuted, textAlign: 'center' },
  live: { alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing['2xl'] },
  kindTitle: { fontSize: theme.typography.sizes.xl, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  timer: {
    fontSize: theme.typography.sizes.display,
    lineHeight: theme.typography.lineHeights.display,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
  },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: theme.spacing.xl },
  metric: { alignItems: 'center' },
  metricValue: {
    fontSize: theme.typography.sizes['2xl'],
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.ink,
    fontVariant: ['tabular-nums'],
  },
  metricLabel: { fontSize: theme.typography.sizes.sm, color: theme.colors.inkMuted },
  signal: { fontSize: theme.typography.sizes.sm, color: theme.colors.energy, textAlign: 'center' },
  signalLost: { color: theme.colors.error },
  hint: { fontSize: theme.typography.sizes.sm, lineHeight: theme.typography.lineHeights.sm, color: theme.colors.inkMuted, textAlign: 'center' },
  body: { fontSize: theme.typography.sizes.md, lineHeight: theme.typography.lineHeights.md, color: theme.colors.ink, textAlign: 'center' },
  controls: { flexDirection: 'row' },
  control: { flex: 1 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  toggleText: { flex: 1, gap: 2 },
  toggleLabel: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.semibold, color: theme.colors.ink },
  explain: { alignItems: 'center', gap: theme.spacing.md },
});
