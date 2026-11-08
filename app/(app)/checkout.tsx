// Livraison et confirmation: 1. delivery address (confirmed by the customer),
// 2. phone verified by a WhatsApp code, 3. promo code and the order summary
// priced by the server (checkout_preview), then "Confirmer ma commande"
// (cash on delivery). The app computes no charged amount: it shows the
// server's numbers and sends the total the customer saw, which
// create_order() checks.
//
// Checkout is locked (owner decision 2026-11-05) until the trusted order flow
// and pricing are approved and applied on the server; then CHECKOUT_OPEN is
// switched in a reviewed change. While locked, the screen shows the order,
// the fees that will be calculated, and why confirming is not possible yet;
// it calls nothing.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { theme } from '../../src/theme';
import { BrandButton, IconButton } from '../../src/components/v2';
import { CashOnDelivery, Divider, PriceRow, SectionTitle, SummaryLine } from '../../src/components/checkout/OrderPieces';
import { useAuthStore } from '../../src/stores/authStore';
import { useCartStore, type CartItem } from '../../src/stores/cartStore';
import { useCheckoutDraftStore, type CheckoutStep } from '../../src/stores/checkoutDraftStore';
import { useUserStore } from '../../src/stores/userStore';
import { CHECKOUT_CLOSED_MESSAGE, CHECKOUT_CLOSED_TITLE, CHECKOUT_OPEN } from '../../src/checkout/checkoutAvailability';
import { cartTotals, FEE_PENDING_DELIVERY, FEE_PENDING_SERVICE, TVA_INCLUDED_NOTE } from '../../src/checkout/checkoutSummary';
import { describeOptions, formatMad } from '../../src/menu/customization';
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

const STEPS: CheckoutStep[] = ['address', 'phone', 'summary'];
const STEP_LABELS: Record<CheckoutStep, string> = { address: 'Adresse', phone: 'Téléphone', summary: 'Confirmation' };

const toLines = (items: CartItem[]): OrderLineRequest[] =>
  items.map((i) => ({ mealId: i.mealId, quantity: i.quantity, notes: i.notes ?? null, optionIds: i.options.map((o) => o.id) }));

