// Checkout: 1. delivery address, 2. phone verified by WhatsApp code,
// 3. summary priced by the server (checkout_preview: products and choices,
// first-order rule, service fee, road-distance delivery fee, promo code),
// then "Confirmer la commande" (cash on delivery). The app computes no
// charged amount: it shows the server's numbers and sends the total the
// customer saw, which create_order() checks.
//
// Checkout is locked (owner decision 2026-11-05) until the trusted order flow
// and pricing are approved and applied; then CHECKOUT_OPEN is switched in a
// reviewed change. While locked, the screen shows the basket and why
// ordering is closed, and calls nothing.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { theme } from '../../src/theme';
import { BrandButton, IconButton, StepProgress, TextField } from '../../src/components/v2';
import { useAuthStore } from '../../src/stores/authStore';
import { useCartStore, type CartItem } from '../../src/stores/cartStore';
import { useUserStore } from '../../src/stores/userStore';
import { CHECKOUT_CLOSED_MESSAGE, CHECKOUT_CLOSED_TITLE, CHECKOUT_OPEN } from '../../src/checkout/checkoutAvailability';
import { checkoutSummary, mad, TVA_INCLUDED_NOTE } from '../../src/checkout/checkoutSummary';
import { describeOptions } from '../../src/menu/customization';
import {
  createOrder,
  PROMO_MESSAGES,
  previewCheckout,
  requestDeliveryQuote,
  type CheckoutPreview,
  type OrderLineRequest,
} from '../../src/services/checkoutApi';
import { requestPhoneCode, verifyPhoneCode } from '../../src/services/phoneApi';
import { cityName, fetchServedCities, notServedMessage } from '../../src/delivery/cities';
import { formatMoroccanMobile, normalizeMoroccanMobile } from '../../src/phone/moroccanPhone';

type Step = 'address' | 'phone' | 'summary';
const STEPS: Step[] = ['address', 'phone', 'summary'];
const STEP_TITLES: Record<Step, string> = { address: 'Livraison', phone: 'Téléphone', summary: 'Récapitulatif' };

const toLines = (items: CartItem[]): OrderLineRequest[] =>
  items.map((i) => ({ mealId: i.mealId, quantity: i.quantity, notes: i.notes ?? null, optionIds: i.options.map((o) => o.id) }));

