import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { theme } from '../../src/theme';
import { ActivityIcon, BrandButton, confirmAction, FormMessage, IconButton, Screen, ScreenHeader, SurfaceCard } from '../../src/components/v2';
import { GymLogger } from '../../src/components/workout/GymLogger';
import { LiveRouteMap } from '../../src/components/workout/LiveRouteMap';
import {
  currentSpeedMps,
  formatDistance,
  formatDuration,
  formatPace,
  kmh,
  MAX_ACCURACY_M,
  paceFromSpeed,
  paceSecondsPerKm,
  speedKmh,
  type GeoPoint,
} from '../../src/activity/gps';
import { ACTIVITY_CHOICES, type ActivityChoice, choiceGlyph, choiceLabel } from '../../src/activity/labels';
import { previewKcal } from '../../src/activity/metPreview';
import { activeSeconds, gpsSignal } from '../../src/activity/workoutSession';
import { requestWorkoutGps, watchPreviewLocation, watchWorkoutLocation, workoutGpsStatus, type GpsPermission } from '../../src/activity/workoutGps';
import { useUserStore } from '../../src/stores/userStore';
import { useWorkoutStore } from '../../src/stores/workoutStore';

const HEARTBEAT_MS = 15_000;
const DRAIN_MS = 4_000;
const WEAK_PREVIEW_MS = 20_000;

const timeOf = (iso: string) => new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const kmhText = (v: number | null) => (v === null ? '—' : `${String(v).replace('.', ',')} km/h`);

const SIGNAL_TEXT = {
  searching: 'Recherche de votre position…',
  weak: 'Signal GPS faible : la distance reprendra avec le signal.',
  lost: 'Localisation désactivée : la distance n’est plus mesurée.',
} as const;