export default function CheckoutScreen() {
  const items = useCartStore((s) => s.items);
  const profile = useUserStore((s) => s.profile);
  const address = profile?.delivery_address?.trim() ?? '';
  const city = profile?.delivery_city ?? null;
  const verifiedPhone = profile?.phone_e164 && profile?.phone_verified_at ? profile.phone_e164 : null;
  const step = useCheckoutDraftStore((s) => s.step);
  const setStep = useCheckoutDraftStore((s) => s.setStep);
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
        <Text style={styles.headerTitle} accessibilityRole="header">
          Livraison et confirmation
        </Text>
        <View style={{ width: 44 }} />
      </View>
      {CHECKOUT_OPEN ? <Steps current={step} /> : null}

      {items.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.stepIntro}>Votre panier est vide.</Text>
          <BrandButton title="Voir le menu" variant="soft" onPress={() => router.replace('/(app)/menu')} />
        </View>
      ) : !CHECKOUT_OPEN ? (
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

function Steps({ current }: { current: CheckoutStep }) {
  const at = STEPS.indexOf(current);
  return (
    <View style={styles.steps} accessibilityLabel={`Étape ${at + 1} sur ${STEPS.length} : ${STEP_LABELS[current]}`}>
      {STEPS.map((s, i) => (
        <View key={s} style={styles.stepItem}>
          <View style={[styles.stepBar, i <= at && styles.stepBarOn]} />
          <Text style={[styles.stepLabel, i === at && styles.stepLabelOn]}>{STEP_LABELS[s]}</Text>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- closed (today)
function ClosedCheckout({ items, outOfZone, city }: { items: CartItem[]; outOfZone: boolean; city: string | null }) {
  const totals = cartTotals(items);
  return (
    <>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <SectionTitle>Récapitulatif de votre commande</SectionTitle>
          {items.map((i) => (
            <SummaryLine
              key={i.id}
              name={i.name}
              quantity={i.quantity}
              options={describeOptions(i.options)}
              note={i.notes}
              amount={Math.round(i.price * 100 * i.quantity) / 100}
              image={i.image ?? null}
            />
          ))}
          <Divider />
          <PriceRow label="Sous-total produits" value={formatMad(totals.productsSubtotal)} />
          <PriceRow label="Frais de service" value={FEE_PENDING_SERVICE} pending />
          <PriceRow label="Frais de livraison" value={FEE_PENDING_DELIVERY} pending testID="checkout-delivery-fee" />
          <Text style={styles.note}>{TVA_INCLUDED_NOTE}</Text>
        </View>
        <View style={styles.card}>
          <CashOnDelivery />
        </View>
        {outOfZone ? (
          <View style={styles.notice} testID="checkout-out-of-zone">
            <Text style={styles.noticeTitle}>Pas encore dans votre ville</Text>
            <Text style={styles.noticeText}>{notServedMessage(city)}</Text>
          </View>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        <View style={styles.reason} testID="checkout-closed" accessibilityLiveRegion="polite">
          <Ionicons name="time-outline" size={18} color={theme.colors.inkMuted} />
          <View style={{ flex: 1 }}>
            <Text style={styles.reasonTitle}>{CHECKOUT_CLOSED_TITLE}</Text>
            <Text style={styles.reasonText}>{CHECKOUT_CLOSED_MESSAGE}</Text>
          </View>
        </View>
        <BrandButton title="Confirmer ma commande" onPress={() => undefined} disabled />
      </View>
    </>
  );
}

// ---------------------------------------------------------------- 1. address
function AddressStep({ address, city, outOfZone, onNext }: { address: string; city: string | null; outOfZone: boolean; onNext: () => void }) {
  const ready = address.length >= 5 && !!city && !outOfZone;
  const reason = !address
    ? 'Ajoutez votre adresse de livraison pour continuer.'
    : !city
      ? 'Indiquez la ville de cette adresse (Modifier).'
      : null;
  return (
    <>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.stepIntro}>Où devons-nous livrer votre commande ?</Text>
        {address ? (
          <View style={[styles.card, styles.addressCard]} testID="checkout-address">
            <Ionicons name="radio-button-on" size={22} color={theme.colors.brand} />
            <View style={{ flex: 1 }}>
              <Text style={styles.addressText}>{address}</Text>
              <Text style={styles.addressMeta}>{cityName(city) ?? 'Ville à indiquer'}</Text>
            </View>
            <TouchableOpacity onPress={() => router.push('/(app)/delivery-address')} style={styles.inlineAction} accessibilityRole="button" accessibilityLabel="Modifier l’adresse de livraison">
              <Text style={styles.link}>Modifier</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={[styles.card, styles.addressCard]} onPress={() => router.push('/(app)/delivery-address')} accessibilityRole="button">
            <Ionicons name="add-circle-outline" size={22} color={theme.colors.brand} />
            <Text style={[styles.link, { flex: 1 }]}>Ajouter une adresse de livraison</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.note}>Vous pouvez utiliser votre position pour la proposer, puis la vérifier.</Text>
        {outOfZone ? (
          <View style={styles.notice} testID="checkout-out-of-zone">
            <Text style={styles.noticeTitle}>Pas encore dans votre ville</Text>
            <Text style={styles.noticeText}>{notServedMessage(city)}</Text>
          </View>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        {reason ? <Text style={styles.reasonText}>{reason}</Text> : null}
        <BrandButton title="Livrer à cette adresse" onPress={onNext} disabled={!ready} />
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
  // The local part after +212 (e.g. "6 12 34 56 78"); "06…" is accepted too.
  const [phone, setPhone] = useState(() => localPart(verifiedPhone ?? normalizeMoroccanMobile(typedBefore)));
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

  const normalized = normalizeMoroccanMobile(phone) ?? normalizeMoroccanMobile(`0${phone.replace(/^\s*0?/, '')}`);

  const send = async () => {
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
          <Text style={styles.stepIntro}>Le livreur vous appellera à ce numéro si besoin.</Text>
          <View style={[styles.card, styles.addressCard]} testID="checkout-phone-verified">
            <Ionicons name="logo-whatsapp" size={22} color={theme.colors.success} />
            <View style={{ flex: 1 }}>
              <Text style={styles.addressText}>{formatMoroccanMobile(verifiedPhone)}</Text>
              <View style={styles.verified}>
                <Ionicons name="checkmark-circle" size={14} color={theme.colors.success} />
                <Text style={styles.verifiedText}>Numéro vérifié</Text>
              </View>
            </View>
            <TouchableOpacity onPress={() => setChanging(true)} style={styles.inlineAction} accessibilityRole="button">
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
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Numéro de mobile</Text>
          <View style={styles.phoneRow}>
            <View style={styles.prefix}>
              <Text style={styles.prefixText}>+212</Text>
            </View>
            <TextInput
              style={styles.phoneInput}
              value={phone}
              onChangeText={(t) => {
                setPhone(t);
                setMessage(null);
                setSent(null);
              }}
              placeholder="6 12 34 56 78"
              placeholderTextColor={theme.colors.inkFaint}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              editable={!busy}
              accessibilityLabel="Numéro de mobile"
            />
          </View>
          {sent ? (
            <>
              <Text style={[styles.note, { marginTop: theme.spacing.lg }]}>
                {`Code envoyé sur WhatsApp au ${formatMoroccanMobile(sent.to)}. Il est valable 10 minutes.`}
              </Text>
              <Text style={[styles.fieldLabel, { marginTop: theme.spacing.md }]}>Code à 6 chiffres</Text>
              <TextInput
                style={[styles.phoneInput, styles.codeInput]}
                value={code}
                onChangeText={(t) => {
                  setCode(t.replace(/\D/g, '').slice(0, 6));
                  setMessage(null);
                }}
                placeholder="123456"
                placeholderTextColor={theme.colors.inkFaint}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                maxLength={6}
                accessibilityLabel="Code à 6 chiffres"
              />
            </>
          ) : null}
        </View>
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

// "+212612345678" -> "6 12 34 56 78"
function localPart(e164: string | null | undefined): string {
  const f = formatMoroccanMobile(e164 ?? '');
  return f.startsWith('0') ? f.slice(1) : '';
}

// ---------------------------------------------------------------- 3. summary
function SummaryStep({ items, onNeedPhone, onNeedAddress }: { items: CartItem[]; onNeedPhone: () => void; onNeedAddress: () => void }) {
  const clearCart = useCartStore((s) => s.clearCart);
  const promoCode = useCheckoutDraftStore((s) => s.promoCode);
  const setPromoCode = useCheckoutDraftStore((s) => s.setPromoCode);
  const resetDraft = useCheckoutDraftStore((s) => s.reset);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<CheckoutPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [promoInput, setPromoInput] = useState('');
  const [promoMessage, setPromoMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [placing, setPlacing] = useState(false);
  const [orderMessage, setOrderMessage] = useState<string | null>(null);
  // One request id per checkout attempt: a retry after a lost answer returns
  // the same order instead of creating a second one.
  const requestId = useRef<string | null>(null);
  const lines = toLines(items);
  // The basket as sent to the server: when it changes (back from the cart),
  // the order is priced again.
  const basket = JSON.stringify(lines);
  const images = new Map(items.map((i) => [i.mealId, i.image ?? null]));

  // Road-distance quote first (server), then the server's price of the cart.
  // Callers that are not the first load set `loading` themselves.
  const price = useCallback(async (code: string | null, cart: OrderLineRequest[]) => {
    const q = await requestDeliveryQuote();
    setProblem(null);
    if (!q.ok) {
      setPreview(null);
      setProblem(q.message);
      setLoading(false);
      return null;
    }
    const r = await previewCheckout({ kitchenId: q.quote.kitchenId, items: cart, promoCode: code });
    setLoading(false);
    if (!r.ok) {
      setPreview(null);
      setProblem(r.message);
      return null;
    }
    setPreview(r.preview);
    return r.preview;
  }, []);

  useEffect(() => {
    // State is set when the server answers (after the quote).
    void Promise.resolve().then(() => price(promoCode, JSON.parse(basket) as OrderLineRequest[]));
    requestId.current = null; // another basket is another order attempt
    // promoCode changes are priced by their own handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basket, price]);

  const reprice = async (code: string | null) => {
    setLoading(true);
    return price(code, lines);
  };

  const applyPromo = async () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    const p = await reprice(code);
    if (!p) return;
    const ok = p.promo.status === 'valid';
    setPromoCode(ok ? code : null);
    if (ok) setPromoInput('');
    setPromoMessage(p.promo.status === 'none' ? null : { ok, text: PROMO_MESSAGES[p.promo.status] });
  };

  const removePromo = async () => {
    setPromoCode(null);
    setPromoMessage(null);
    await reprice(null);
  };

  const confirm = async () => {
    if (!preview || placing) return;
    requestId.current ??= randomUUID();
    setPlacing(true);
    setOrderMessage(null);
    const r = await createOrder({ kitchenId: preview.kitchenId, items: lines, requestId: requestId.current, expectedTotal: preview.total, promoCode });
    setPlacing(false);
    if (r.ok) {
      requestId.current = null;
      clearCart();
      resetDraft();
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
      await reprice(r.reason === 'promo_rejected' ? null : promoCode);
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
        <Ionicons name="alert-circle-outline" size={32} color={theme.colors.inkMuted} />
        <Text style={[styles.error, { textAlign: 'center' }]} testID="checkout-quote-message">
          {problem ?? 'Le total n’a pas pu être calculé.'}
        </Text>
        <BrandButton title="Réessayer" variant="soft" onPress={() => void reprice(promoCode)} />
        <TouchableOpacity onPress={onNeedAddress} accessibilityRole="button" style={styles.inlineAction}>
          <Text style={styles.link}>Vérifier mon adresse</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const p = preview;
  const serviceOffered = p.serviceFee === 0 && p.serviceFeeBeforeDiscount > 0;
  const deliveryOffered = p.deliveryFee === 0 && p.deliveryFeeBeforeDiscount > 0;
  return (
    <>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <SectionTitle
            action={
              <TouchableOpacity onPress={() => router.push('/(app)/cart')} style={styles.inlineAction} accessibilityRole="button">
                <Text style={styles.link}>Modifier le panier</Text>
              </TouchableOpacity>
            }
          >
            Votre commande
          </SectionTitle>
          {p.lines.map((l, i) => (
            <SummaryLine
              key={`${l.mealId}-${i}`}
              name={l.name}
              quantity={l.quantity}
              options={l.options.map((o) => (o.price > 0 ? `${o.name} (+${formatMad(o.price)})` : o.name)).join(' · ')}
              amount={l.lineTotal}
              image={images.get(l.mealId) ?? null}
            />
          ))}
        </View>

        <View style={styles.card}>
          <SectionTitle>Code promo</SectionTitle>
          {promoCode && p.promo.status === 'valid' ? (
            <View style={styles.promoApplied}>
              <Ionicons name="pricetag" size={18} color={theme.colors.success} />
              <Text style={styles.promoAppliedText}>{promoCode}</Text>
              <TouchableOpacity onPress={() => void removePromo()} style={styles.inlineAction} accessibilityRole="button">
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
              <TouchableOpacity
                style={[styles.promoButton, (!promoInput.trim() || loading) && { opacity: 0.5 }]}
                onPress={() => void applyPromo()}
                disabled={!promoInput.trim() || loading}
                accessibilityRole="button"
              >
                <Text style={styles.promoButtonText}>Appliquer</Text>
              </TouchableOpacity>
            </View>
          )}
          {promoMessage ? (
            <Text style={[styles.note, { color: promoMessage.ok ? theme.colors.success : theme.colors.error }]} testID="checkout-promo-message">
              {promoMessage.text}
            </Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <SectionTitle>Récapitulatif de votre commande</SectionTitle>
          <PriceRow label="Sous-total produits" value={formatMad(p.productsSubtotal)} />
          {p.promo.discount > 0 ? <PriceRow label={`Réduction (${p.promo.code})`} value={`-${formatMad(p.promo.discount)}`} tone="success" /> : null}
          <PriceRow
            label="Frais de service"
            value={serviceOffered ? 'Offerts' : formatMad(p.serviceFee)}
            struck={serviceOffered ? formatMad(p.serviceFeeBeforeDiscount) : undefined}
            tone={serviceOffered ? 'success' : undefined}
          />
          <PriceRow
            label="Frais de livraison"
            value={deliveryOffered ? 'Offerts' : formatMad(p.deliveryFee)}
            struck={deliveryOffered ? formatMad(p.deliveryFeeBeforeDiscount) : undefined}
            tone={deliveryOffered ? 'success' : undefined}
            testID="checkout-delivery-fee"
          />
          {p.firstOrder ? <Text style={styles.offer}>Première commande : service et livraison offerts.</Text> : null}
          <Divider />
          <PriceRow label="Total à payer" value={formatMad(p.total)} strong testID="checkout-total" />
          <Text style={styles.note}>{`${TVA_INCLUDED_NOTE} Livraison calculée sur ${p.distanceKm.toFixed(1).replace('.', ',')} km.`}</Text>
        </View>

        <View style={styles.card}>
          <SectionTitle>Livraison</SectionTitle>
          <View style={styles.detailRow}>
            <Ionicons name="location-outline" size={18} color={theme.colors.inkMuted} />
            <Text style={styles.detailText}>{p.address}</Text>
            <TouchableOpacity onPress={onNeedAddress} style={styles.inlineAction} accessibilityRole="button" accessibilityLabel="Modifier l’adresse">
              <Text style={styles.link}>Modifier</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.detailRow}>
            <Ionicons name="call-outline" size={18} color={theme.colors.inkMuted} />
            <Text style={styles.detailText}>
              {p.phone.e164 ? `${formatMoroccanMobile(p.phone.e164)}${p.phone.verified ? ' · vérifié' : ''}` : '—'}
            </Text>
            <TouchableOpacity onPress={onNeedPhone} style={styles.inlineAction} accessibilityRole="button" accessibilityLabel="Modifier le téléphone">
              <Text style={styles.link}>Modifier</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          <CashOnDelivery amount={p.total} />
        </View>
      </ScrollView>
      <View style={styles.footer}>
        {orderMessage ? (
          <Text style={styles.error} accessibilityLiveRegion="polite" testID="checkout-order-message">
            {orderMessage}
          </Text>
        ) : null}
        {!p.phone.verified ? <Text style={styles.reasonText}>Vérifiez votre numéro de téléphone pour confirmer.</Text> : null}
        <BrandButton
          title={`Confirmer ma commande · ${formatMad(p.total)}`}
          onPress={() => void confirm()}
          loading={placing || loading}
          disabled={!p.phone.verified}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  steps: { flexDirection: 'row', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.xl, paddingBottom: theme.spacing.md },
  stepItem: { flex: 1, gap: 6 },
  stepBar: { height: 4, borderRadius: 2, backgroundColor: theme.colors.hairline },
  stepBarOn: { backgroundColor: theme.colors.brand },
  stepLabel: { fontSize: theme.typography.sizes.xs, color: theme.colors.inkMuted, fontWeight: theme.typography.weights.semibold },
  stepLabelOn: { color: theme.colors.brand },
  scroll: { paddingHorizontal: theme.spacing.xl, paddingBottom: theme.spacing['2xl'], gap: theme.spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.lg, padding: theme.spacing.xl },
  stepIntro: { fontSize: theme.typography.sizes.md, lineHeight: theme.typography.lineHeights.md, color: theme.colors.inkMuted, marginTop: theme.spacing.xs },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg, padding: theme.spacing.lg },
  note: { fontSize: theme.typography.sizes.sm, lineHeight: theme.typography.lineHeights.sm, color: theme.colors.inkMuted, marginTop: theme.spacing.xs },
  offer: { fontSize: theme.typography.sizes.sm, color: theme.colors.success, fontWeight: theme.typography.weights.semibold, marginTop: theme.spacing.xs },
  addressCard: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, minHeight: 64 },
  addressText: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.semibold, color: theme.colors.ink },
  addressMeta: { fontSize: theme.typography.sizes.sm, color: theme.colors.inkMuted, marginTop: 2 },
  inlineAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.spacing.xs },
  link: { fontSize: theme.typography.sizes.sm, fontWeight: theme.typography.weights.bold, color: theme.colors.brand },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  verifiedText: { fontSize: theme.typography.sizes.sm, color: theme.colors.success, fontWeight: theme.typography.weights.semibold },
  fieldLabel: { fontSize: theme.typography.sizes.sm, fontWeight: theme.typography.weights.semibold, color: theme.colors.ink, marginBottom: theme.spacing.sm },
  phoneRow: { flexDirection: 'row', gap: theme.spacing.sm },
  prefix: { height: 52, paddingHorizontal: theme.spacing.md, borderRadius: theme.radii.md, backgroundColor: theme.colors.canvas, justifyContent: 'center' },
  prefixText: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.semibold, color: theme.colors.ink },
  phoneInput: {
    flex: 1,
    height: 52,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.canvas,
    paddingHorizontal: theme.spacing.md,
    fontSize: theme.typography.sizes.lg,
    color: theme.colors.ink,
  },
  codeInput: { flex: 0, letterSpacing: 6, textAlign: 'center' },
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
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  detailText: { flex: 1, fontSize: theme.typography.sizes.md, color: theme.colors.ink },
  footer: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    gap: theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.hairline,
    backgroundColor: theme.colors.surface,
  },
  reason: { flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'flex-start' },
  reasonTitle: { fontSize: theme.typography.sizes.sm, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  reasonText: { fontSize: theme.typography.sizes.sm, lineHeight: theme.typography.lineHeights.sm, color: theme.colors.inkMuted },
  notice: { gap: theme.spacing.xs, padding: theme.spacing.lg, borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface },
  noticeTitle: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  noticeText: { fontSize: theme.typography.sizes.sm, lineHeight: theme.typography.lineHeights.sm, color: theme.colors.inkMuted },
  error: { fontSize: theme.typography.sizes.sm, lineHeight: theme.typography.lineHeights.sm, color: theme.colors.error, fontWeight: theme.typography.weights.semibold },
});
