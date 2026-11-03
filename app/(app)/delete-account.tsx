import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { theme } from '../../src/theme';
import { BrandButton, FormMessage, IconButton, Screen, ScreenHeader, SurfaceCard, TextField } from '../../src/components/v2';
import { DELETE_CONFIRMATION, deleteMyAccount } from '../../src/services/accountApi';
import { motion } from '../../src/activity/motionNative';
import { useAuthStore } from '../../src/stores/authStore';

const DELETED = [
  'votre profil (âge, poids, taille, objectif, adresse)',
  'vos pas, distances et séances, y compris le détail de musculation',
  'votre journal de repas et vos objectifs du jour',
  'vos préférences et l’historique des rappels',
  'votre connexion (e-mail, Google ou Apple)',
];

// Permanently deletes the signed-in customer's account (App Store and
// Google Play requirement). Typed confirmation; nothing is deleted unless
// the server confirms; then the device is signed out and cleared.
export default function DeleteAccountScreen() {
  const signOut = useAuthStore((s) => s.signOut);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = typed.trim().toUpperCase() === DELETE_CONFIRMATION;

  const onDelete = async () => {
    setBusy(true);
    setError(null);
    const r = await deleteMyAccount(DELETE_CONFIRMATION);
    if (!r.ok) {
      setBusy(false);
      setError(r.message);
      return;
    }
    // The account no longer exists: clear this phone too.
    await motion()?.clearSnapshotsAsync?.().catch(() => undefined);
    await motion()?.setBackgroundEnabledAsync?.(false).catch(() => undefined);
    await signOut();
    setBusy(false);
    router.replace('/(auth)/login');
  };

  return (
    <Screen scroll>
      <ScreenHeader title="Supprimer mon compte" subtitle="Définitif" right={<IconButton icon="close" label="Fermer" onPress={() => router.back()} />} />
      <View style={styles.section}>
        <SurfaceCard style={styles.card}>
          <Text style={styles.lead}>Ce qui est supprimé</Text>
          {DELETED.map((d) => (
            <Text key={d} style={styles.item}>{`• ${d}`}</Text>
          ))}
          <Text style={styles.lead}>Ce qui est conservé</Text>
          <Text style={styles.item}>
            • vos commandes passées, détachées de votre compte, pour la comptabilité et les obligations légales.
          </Text>
          <Text style={styles.note}>La suppression est immédiate et ne peut pas être annulée.</Text>
        </SurfaceCard>
      </View>
      <View style={styles.section}>
        <TextField
          label={`Tapez ${DELETE_CONFIRMATION} pour confirmer`}
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        {error ? <FormMessage title="Compte non supprimé" message={error} /> : null}
        <BrandButton title="Supprimer définitivement" onPress={onDelete} disabled={!confirmed} loading={busy} />
        <BrandButton title="Annuler" variant="soft" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: theme.spacing.xl, marginBottom: theme.spacing.xl, gap: theme.spacing.md },
  card: { gap: theme.spacing.sm },
  lead: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.bold, color: theme.colors.ink, marginTop: theme.spacing.xs },
  item: { fontSize: theme.typography.sizes.sm, lineHeight: theme.typography.lineHeights.sm, color: theme.colors.ink },
  note: { fontSize: theme.typography.sizes.sm, color: theme.colors.error, marginTop: theme.spacing.sm },
});