export default function CheckoutScreen() {
  const items = useCartStore((s) => s.items);
  const profile = useUserStore((s) => s.profile);
  const address = profile?.delivery_address?.trim() ?? '';
  const city = profile?.delivery_city ?? null;
  const verifiedPhone = profile?.phone_e164 && profile?.phone_verified_at ? profile.phone_e164 : null;
  const [step, setStep] = useState<Step>('address');
  const [served, setServed] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchServedCities().then((list) => !cancelled && setServed(list));
    return () => {
      cancelled = true;
    };
  }, []);
  const outOfZone = !!city && !!served && !served.includes(city);

  const back = () => {
    const i = STEPS.indexOf(step);
    if (CHECKOUT_OPEN && i > 0) setStep(STEPS[i - 1]);
    else router.back();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <IconButton icon="arrow-back" label="Retour" onPress={back} />
        <Text style={styles.headerTitle}>{CHECKOUT_OPEN ? STEP_TITLES[step] : 'Commande'}</Text>
        <View style={{ width: 44 }} />
      </View>
      {CHECKOUT_OPEN ? (
        <View style={styles.progress}>
          <StepProgress step={STEPS.indexOf(step) + 1} total={STEPS.length} />
        </View>
      ) : null}

      {!CHECKOUT_OPEN ? (
        <ClosedCheckout items={items} outOfZone={outOfZone} city={city} />
      ) : step === 'address' ? (
        <AddressStep address={address} city={city} outOfZone={outOfZone} onNext={() => setStep(verifiedPhone ? 'summary' : 'phone')} />
      ) : step === 'phone' ? (
        <PhoneStep verifiedPhone={verifiedPhone} onDone={() => setStep('summary')} />
      ) : (
        <SummaryStep items={items} onNeedPhone={() => setStep('phone')} onNeedAddress={() => setStep('address')} />
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------- closed (today)
function ClosedCheckout({ items, outOfZone, city }: { items: CartItem[]; outOfZone: boolean; city: string | null }) {
  const summary = checkoutSummary(items, null, null);
  return (
    <>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Section title="Votre commande">
          {items.map((i) => (
            <LineRow key={i.id} name={i.name} quantity={i.quantity} options={describeOptions(i.options)} total={Math.round(i.price * 100 * i.quantity) / 100} />
          ))}
          <Row label="Sous-total produits" value={mad(summary.productsSubtotal)} />
          <Row label="Frais de livraison" value="À confirmer" testID="checkout-delivery-fee" />
          <Text style={styles.note}>{TVA_INCLUDED_NOTE}</Text>
        </Section>
        <PaymentSection />
      </ScrollView>
      <View style={styles.footer}>
        {outOfZone ? (
          <View style={styles.notice} testID="checkout-out-of-zone">
            <Text style={styles.noticeTitle}>Pas encore dans votre ville</Text>
            <Text style={styles.noticeText}>{notServedMessage(city)}</Text>
          </View>
        ) : null}
        <View style={styles.notice} testID="checkout-closed" accessibilityLiveRegion="polite">
          <Text style={styles.noticeTitle}>{CHECKOUT_CLOSED_TITLE}</Text>
          <Text style={styles.noticeText}>{CHECKOUT_CLOSED_MESSAGE}</Text>
        </View>
        <BrandButton title="Confirmer la commande" onPress={() => undefined} disabled />
      </View>
    </>
  );
}

// ---------------------------------------------------------------- 1. address
function AddressStep({ address, city, outOfZone, onNext }: { address: string; city: string | null; outOfZone: boolean; onNext: () => void }) {
  const ready = address.length >= 5 && !!city && !outOfZone;
  return (
    <>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.stepIntro}>Où devons-nous livrer votre commande ?</Text>
        {address ? (
          <TouchableOpacity
            style={styles.addressCard}
            onPress={() => router.push('/(app)/delivery-address')}
            accessibilityRole="button"
            accessibilityLabel="Modifier l’adresse de livraison"
            testID="checkout-address"
          >
            <Ionicons name="location" size={22} color={theme.colors.brand} />
            <View style={{ flex: 1 }}>
              <Text style={styles.addressText}>{address}</Text>
              <Text style={styles.addressCity}>{cityName(city) ?? 'Ville à choisir'}</Text>
            </View>
            <Text style={styles.link}>Modifier</Text>
          </TouchableOpacity>
        ) : (
          <BrandButton title="Ajouter une adresse de livraison" variant="soft" onPress={() => router.push('/(app)/delivery-address')} />
        )}
        {outOfZone ? (
          <View style={styles.notice} testID="checkout-out-of-zone">
            <Text style={styles.noticeTitle}>Pas encore dans votre ville</Text>
            <Text style={styles.noticeText}>{notServedMessage(city)}</Text>
          </View>
        ) : null}
        {address && !city ? <Text style={styles.error}>Choisissez la ville de votre adresse (Modifier).</Text> : null}
      </ScrollView>
      <View style={styles.footer}>
        <BrandButton title="Continuer" onPress={onNext} disabled={!ready} />
      </View>
    </>
  );
}

// ---------------------------------------------------------------- 2. phone
function PhoneStep({ verifiedPhone, onDone }: { verifiedPhone: string | null; onDone: () => void }) {
  const user = useAuthStore((s) => s.user);
  const loadProfile = useUserStore((s) => s.loadProfile);
  const typedBefore = useUserStore((s) => s.profile?.phone ?? '');
  const [changing, setChanging] = useState(!verifiedPhone);
  const [phone, setPhone] = useState(verifiedPhone ? formatMoroccanMobile(verifiedPhone) : typedBefore);
  const [sent, setSent] = useState<{ id: string; to: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async () => {
    const normalized = normalizeMoroccanMobile(phone);
    if (!normalized) {
      setMessage('Saisissez un numéro de mobile marocain (06 ou 07).');
      return;
    }
    setBusy(true);
    setMessage(null);
    const r = await requestPhoneCode(normalized);
    setBusy(false);
    if (!r.ok) {
      setMessage(r.message);
      return;
    }
    setSent({ id: r.verificationId, to: r.phoneE164 });
    setCode('');
    setWait(60);
  };

  const verify = async () => {
    if (!sent || !/^\d{6}$/.test(code)) {
      setMessage('Saisissez le code à 6 chiffres reçu sur WhatsApp.');
      return;
    }
    setBusy(true);
    setMessage(null);
    const r = await verifyPhoneCode(sent.id, code);
    if (!r.ok) {
      setBusy(false);
      setMessage(r.message);
      return;
    }
    if (user) await loadProfile(user.id);
    setBusy(false);
    onDone();
  };

  if (verifiedPhone && !changing) {
    return (
      <>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.stepIntro}>Le livreur vous appelle à ce numéro si besoin.</Text>
          <View style={styles.addressCard} testID="checkout-phone-verified">
            <Ionicons name="logo-whatsapp" size={22} color={theme.colors.success} />
            <View style={{ flex: 1 }}>
              <Text style={styles.addressText}>{formatMoroccanMobile(verifiedPhone)}</Text>
              <Text style={styles.addressCity}>Numéro vérifié</Text>
            </View>
            <TouchableOpacity onPress={() => setChanging(true)} accessibilityRole="button">
              <Text style={styles.link}>Changer</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
        <View style={styles.footer}>
          <BrandButton title="Continuer" onPress={onDone} />
        </View>
      </>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.stepIntro}>Votre numéro de mobile, pour que le livreur puisse vous joindre. Nous le vérifions par un code WhatsApp.</Text>
        <TextField
          label="Numéro de mobile"
          value={phone}
          onChangeText={(t) => {
            setPhone(t);
            setMessage(null);
            setSent(null);
          }}
          placeholder="06 12 34 56 78"
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          editable={!busy}
        />
        {sent ? (
          <>
            <Text style={styles.note}>{`Code envoyé sur WhatsApp au ${formatMoroccanMobile(sent.to)}. Il est valable 10 minutes.`}</Text>
            <TextField
              label="Code à 6 chiffres"
              value={code}
              onChangeText={(t) => {
                setCode(t.replace(/\D/g, '').slice(0, 6));
                setMessage(null);
              }}
              placeholder="123456"
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              maxLength={6}
            />
          </>
        ) : null}
        {message ? (
          <Text style={styles.error} accessibilityLiveRegion="polite" testID="checkout-phone-message">
            {message}
          </Text>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        {sent ? (
          <>
            <BrandButton title="Vérifier" onPress={() => void verify()} loading={busy} disabled={code.length !== 6} />
            <BrandButton
              title={wait > 0 ? `Renvoyer le code (${wait} s)` : 'Renvoyer le code'}
              variant="soft"
              onPress={() => void send()}
              disabled={wait > 0 || busy}
            />
          </>
        ) : (
          <BrandButton title="Recevoir le code sur WhatsApp" onPress={() => void send()} loading={busy} />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------- 3. summary
function SummaryStep({ items, onNeedPhone, onNeedAddress }: { items: CartItem[]; onNeedPhone: () => void; onNeedAddress: () => void }) {
  const clearCart = useCartStore((s) => s.clearCart);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<CheckoutPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [promoInput, setPromoInput] = useState('');
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [promoMessage, setPromoMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [placing, setPlacing] = useState(false);
  const [orderMessage, setOrderMessage] = useState<string | null>(null);
  // One request id per checkout attempt: a retry after a lost answer returns
  // the same order instead of creating a second one.
  const requestId = useRef<string | null>(null);
  const lines = toLines(items);

  // Road-distance quote first (server), then the server's price of the cart.
  // Callers that are not the first load set `loading` themselves.
  const price = useCallback(
    async (code: string | null) => {
      const q = await requestDeliveryQuote();
      setProblem(null);
      if (!q.ok) {
        setPreview(null);
        setProblem(q.message);
        setLoading(false);
        return null;
      }
      const r = await previewCheckout({ kitchenId: q.quote.kitchenId, items: lines, promoCode: code });
      setLoading(false);
      if (!r.ok) {
        setPreview(null);
        setProblem(r.message);
        return null;
      }
      setPreview(r.preview);
      return r.preview;
    },
    // `lines` is derived from the cart, which cannot change on this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    // First load: state is set when the server answers (after the quote).
    void Promise.resolve(null).then(price);
  }, [price]);

  const applyPromo = async () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    setLoading(true);
    const p = await price(code);
    if (!p) return;
    const ok = p.promo.status === 'valid';
    setPromoCode(ok ? code : null);
    setPromoMessage({ ok, text: p.promo.status === 'none' ? '' : PROMO_MESSAGES[p.promo.status] });
  };

  const removePromo = async () => {
    setPromoCode(null);
    setPromoInput('');
    setPromoMessage(null);
    setLoading(true);
    await price(null);
  };

  const confirm = async () => {
    if (!preview) return;
    requestId.current ??= randomUUID();
    setPlacing(true);
    setOrderMessage(null);
    const r = await createOrder({ kitchenId: preview.kitchenId, items: lines, requestId: requestId.current, expectedTotal: preview.total, promoCode });
    setPlacing(false);
    if (r.ok) {
      requestId.current = null;
      clearCart();
      router.replace(`/(app)/order-tracking/${r.orderId}`);
      return;
    }
    setOrderMessage(r.message);
    if (r.reason === 'phone_required') onNeedPhone();
    else if (r.reason === 'out_of_zone' || r.reason === 'no_city') onNeedAddress();
    else if (r.reason === 'total_changed' || r.reason === 'quote_required' || r.reason === 'promo_rejected') {
      // Show the new server total before the customer confirms again.
      requestId.current = null;
      if (r.reason === 'promo_rejected') setPromoCode(null);
      setLoading(true);
      await price(r.reason === 'promo_rejected' ? null : promoCode);
    }
  };

  if (loading && !preview) {
    return (
      <View style={styles.center} testID="checkout-loading">
        <ActivityIndicator size="large" color={theme.colors.brand} />
        <Text style={styles.note}>Calcul de votre total…</Text>
      </View>
    );
  }

  if (!preview) {
    return (
      <View style={styles.center}>
        <Text style={styles.error} testID="checkout-quote-message">
          {problem ?? 'Le total n’a pas pu être calculé.'}
        </Text>
        <BrandButton
          title="Réessayer"
          variant="soft"
          onPress={() => {
            setLoading(true);
            void price(promoCode);
          }}
        />
      </View>
    );
  }

  const p = preview;
  return (
    <>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Section title="Votre commande">
          {p.lines.map((l, i) => (
            <LineRow
              key={`${l.mealId}-${i}`}
              name={l.name}
              quantity={l.quantity}
              options={l.options.map((o) => (o.price > 0 ? `${o.name} (+${mad(o.price)})` : o.name)).join(' · ')}
              total={l.lineTotal}
            />
          ))}
        </Section>

        <Section title="Code promo">
          {promoCode ? (
            <View style={styles.promoApplied}>
              <Ionicons name="pricetag" size={18} color={theme.colors.success} />
              <Text style={styles.promoAppliedText}>{promoCode}</Text>
              <TouchableOpacity onPress={() => void removePromo()} accessibilityRole="button">
                <Text style={styles.link}>Retirer</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.promoRow}>
              <TextInput
                style={styles.promoInput}
                value={promoInput}
                onChangeText={(t) => {
                  setPromoInput(t);
                  setPromoMessage(null);
                }}
                placeholder="Saisir un code"
                placeholderTextColor={theme.colors.inkFaint}
                autoCapitalize="characters"
                autoCorrect={false}
                accessibilityLabel="Code promo"
              />
              <TouchableOpacity style={styles.promoButton} onPress={() => void applyPromo()} disabled={!promoInput.trim() || loading} accessibilityRole="button">
                <Text style={styles.promoButtonText}>Appliquer</Text>
              </TouchableOpacity>
            </View>
          )}
          {promoMessage?.text ? (
            <Text style={[styles.note, { color: promoMessage.ok ? theme.colors.success : theme.colors.error }]} testID="checkout-promo-message">
              {promoMessage.text}
            </Text>
          ) : null}
        </Section>

        <Section title="Total">
          <Row label="Sous-total produits" value={mad(p.productsSubtotal)} />
          {p.promo.discount > 0 ? <Row label={`Code ${p.promo.code}`} value={`-${mad(p.promo.discount)}`} tone="success" /> : null}
          <Row
            label="Frais de service"
            value={p.serviceFee === 0 && p.serviceFeeBeforeDiscount > 0 ? 'Offerts' : mad(p.serviceFee)}
            struck={p.serviceFee === 0 && p.serviceFeeBeforeDiscount > 0 ? mad(p.serviceFeeBeforeDiscount) : undefined}
            tone={p.serviceFee === 0 && p.serviceFeeBeforeDiscount > 0 ? 'success' : undefined}
          />
          <Row
            label={`Livraison (${p.distanceKm.toFixed(1).replace('.', ',')} km)`}
            value={p.deliveryFee === 0 && p.deliveryFeeBeforeDiscount > 0 ? 'Offerte' : mad(p.deliveryFee)}
            struck={p.deliveryFee === 0 && p.deliveryFeeBeforeDiscount > 0 ? mad(p.deliveryFeeBeforeDiscount) : undefined}
            tone={p.deliveryFee === 0 && p.deliveryFeeBeforeDiscount > 0 ? 'success' : undefined}
            testID="checkout-delivery-fee"
          />
          {p.firstOrder ? <Text style={styles.offer}>Première commande : frais de service et de livraison offerts.</Text> : null}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total à payer</Text>
            <Text style={styles.totalValue} testID="checkout-total">
              {mad(p.total)}
            </Text>
          </View>
          <Text style={styles.note}>{TVA_INCLUDED_NOTE}</Text>
        </Section>

        <Section title="Livraison">
          <Text style={styles.detail}>{p.address}</Text>
          <Text style={styles.detail}>{p.phone.e164 ? formatMoroccanMobile(p.phone.e164) : '—'}</Text>
        </Section>
        <PaymentSection />
      </ScrollView>
      <View style={styles.footer}>
        {orderMessage ? (
          <Text style={styles.error} accessibilityLiveRegion="polite" testID="checkout-order-message">
            {orderMessage}
          </Text>
        ) : null}
        <BrandButton
          title={`Confirmer la commande · ${mad(p.total)}`}
          onPress={() => void confirm()}
          loading={placing || loading}
          disabled={!p.phone.verified}
        />
      </View>
    </>
  );
}

// ---------------------------------------------------------------- pieces
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function LineRow({ name, quantity, options, total }: { name: string; quantity: number; options: string; total: number }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineQty}>{`${quantity}×`}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.lineName}>{name}</Text>
        {options ? <Text style={styles.lineOptions}>{options}</Text> : null}
      </View>
      <Text style={styles.lineTotal}>{mad(total)}</Text>
    </View>
  );
}

function Row({ label, value, struck, tone, testID }: { label: string; value: string; struck?: string; tone?: 'success'; testID?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowValueWrap}>
        {struck ? <Text style={styles.struck}>{struck}</Text> : null}
        <Text style={[styles.rowValue, tone === 'success' && { color: theme.colors.success }]} testID={testID}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function PaymentSection() {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Paiement</Text>
      <View style={styles.payment} testID="payment-method-cod">
        <Ionicons name="cash-outline" size={22} color={theme.colors.ink} />
        <Text style={styles.paymentText}>Espèces à la livraison</Text>
        <Ionicons name="checkmark-circle" size={22} color={theme.colors.brand} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md },
  headerTitle: { fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  progress: { paddingHorizontal: theme.spacing.xl, paddingBottom: theme.spacing.sm },
  scroll: { paddingHorizontal: theme.spacing.xl, paddingBottom: theme.spacing['2xl'], gap: theme.spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.lg, padding: theme.spacing.xl },
  stepIntro: { fontSize: theme.typography.sizes.md, lineHeight: theme.typography.lineHeights.md, color: theme.colors.inkMuted, marginTop: theme.spacing.sm },
  section: { backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg, padding: theme.spacing.lg, gap: theme.spacing.sm },
  sectionTitle: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.bold, color: theme.colors.ink, marginBottom: theme.spacing.xs },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md, paddingVertical: theme.spacing.xs },
  lineQty: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.bold, color: theme.colors.brand, minWidth: 28 },
  lineName: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.semibold, color: theme.colors.ink },
  lineOptions: { fontSize: theme.typography.sizes.sm, lineHeight: theme.typography.lineHeights.sm, color: theme.colors.inkMuted, marginTop: 2 },
  lineTotal: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.semibold, color: theme.colors.ink },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 2 },
  rowLabel: { fontSize: theme.typography.sizes.md, color: theme.colors.inkMuted },
  rowValueWrap: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  rowValue: { fontSize: theme.typography.sizes.md, color: theme.colors.ink, fontWeight: theme.typography.weights.semibold },
  struck: { fontSize: theme.typography.sizes.sm, color: theme.colors.inkFaint, textDecorationLine: 'line-through' },
  offer: { fontSize: theme.typography.sizes.sm, color: theme.colors.success, fontWeight: theme.typography.weights.semibold },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.hairline,
  },
  totalLabel: { fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  totalValue: { fontSize: theme.typography.sizes['2xl'], fontWeight: theme.typography.weights.extrabold, color: theme.colors.ink },
  note: { fontSize: theme.typography.sizes.sm, lineHeight: theme.typography.lineHeights.sm, color: theme.colors.inkMuted },
  detail: { fontSize: theme.typography.sizes.md, color: theme.colors.ink },
  addressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.surface,
    minHeight: 64,
  },
  addressText: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.semibold, color: theme.colors.ink },
  addressCity: { fontSize: theme.typography.sizes.sm, color: theme.colors.inkMuted, marginTop: 2 },
  link: { fontSize: theme.typography.sizes.sm, fontWeight: theme.typography.weights.bold, color: theme.colors.brand },
  promoRow: { flexDirection: 'row', gap: theme.spacing.sm },
  promoInput: {
    flex: 1,
    height: 48,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.canvas,
    paddingHorizontal: theme.spacing.md,
    fontSize: theme.typography.sizes.md,
    color: theme.colors.ink,
  },
  promoButton: { height: 48, paddingHorizontal: theme.spacing.lg, borderRadius: theme.radii.md, backgroundColor: theme.colors.brandSoft, justifyContent: 'center' },
  promoButtonText: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.bold, color: theme.colors.brand },
  promoApplied: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  promoAppliedText: { flex: 1, fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  payment: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  paymentText: { flex: 1, fontSize: theme.typography.sizes.md, color: theme.colors.ink, fontWeight: theme.typography.weights.semibold },
  footer: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    gap: theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.hairline,
    backgroundColor: theme.colors.canvas,
  },
  notice: { gap: theme.spacing.xs },
  noticeTitle: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  noticeText: { fontSize: theme.typography.sizes.sm, lineHeight: theme.typography.lineHeights.sm, color: theme.colors.inkMuted },
  error: { fontSize: theme.typography.sizes.sm, lineHeight: theme.typography.lineHeights.sm, color: theme.colors.error, fontWeight: theme.typography.weights.semibold },
});
