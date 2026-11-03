// Gym session logger: intensity, exercises, sets (repetitions, weight) and
// rest time. Everything is typed by the customer; the phone does not detect
// exercises. Calories of a gym session are an estimate from the intensity,
// body weight and active time (shown as such).
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../../theme';
import { BrandButton, Chip, Stepper, SurfaceCard, TextField } from '../v2';
import { formatDuration } from '../../activity/gps';
import type { GymCategory, GymExercise, GymIntensity, GymSet } from '../../activity/workoutSession';

export const CATEGORY_LABEL: Record<GymCategory, string> = {
  upper_body: 'Haut du corps',
  lower_body: 'Bas du corps',
  full_body: 'Corps entier',
  core: 'Abdos / gainage',
  cardio: 'Cardio',
  mobility: 'Mobilité',
};
export const INTENSITY_LABEL: Record<GymIntensity, string> = { light: 'Léger', moderate: 'Modéré', vigorous: 'Intense' };
const INTENSITY_HINT: Record<GymIntensity, string> = {
  light: 'Charges légères, beaucoup de pauses',
  moderate: 'Effort soutenu, séries complètes',
  vigorous: 'Charges lourdes, peu de repos',
};
const CATEGORIES = Object.keys(CATEGORY_LABEL) as GymCategory[];
const INTENSITIES: GymIntensity[] = ['light', 'moderate', 'vigorous'];

interface Props {
  intensity: GymIntensity;
  exercises: GymExercise[];
  onIntensity: (i: GymIntensity) => void;
  onAddExercise: (name: string, category: GymCategory) => void;
  onRemoveExercise: (id: string) => void;
  onAddSet: (exerciseId: string, set: GymSet) => void;
  onRemoveLastSet: (exerciseId: string) => void;
}

export function GymLogger({ intensity, exercises, onIntensity, onAddExercise, onRemoveExercise, onAddSet, onRemoveLastSet }: Props) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<GymCategory>('upper_body');
  const [restSince, setRestSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (restSince === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [restSince]);

  const restSeconds = restSince === null ? null : Math.floor((now - restSince) / 1000);

  return (
    <View style={styles.wrap}>
      <SurfaceCard style={styles.card}>
        <Text style={styles.title}>Intensité</Text>
        <View style={styles.chips}>
          {INTENSITIES.map((i) => (
            <Chip key={i} label={INTENSITY_LABEL[i]} active={intensity === i} onPress={() => onIntensity(i)} />
          ))}
        </View>
        <Text style={styles.hint}>{INTENSITY_HINT[intensity]} · sert à estimer les calories.</Text>
      </SurfaceCard>

      {restSeconds !== null ? (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Arrêter le repos" onPress={() => setRestSince(null)}>
          <SurfaceCard style={styles.rest}>
            <Text style={styles.restLabel}>Repos</Text>
            <Text style={styles.restTime}>{formatDuration(restSeconds)}</Text>
            <Text style={styles.hint}>Touchez pour arrêter</Text>
          </SurfaceCard>
        </TouchableOpacity>
      ) : null}

      {exercises.map((e) => (
        <ExerciseCard
          key={e.id}
          exercise={e}
          onRemove={() => onRemoveExercise(e.id)}
          onRemoveLastSet={() => onRemoveLastSet(e.id)}
          onAddSet={(set) => {
            onAddSet(e.id, { ...set, restSeconds: restSeconds });
            setRestSince(Date.now()); // the rest before the next set starts now
          }}
        />
      ))}

      <SurfaceCard style={styles.card}>
        <Text style={styles.title}>Ajouter un exercice</Text>
        <TextField label="Nom de l’exercice" value={name} onChangeText={setName} maxLength={60} placeholder="ex. Développé couché" />
        <View style={styles.chips}>
          {CATEGORIES.map((c) => (
            <Chip key={c} label={CATEGORY_LABEL[c]} active={category === c} onPress={() => setCategory(c)} />
          ))}
        </View>
        <BrandButton
          title="Ajouter"
          variant="soft"
          disabled={name.trim().length === 0}
          onPress={() => {
            onAddExercise(name, category);
            setName('');
          }}
        />
      </SurfaceCard>
    </View>
  );
}

function ExerciseCard({
  exercise,
  onAddSet,
  onRemove,
  onRemoveLastSet,
}: {
  exercise: GymExercise;
  onAddSet: (s: GymSet) => void;
  onRemove: () => void;
  onRemoveLastSet: () => void;
}) {
  const last = exercise.sets[exercise.sets.length - 1];
  const [reps, setReps] = useState(last?.reps ?? 10);
  const [weight, setWeight] = useState<number>(last?.weightKg ?? 0);
  return (
    <SurfaceCard style={styles.card}>
      <View style={styles.exHeader}>
        <View style={styles.exTitle}>
          <Text style={styles.title}>{exercise.name}</Text>
          <Text style={styles.hint}>{CATEGORY_LABEL[exercise.category]}</Text>
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Retirer ${exercise.name}`} onPress={onRemove}>
          <Text style={styles.link}>Retirer</Text>
        </TouchableOpacity>
      </View>
      {exercise.sets.length ? (
        <View style={styles.sets}>
          {exercise.sets.map((s, i) => (
            <Text key={i} style={styles.setLine}>
              Série {i + 1} · {s.reps} répétitions{s.weightKg ? ` · ${String(s.weightKg).replace('.', ',')} kg` : ''}
              {s.restSeconds !== null ? ` · repos ${formatDuration(s.restSeconds)}` : ''}
            </Text>
          ))}
          <TouchableOpacity accessibilityRole="button" onPress={onRemoveLastSet}>
            <Text style={styles.link}>Annuler la dernière série</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={styles.hint}>Aucune série pour l’instant.</Text>
      )}
      <Stepper
        label="Répétitions"
        value={String(reps)}
        onDecrease={() => setReps((r) => Math.max(1, r - 1))}
        onIncrease={() => setReps((r) => Math.min(200, r + 1))}
        canDecrease={reps > 1}
        canIncrease={reps < 200}
      />
      <Stepper
        label="Charge"
        value={weight > 0 ? `${String(weight).replace('.', ',')} kg` : 'Poids du corps'}
        onDecrease={() => setWeight((w) => Math.max(0, Math.round((w - 2.5) * 10) / 10))}
        onIncrease={() => setWeight((w) => Math.min(500, Math.round((w + 2.5) * 10) / 10))}
        canDecrease={weight > 0}
        canIncrease={weight < 500}
      />
      <BrandButton
        title={`Valider la série ${exercise.sets.length + 1}`}
        onPress={() => onAddSet({ reps, weightKg: weight > 0 ? weight : null, restSeconds: null })}
        disabled={exercise.sets.length >= 20}
      />
    </SurfaceCard>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: theme.spacing.md },
  card: { gap: theme.spacing.md },
  title: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.ink,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  hint: { fontSize: theme.typography.sizes.sm, color: theme.colors.inkMuted },
  rest: { alignItems: 'center', gap: theme.spacing.xs, backgroundColor: theme.colors.workoutSoft },
  restLabel: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.semibold, color: theme.colors.workout },
  restTime: {
    fontSize: theme.typography.sizes['5xl'],
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.workout,
    fontVariant: ['tabular-nums'],
  },
  exHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md },
  exTitle: { flex: 1, gap: 2 },
  link: { fontSize: theme.typography.sizes.sm, fontWeight: theme.typography.weights.semibold, color: theme.colors.brand },
  sets: { gap: theme.spacing.xs },
  setLine: { fontSize: theme.typography.sizes.md, color: theme.colors.ink, fontVariant: ['tabular-nums'] },
});
