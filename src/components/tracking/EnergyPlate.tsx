// "L'OPTION plate": the day's calorie balance as a plate that fills up with
// the meals eaten (from the bottom), the number left in the middle. An
// original visualization (no rings). Over budget, the plate is full and the
// excess is shown in words. All numbers come from the server; without a
// personalised budget nothing is drawn as if there were one.
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';
import { ActivityIcon, BrandButton, SurfaceCard, formatNumber } from '../v2';
import { budgetDetails, intakeShare, METHOD_EXPLAINED, METHOD_LABEL, type DailyBalance } from '../../activity/dailyBalance';

const SIZE = 210;
const R = SIZE / 2;

interface Props {
  day: DailyBalance | null;
  title: string;
  loading?: boolean;
  onCompleteProfile: () => void;
}

export function EnergyPlate({ day, title, loading, onCompleteProfile }: Props) {
  const [info, setInfo] = useState(false);
  const budget = day?.budgetKcal ?? null;
  const eaten = day?.consumedKcal ?? null;
  const remaining = day?.remainingKcal ?? null;
  const share = day ? intakeShare(day) : 0;
  const over = remaining !== null && remaining < 0;
  const fillTop = SIZE - 16 - (SIZE - 32) * share;

  return (
    <View testID="daily-balance-card">
      <SurfaceCard style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Comment est calculé mon objectif ?"
            onPress={() => setInfo((v) => !v)}
            hitSlop={10}
          >
            <Ionicons name={info ? 'close-circle-outline' : 'information-circle-outline'} size={24} color={theme.colors.inkMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.plateWrap} accessible accessibilityLabel={plateLabel(day)}>
          <Svg width={SIZE} height={SIZE}>
            <Defs>
              <ClipPath id="plate">
                <Circle cx={R} cy={R} r={R - 16} />
              </ClipPath>
            </Defs>
            <Circle cx={R} cy={R} r={R - 4} fill={theme.colors.surface} stroke={theme.colors.hairline} strokeWidth={8} />
            <Circle cx={R} cy={R} r={R - 16} fill={theme.colors.canvas} />
            {share > 0 ? (
              <Rect
                x={0}
                y={fillTop}
                width={SIZE}
                height={SIZE}
                fill={over ? theme.colors.nutrition : theme.colors.nutritionSoft}
                clipPath="url(#plate)"
              />
            ) : null}
          </Svg>
          <View style={styles.center} pointerEvents="none">
            {loading && !day ? (
              <Text style={styles.centerHint}>Chargement…</Text>
            ) : budget === null ? (
              <Text style={styles.centerHint}>Objectif{'\n'}indisponible</Text>
            ) : (
              <>
                <Text style={[styles.big, over && styles.bigOver]}>{formatNumber(Math.abs(remaining ?? budget))}</Text>
                <Text style={styles.centerHint}>{over ? 'kcal au-delà' : 'kcal restantes'}</Text>
              </>
            )}
          </View>
        </View>

        <View style={styles.stats}>
          <Stat icon="meal" label="Mangé" value={eaten === null ? 'Aucun repas' : `${formatNumber(eaten)} kcal`} hint="Repas enregistrés" />
          <Stat
            icon="target"
            label="Objectif"
            value={budget === null ? '—' : `${formatNumber(budget)} kcal`}
            hint="Estimé pour aujourd’hui"
          />
        </View>

        {budget === null && !loading ? (
          <View style={styles.missing}>
            <Text style={styles.body}>
              Complétez votre profil (sexe, âge, poids, taille, activité) pour obtenir un objectif personnalisé.
            </Text>
            <BrandButton title="Compléter mon profil" variant="soft" onPress={onCompleteProfile} />
          </View>
        ) : null}

        {info ? (
          <View style={styles.info}>
            {day?.method ? (
              <>
                <Text style={styles.infoLead}>{METHOD_LABEL[day.method]}</Text>
                <Text style={styles.body}>{METHOD_EXPLAINED[day.method]}</Text>
              </>
            ) : null}
            {day ? budgetDetails(day).map((line) => <Text key={line} style={styles.infoLine}>{`• ${line}`}</Text>) : null}
            <Text style={styles.infoLine}>• Objectif : votre estimation de calories pour aujourd’hui.</Text>
            <Text style={styles.infoLine}>• Mangé : les calories des repas que vous avez enregistrés.</Text>
            <Text style={styles.infoLine}>• Restantes : ce qu’il vous reste pour aujourd’hui (négatif si vous dépassez).</Text>
          </View>
        ) : null}
      </SurfaceCard>
    </View>
  );
}

function plateLabel(day: DailyBalance | null): string {
  if (!day || day.budgetKcal === null) return 'Objectif personnalisé indisponible';
  const eaten = day.consumedKcal === null ? 'aucun repas enregistré' : `${day.consumedKcal} kcal mangées`;
  const rest =
    day.remainingKcal !== null && day.remainingKcal < 0 ? `${-day.remainingKcal} kcal au-delà` : `${day.remainingKcal} kcal restantes`;
  return `Objectif ${day.budgetKcal} kcal, ${eaten}, ${rest}`;
}

function Stat({ icon, label, value, hint }: { icon: 'meal' | 'target'; label: string; value: string; hint: string }) {
  return (
    <View style={styles.stat}>
      <ActivityIcon name={icon} size={40} />
      <View style={styles.statText}>
        <Text style={styles.statLabel}>{label}</Text>
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statHint}>{hint}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: theme.spacing.lg, alignItems: 'stretch' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: theme.typography.sizes.xl, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  plateWrap: { alignSelf: 'center', width: SIZE, height: SIZE },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  big: {
    fontSize: theme.typography.sizes['6xl'],
    lineHeight: theme.typography.lineHeights['6xl'],
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
  },
  bigOver: { color: theme.colors.textWhite },
  centerHint: {
    fontSize: theme.typography.sizes.md,
    color: theme.colors.inkMuted,
    textAlign: 'center',
    fontWeight: theme.typography.weights.semibold,
  },
  stats: { flexDirection: 'row', gap: theme.spacing.md },
  stat: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  statText: { flex: 1, minWidth: 0 },
  statLabel: { fontSize: theme.typography.sizes.sm, color: theme.colors.inkMuted },
  statValue: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.ink,
    fontVariant: ['tabular-nums'],
  },
  statHint: { fontSize: theme.typography.sizes.xs, color: theme.colors.inkFaint },
  missing: { gap: theme.spacing.md },
  body: { fontSize: theme.typography.sizes.sm, lineHeight: theme.typography.lineHeights.sm, color: theme.colors.ink },
  info: { gap: theme.spacing.xs, backgroundColor: theme.colors.canvas, borderRadius: theme.radii.md, padding: theme.spacing.md },
  infoLead: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  infoLine: { fontSize: theme.typography.sizes.sm, lineHeight: theme.typography.lineHeights.sm, color: theme.colors.inkMuted },
});
