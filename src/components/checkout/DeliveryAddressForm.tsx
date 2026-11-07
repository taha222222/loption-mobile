// The delivery address form, shared by onboarding (app/setup.tsx) and
// checkout (app/(app)/delivery-address.tsx). The phone's position may
// SUGGEST an address; nothing is saved until the customer confirms it with
// "Enregistrer l’adresse" (an approximate position is never a delivery
// address). The city is chosen by the customer (delivery zones: Casablanca
// first); the server re-checks the zone at quote and order time.
import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BrandButton } from '../v2/BrandButton';
import { Chip } from '../v2/Chip';
import { IconBadge } from '../v2/IconBadge';
import { SurfaceCard } from '../v2/SurfaceCard';
import { TextField } from '../v2/TextField';
import { CITY_OPTIONS, cityKeyFromName } from '../../delivery/cities';
import {
  getLocationPermission,
  type PermissionState,
  requestLocationPermission,
  suggestDeliveryAddress,
} from '../../services/permissions';
import { useAuthStore } from '../../stores/authStore';
import { useUserStore } from '../../stores/userStore';
import { theme } from '../../theme';

export interface DeliveryAddressFormProps {
  // 'locate': ask the permission (if needed) and suggest an address at once.
  start?: 'locate' | 'manual';
  hint?: string;
  onSaved: (city: string) => void;
  footerExtra?: React.ReactNode;
}

export function DeliveryAddressForm({ start = 'manual', hint, onSaved, footerExtra }: DeliveryAddressFormProps) {
  const user = useAuthStore((s) => s.user);
  const profile = useUserStore((s) => s.profile);
  const saveDeliveryAddress = useUserStore((s) => s.saveDeliveryAddress);
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [locating, setLocating] = useState(false);
  const [address, setAddress] = useState(profile?.delivery_address ?? '');
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [city, setCity] = useState<string | null>(profile?.delivery_city ?? null);
  const typedCity = cityKeyFromName(address.split(',').pop());
  const chosenCity = city ?? typedCity;
  const started = useRef(false);

  const locate = async () => {
    setLocating(true);
    const suggestion = await suggestDeliveryAddress();
    if (suggestion.kind === 'found') {
      setAddress(suggestion.address);
      const fromPosition = cityKeyFromName(suggestion.city);
      if (fromPosition) setCity(fromPosition);
      setCoords({ latitude: suggestion.latitude, longitude: suggestion.longitude });
      setNote('Adresse proposée à partir de votre position. Vérifiez-la et complétez-la (étage, appartement…).');
    } else if (suggestion.kind === 'position_only') {
      setCoords({ latitude: suggestion.latitude, longitude: suggestion.longitude });
      setNote('Position trouvée, mais pas d’adresse. Saisissez votre adresse de livraison.');
    } else {
      setNote('Votre position n’a pas pu être déterminée. Saisissez votre adresse de livraison.');
    }
    setLocating(false);
  };

  const askAndLocate = async () => {
    const result = await requestLocationPermission();
    setPermission(result);
    if (result === 'granted') await locate();
    else setNote(null);
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (start === 'locate') {
      void requestLocationPermission().then(async (result) => {
        setPermission(result);
        if (result === 'granted') await locate();
      });
    } else {
      void getLocationPermission().then(setPermission);
    }
    // Runs once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    const value = address.trim();
    if (value.length < 5) {
      setError('Saisissez une adresse de livraison complète (rue, quartier, ville).');
      return;
    }
    if (!chosenCity) {
      setError('Choisissez la ville de votre adresse.');
      return;
    }
    if (!user) return;
    setSaving(true);
    setError(null);
    // A coordinate is kept only with the address the customer confirmed.
    const result = await saveDeliveryAddress(user.id, value, coords, chosenCity);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved(chosenCity);
  };

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <IconBadge icon="location-outline" size={56} />
        <Text style={styles.title} accessibilityRole="header">
          Votre adresse de livraison
        </Text>
        {permission === 'denied' || permission === 'blocked' ? (
          <SurfaceCard style={styles.blocked}>
            <Ionicons name="information-circle-outline" size={20} color={theme.colors.inkMuted} />
            <Text style={styles.blockedText}>
              {permission === 'blocked'
                ? 'Vous avez refusé la localisation. Pour l’activer plus tard : Réglages du téléphone › L’OPTION › Position.'
                : 'Vous avez refusé la localisation. Vous pouvez réessayer ou continuer sans.'}
            </Text>
          </SurfaceCard>
        ) : null}
        {note ? <Text style={styles.intro}>{note}</Text> : null}
        <TextField
          label="Adresse"
          value={address}
          onChangeText={(t) => {
            setAddress(t);
            setError(null);
          }}
          placeholder="N°, rue, quartier, Casablanca"
          multiline
          editable={!locating}
          error={error}
          hint={hint ?? 'Utilisée pour vos livraisons. Vous pourrez la modifier à la commande.'}
        />
        <Text style={styles.cityLabel}>Ville</Text>
        <View style={styles.cityGrid} accessibilityLabel="Ville de livraison">
          {CITY_OPTIONS.map((c) => (
            <Chip
              key={c.key}
              label={c.name}
              active={chosenCity === c.key}
              onPress={() => {
                setCity(c.key);
                setError(null);
              }}
            />
          ))}
        </View>
        <Text style={styles.intro}>L’OPTION livre d’abord à Casablanca ; d’autres villes arrivent bientôt.</Text>
        {locating ? <Text style={styles.intro}>Recherche de votre position…</Text> : null}
      </ScrollView>
      <View style={styles.actions}>
        <BrandButton title="Enregistrer l’adresse" onPress={save} loading={saving || locating} />
        {permission === 'granted' && !locating ? <BrandButton title="Utiliser ma position" variant="soft" onPress={locate} /> : null}
        {permission === 'denied' ? <BrandButton title="Autoriser la localisation" variant="soft" onPress={askAndLocate} /> : null}
        {footerExtra}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing['2xl'],
    paddingBottom: theme.spacing['2xl'],
    gap: theme.spacing.lg,
  },
  title: {
    fontSize: theme.typography.sizes['3xl'],
    lineHeight: theme.typography.lineHeights['2xl'],
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.ink,
    letterSpacing: -0.5,
  },
  intro: {
    fontSize: theme.typography.sizes.md,
    lineHeight: theme.typography.lineHeights.md,
    color: theme.colors.inkMuted,
  },
  cityLabel: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.ink,
    alignSelf: 'stretch',
  },
  cityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, alignSelf: 'stretch' },
  blocked: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md },
  blockedText: {
    flex: 1,
    fontSize: theme.typography.sizes.sm,
    lineHeight: theme.typography.lineHeights.sm,
    color: theme.colors.inkMuted,
  },
  actions: {
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
  },
});
