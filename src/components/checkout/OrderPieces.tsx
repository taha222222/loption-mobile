// Building blocks shared by the cart and checkout: one aligned price row,
// one order line (thumbnail, name, choices, note, amount), section headings
// and the cash-on-delivery block. Display only: amounts come from the cart
// (menu prices) or from the server's preview.
import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatMad } from '../../menu/customization';
import { theme } from '../../theme';

// Label on the left, value on the right; a long value wraps under its own
// column and never runs into the label.
export function PriceRow({
  label,
  value,
  pending,
  struck,
  tone,
  strong,
  testID,
}: {
  label: string;
  value: string;
  pending?: boolean; // a fee not calculated yet: muted, may wrap
  struck?: string; // the amount before an offer, struck through
  tone?: 'success';
  strong?: boolean;
  testID?: string;
}) {
  return (
    <View style={[styles.row, strong && styles.rowStrong]}>
      <Text style={[styles.rowLabel, strong && styles.rowLabelStrong]}>{label}</Text>
      <View style={styles.rowValueWrap}>
        {struck ? <Text style={styles.struck}>{struck}</Text> : null}
        <Text
          style={[
            styles.rowValue,
            pending && styles.rowValuePending,
            tone === 'success' && styles.rowValueSuccess,
            strong && styles.rowValueStrong,
          ]}
          testID={testID}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

export function SectionTitle({ children, action }: { children: string; action?: React.ReactNode }) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {children}
      </Text>
      {action}
    </View>
  );
}

export function Thumbnail({ uri, size = 64 }: { uri?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size, borderRadius: theme.radii.md };
  if (uri && !failed) {
    return <Image source={{ uri }} style={[box, styles.thumb]} onError={() => setFailed(true)} accessibilityIgnoresInvertColors />;
  }
  return (
    <View style={[box, styles.thumb, styles.thumbEmpty]}>
      <Ionicons name="restaurant-outline" size={size * 0.4} color={theme.colors.brand} />
    </View>
  );
}

// A compact order line for summaries (no controls).
export function SummaryLine({
  name,
  quantity,
  options,
  note,
  amount,
  image,
}: {
  name: string;
  quantity: number;
  options?: string;
  note?: string | null;
  amount: number;
  image?: string | null;
}) {
  return (
    <View style={styles.summaryLine}>
      {image !== undefined ? <Thumbnail uri={image} size={44} /> : null}
      <Text style={styles.summaryQty}>{`${quantity}×`}</Text>
      <View style={styles.summaryText}>
        <Text style={styles.summaryName}>{name}</Text>
        {options ? <Text style={styles.summaryMeta}>{options}</Text> : null}
        {note ? <Text style={styles.summaryMeta}>{`Note : ${note}`}</Text> : null}
      </View>
      <Text style={styles.summaryAmount}>{formatMad(amount)}</Text>
    </View>
  );
}

export function CashOnDelivery({ amount }: { amount?: number | null }) {
  return (
    <View style={styles.cod} testID="payment-method-cod">
      <View style={styles.codIcon}>
        <Ionicons name="cash-outline" size={22} color={theme.colors.brand} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.codTitle}>Paiement à la livraison</Text>
        <Text style={styles.codText}>Vous payez en espèces à la réception de votre commande.</Text>
        {amount != null ? <Text style={styles.codAmount}>{`Montant à payer : ${formatMad(amount)}`}</Text> : null}
      </View>
    </View>
  );
}

export const Divider = () => <View style={styles.divider} />;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.spacing.lg, paddingVertical: 6 },
  rowStrong: { paddingTop: theme.spacing.md },
  rowLabel: { flexShrink: 0, fontSize: theme.typography.sizes.md, lineHeight: theme.typography.lineHeights.md, color: theme.colors.inkMuted },
  rowLabelStrong: { fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  rowValueWrap: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'baseline', flexWrap: 'wrap', gap: theme.spacing.sm },
  rowValue: {
    flexShrink: 1,
    textAlign: 'right',
    fontSize: theme.typography.sizes.md,
    lineHeight: theme.typography.lineHeights.md,
    color: theme.colors.ink,
    fontWeight: theme.typography.weights.semibold,
  },
  rowValuePending: { color: theme.colors.inkMuted, fontWeight: theme.typography.weights.normal, fontSize: theme.typography.sizes.sm },
  rowValueSuccess: { color: theme.colors.success },
  rowValueStrong: { fontSize: theme.typography.sizes.xl, lineHeight: theme.typography.lineHeights.lg, fontWeight: theme.typography.weights.extrabold },
  struck: { fontSize: theme.typography.sizes.sm, color: theme.colors.inkFaint, textDecorationLine: 'line-through' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing.sm },
  sectionTitle: { fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  thumb: { backgroundColor: theme.colors.canvas },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.brandSoft },
  summaryLine: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md, paddingVertical: theme.spacing.sm },
  summaryQty: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.bold, color: theme.colors.brand, minWidth: 26 },
  summaryText: { flex: 1, gap: 2 },
  summaryName: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.semibold, color: theme.colors.ink },
  summaryMeta: { fontSize: theme.typography.sizes.sm, lineHeight: theme.typography.lineHeights.sm, color: theme.colors.inkMuted },
  summaryAmount: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.semibold, color: theme.colors.ink },
  cod: { flexDirection: 'row', gap: theme.spacing.md, alignItems: 'flex-start' },
  codIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  codTitle: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  codText: { fontSize: theme.typography.sizes.sm, lineHeight: theme.typography.lineHeights.sm, color: theme.colors.inkMuted, marginTop: 2 },
  codAmount: { fontSize: theme.typography.sizes.sm, fontWeight: theme.typography.weights.bold, color: theme.colors.ink, marginTop: theme.spacing.xs },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.hairline, marginVertical: theme.spacing.sm },
});