// Record a walk, run, ride, hike or gym session. Outdoor sessions show a live
// map; time comes from timestamps, so it stays right in the background. GPS
// runs only for a session that asked for it, from Start/Reprendre to
// Pause/Terminer/Abandonner (screen off included where the build supports
// it); before Start the map shows the position without recording anything.
export default function WorkoutScreen() {
  const params = useLocalSearchParams<{ kind?: string }>();
  const initialChoice = ACTIVITY_CHOICES.some((c) => c.id === params.kind) ? (params.kind as ActivityChoice) : 'walk';
  const store = useWorkoutStore();
  const { active, notice, gpsMode, lastSummary } = store;
  const weightKg = useUserStore((s) => s.profile?.weight ?? null);
  const { height: windowHeight } = useWindowDimensions();
  const mapHeight = Math.round(Math.min(420, Math.max(220, windowHeight * 0.42)));

  const [choice, setChoice] = useState<ActivityChoice>(initialChoice);
  const [step, setStep] = useState<'choose' | 'prestart'>('choose');
  const [permission, setPermission] = useState<GpsPermission | null>(null);
  const [preview, setPreview] = useState<GeoPoint | null>(null);
  const [previewSince, setPreviewSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [message, setMessage] = useState<{ title: string; text: string; tone: 'error' | 'info' } | null>(null);
  const [saving, setSaving] = useState(false);
  const stopScreenGps = useRef<null | (() => void)>(null);

  const selected = ACTIVITY_CHOICES.find((c) => c.id === choice)!;
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
    if (!running || !wantsGps || gpsMode !== 'screen' || !active) return;
    let cancelled = false;
    (async () => {
      try {
        const stop = await watchWorkoutLocation(store.addPoint, active.kind);
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
  }, [running, wantsGps, gpsMode, store, active?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-start: where the customer is, before anything is recorded.
  useEffect(() => {
    if (step !== 'prestart' || active) return;
    let cancelled = false;
    void workoutGpsStatus().then((p) => {
      if (cancelled) return;
      setPermission(p);
      if (p === 'granted') setPreviewSince(Date.now());
    });
    return () => {
      cancelled = true;
    };
  }, [step, active]);

  useEffect(() => {
    if (step !== 'prestart' || active || permission !== 'granted') return;
    let stop: null | (() => void) = null;
    let cancelled = false;
    const tick = setInterval(() => setNow(new Date()), 1000);
    (async () => {
      try {
        const s = await watchPreviewLocation((p) => !cancelled && setPreview(p));
        if (cancelled) s();
        else stop = s;
      } catch {
        /* stays "Recherche de votre position…" */
      }
    })();
    return () => {
      cancelled = true;
      clearInterval(tick);
      stop?.();
    };
  }, [step, active, permission]);

  const begin = async (gps: boolean) => {
    setMessage(null);
    setNow(new Date());
    const r = await store.start(selected.kind, { gps, label: selected.id === 'hike' ? 'hike' : null });
    if (!r.ok) setMessage({ title: 'Séance en cours', text: 'Terminez d’abord la séance en cours.', tone: 'error' });
    else setStep('choose');
  };

  const askPermission = async () => {
    const p = await requestWorkoutGps();
    setPermission(p);
    if (p === 'granted') setPreviewSince(Date.now());
  };

  const onFinish = useCallback(async () => {
    setSaving(true);
    const r = await store.finish();
    setSaving(false);
    if (!r.ok && r.reason === 'too_short') {
      setMessage({ title: 'Séance trop courte', text: 'Une séance doit durer au moins une minute. Reprenez-la ou abandonnez-la.', tone: 'error' });
    }
  }, [store]);

  const messages =
    message || notice ? (
      <View style={styles.section}>
        {message ? <FormMessage title={message.title} message={message.text} tone={message.tone} /> : null}
        {notice ? <FormMessage title="Séances" message={notice} tone="info" /> : null}
      </View>
    ) : null;

  // ------------------------------------------------------------ summary
  if (!active && lastSummary) {
    const s = lastSummary.session;
    const onFoot = s.kind === 'walk' || s.kind === 'run';
    const pace = onFoot ? formatPace(paceSecondsPerKm(s.distanceM, s.activeSeconds)) : null;
    const speed = s.kind === 'cycle' ? speedKmh(s.distanceM, s.activeSeconds) : null;
    const kcal = previewKcal({ kind: s.kind, activeSeconds: s.activeSeconds, distanceM: s.distanceM, weightKg, intensity: s.intensity ?? null });
    const sets = s.gym?.reduce((n, e) => n + e.sets.length, 0) ?? 0;
    return (
      <Screen scroll>
        <ScreenHeader title="Bravo !" subtitle="Activité terminée" right={<IconButton icon="close" label="Fermer" onPress={() => router.back()} />} />
        {lastSummary.route.length > 1 ? (
          <View style={styles.section}>
            <LiveRouteMap route={lastSummary.route} height={Math.round(mapHeight * 0.8)} overview follow={false} />
            <Text style={styles.hint}>Le tracé reste sur votre téléphone ; seule la distance est enregistrée.</Text>
          </View>
        ) : null}
        <View style={styles.section}>
          <SurfaceCard style={styles.live}>
            <View style={styles.titleRow}>
              <ActivityIcon name={choiceGlyph(s.kind, s.label)} size={48} />
              <Text style={styles.kindTitle}>{choiceLabel(s.kind, s.label)}</Text>
            </View>
            <Text style={styles.timer}>{formatDuration(s.activeSeconds)}</Text>
            <Text style={styles.hint}>
              {timeOf(s.startedAt)} – {timeOf(s.endedAt)}
            </Text>
            <View style={styles.metrics}>
              {s.distanceM !== null ? <Metric label="Distance" value={formatDistance(s.distanceM) ?? '—'} /> : null}
              {pace ? <Metric label="Allure moyenne" value={pace} /> : null}
              {speed !== null ? <Metric label="Vitesse moyenne" value={kmhText(speed)} /> : null}
              {s.steps != null ? <Metric label="Pas" value={s.steps.toLocaleString('fr-FR')} /> : null}
              {kcal !== null ? <Metric label="Calories (estimation)" value={`${kcal} kcal`} /> : null}
              {s.kind === 'gym' ? <Metric label="Exercices" value={String(s.gym?.length ?? 0)} /> : null}
              {s.kind === 'gym' ? <Metric label="Séries" value={String(sets)} /> : null}
            </View>
          </SurfaceCard>
        </View>
        <View style={styles.section}>
          <FormMessage
            title={lastSummary.uploaded ? 'Activité enregistrée' : 'Activité gardée sur le téléphone'}
            message={
              lastSummary.uploaded
                ? 'Les calories de l’activité sont estimées et ajoutées à votre bilan du jour.'
                : 'Elle sera envoyée automatiquement dès que la connexion revient.'
            }
            tone="info"
          />
          {notice ? <FormMessage title="Séances" message={notice} tone="info" /> : null}
          <BrandButton title="Voir mon bilan" onPress={() => router.replace('/(app)/tracking')} />
          <BrandButton title="Nouvelle activité" variant="soft" onPress={() => useWorkoutStore.setState({ lastSummary: null })} />
          {lastSummary.route.length > 1 ? (
            <BrandButton
              title="Supprimer le tracé de ce téléphone"
              variant="soft"
              onPress={() =>
                confirmAction('Supprimer le tracé ?', 'La séance reste enregistrée ; seul le tracé est effacé de ce téléphone.', 'Supprimer', () =>
                  store.forgetRoute(s.clientSessionId)
                )
              }
            />
          ) : null}
        </View>
      </Screen>
    );
  }

  // ------------------------------------------------------------ live
  if (active) {
    const seconds = activeSeconds(active, now);
    const distance = active.gps.enabled ? active.gps.distanceM : null;
    const onFoot = active.kind === 'walk' || active.kind === 'run';
    const current = active.gps.enabled && running ? currentSpeedMps(active.route ?? [], now.getTime()) : null;
    const signal = gpsSignal(active, now.getTime());
    const kcal = previewKcal({ kind: active.kind, activeSeconds: seconds, distanceM: distance, weightKg, intensity: active.gym?.intensity ?? null });
    const status = !running
      ? 'Activité en pause'
      : signal === 'searching' || signal === 'weak' || signal === 'lost'
        ? SIGNAL_TEXT[signal]
        : 'Votre activité est enregistrée';
    return (
      <Screen scroll>
        <ScreenHeader
          title={choiceLabel(active.kind, active.label)}
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

        {active.gps.enabled ? (
          <View style={styles.section}>
            <LiveRouteMap route={active.route ?? []} height={mapHeight} follow={running} placeholder="Votre parcours s’affichera ici dès le premier point GPS." />
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={[styles.status, !running && styles.statusPaused, signal === 'lost' && styles.statusLost]} accessibilityLiveRegion="polite">
            <View style={[styles.dot, running && signal === 'ok' && styles.dotOn]} />
            <Text style={styles.statusText}>{status}</Text>
          </View>
          <SurfaceCard style={styles.live}>
            <Text style={styles.timer} accessibilityLabel={`Durée ${formatDuration(seconds)}`}>
              {formatDuration(seconds)}
            </Text>
            <View style={styles.metrics}>
              {active.gps.enabled ? <Metric label="Distance" value={formatDistance(distance) ?? '—'} /> : null}
              {active.gps.enabled && onFoot ? <Metric label="Allure actuelle" value={formatPace(paceFromSpeed(current)) ?? '—'} /> : null}
              {active.gps.enabled && onFoot ? <Metric label="Allure moyenne" value={formatPace(paceSecondsPerKm(distance, seconds)) ?? '—'} /> : null}
              {active.gps.enabled && active.kind === 'cycle' ? <Metric label="Vitesse actuelle" value={kmhText(kmh(current))} /> : null}
              {active.gps.enabled && active.kind === 'cycle' ? <Metric label="Vitesse moyenne" value={kmhText(speedKmh(distance, seconds))} /> : null}
              <Metric label="Calories (estimation)" value={kcal === null ? '—' : `${kcal} kcal`} />
            </View>
            {!active.gps.enabled && active.kind !== 'gym' ? (
              <Text style={styles.hint}>Sans GPS : la durée est enregistrée{active.kind === 'cycle' ? '' : ', et vos pas par le téléphone'}.</Text>
            ) : null}
            {kcal === null ? <Text style={styles.hint}>Ajoutez votre poids dans votre profil pour estimer les calories.</Text> : null}
            {active.gps.enabled && gpsMode === 'screen' && running ? (
              <Text style={styles.hint}>Gardez l’application ouverte : sur cette version, la distance n’est pas mesurée écran verrouillé.</Text>
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

        {messages}

        <View style={styles.section}>
          <BrandButton
            title="Abandonner la séance"
            variant="soft"
            onPress={() =>
              confirmAction('Abandonner la séance ?', 'Elle ne sera pas enregistrée et son tracé sera effacé.', 'Abandonner', () => void store.discard())
            }
          />
        </View>
      </Screen>
    );
  }

  // ------------------------------------------------------------ pre-start (outdoor)
  if (step === 'prestart' && selected.outdoor) {
    const waited = previewSince ? now.getTime() - previewSince : 0;
    const accurate = !!preview && preview.accuracy !== null && preview.accuracy <= MAX_ACCURACY_M;
    const locating =
      permission !== 'granted' ? null : accurate ? 'Prêt à démarrer' : preview || waited > WEAK_PREVIEW_MS ? 'Signal GPS faible' : 'Recherche de votre position…';
    return (
      <Screen scroll>
        <ScreenHeader title={selected.label} subtitle="Avant de démarrer" right={<IconButton icon="close" label="Fermer" onPress={() => setStep('choose')} />} />
        {permission === 'granted' ? (
          <>
            <View style={styles.section}>
              <LiveRouteMap
                route={[]}
                position={preview ? { latitude: preview.latitude, longitude: preview.longitude } : null}
                height={mapHeight}
                placeholder="Votre position s’affichera ici."
              />
            </View>
            <View style={styles.section}>
              <View style={[styles.status, accurate && styles.statusReady]} accessibilityLiveRegion="polite">
                <View style={[styles.dot, accurate && styles.dotOn]} />
                <Text style={styles.statusText}>{locating}</Text>
              </View>
              {!accurate && (preview || waited > WEAK_PREVIEW_MS) ? (
                <Text style={styles.hint}>Vous pouvez démarrer : la distance commencera dès que le signal sera meilleur.</Text>
              ) : null}
              <BrandButton title="Démarrer" onPress={() => void begin(true)} />
              <Text style={styles.hint}>
                La position est utilisée seulement pendant cette activité, même écran verrouillé. Elle s’arrête à la pause ou à la fin, et le
                tracé reste sur ce téléphone.
              </Text>
            </View>
          </>
        ) : permission === 'undetermined' ? (
          <View style={styles.section}>
            <SurfaceCard style={styles.explain}>
              <ActivityIcon name="distance" size={56} />
              <Text style={styles.cardTitle}>Afficher votre parcours</Text>
              <Text style={styles.body}>
                L’OPTION a besoin de votre position pour afficher la carte et mesurer la distance de cette activité, uniquement pendant la
                séance. Votre tracé reste sur ce téléphone.
              </Text>
              <BrandButton title="Continuer" onPress={() => void askPermission()} />
            </SurfaceCard>
          </View>
        ) : permission === 'denied' ? (
          <View style={styles.section}>
            <FormMessage
              title="Localisation non autorisée"
              message="Sans votre position, l’activité enregistre la durée (et vos pas à pied) mais pas la carte ni la distance."
              tone="info"
            />
            <BrandButton title="Autoriser dans les réglages" variant="soft" onPress={() => void Linking.openSettings()} />
          </View>
        ) : null}
        <View style={styles.section}>
          {permission !== null && permission !== 'granted' ? <BrandButton title="Démarrer sans carte" onPress={() => void begin(false)} /> : null}
          {permission === 'granted' ? <BrandButton title="Démarrer sans GPS" variant="soft" onPress={() => void begin(false)} /> : null}
        </View>
        {messages}
      </Screen>
    );
  }

  // ------------------------------------------------------------ choose
  return (
    <Screen scroll>
      <ScreenHeader title="Nouvelle activité" subtitle="Choisissez" right={<IconButton icon="close" label="Fermer" onPress={() => router.back()} />} />
      <View style={styles.section}>
        <View style={styles.grid}>
          {ACTIVITY_CHOICES.map((c) => (
            <TouchableOpacity
              key={c.id}
              accessibilityRole="button"
              accessibilityState={{ selected: choice === c.id }}
              accessibilityLabel={c.label}
              onPress={() => setChoice(c.id)}
              style={[styles.tile, choice === c.id && styles.tileSelected]}
            >
              <ActivityIcon name={c.glyph} size={64} />
              <Text style={styles.tileLabel}>{c.label}</Text>
              <Text style={styles.tileHint}>{c.hint}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        {selected.outdoor ? (
          <BrandButton title={`Continuer · ${selected.label}`} onPress={() => setStep('prestart')} />
        ) : (
          <BrandButton title={`Démarrer · ${selected.label}`} onPress={() => void begin(false)} />
        )}
        <Text style={styles.hint}>Les calories d’une activité sont une estimation selon l’effort, votre poids et la durée.</Text>
        {selected.id === 'hike' ? <Text style={styles.hint}>La randonnée est comptée comme une marche dans votre bilan.</Text> : null}
      </View>

      {messages}

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
  live: { alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.xl },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  kindTitle: { fontSize: theme.typography.sizes.xl, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  timer: {
    fontSize: theme.typography.sizes.display,
    lineHeight: theme.typography.lineHeights.display,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
  },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: theme.spacing.xl, rowGap: theme.spacing.md },
  metric: { alignItems: 'center', minWidth: 120 },
  metricValue: {
    fontSize: theme.typography.sizes['2xl'],
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.ink,
    fontVariant: ['tabular-nums'],
  },
  metricLabel: { fontSize: theme.typography.sizes.sm, color: theme.colors.inkMuted, textAlign: 'center' },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    alignSelf: 'center',
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.workoutSoft,
  },
  statusReady: { backgroundColor: theme.colors.movementSoft },
  statusPaused: { backgroundColor: theme.colors.canvas },
  statusLost: { backgroundColor: theme.colors.nutritionSoft },
  statusText: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.semibold, color: theme.colors.ink, flexShrink: 1 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.inkFaint },
  dotOn: { backgroundColor: theme.colors.movement },
  hint: { fontSize: theme.typography.sizes.sm, lineHeight: theme.typography.lineHeights.sm, color: theme.colors.inkMuted, textAlign: 'center' },
  body: { fontSize: theme.typography.sizes.md, lineHeight: theme.typography.lineHeights.md, color: theme.colors.ink, textAlign: 'center' },
  cardTitle: { fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  controls: { flexDirection: 'row' },
  control: { flex: 1 },
  explain: { alignItems: 'center', gap: theme.spacing.md },
});
