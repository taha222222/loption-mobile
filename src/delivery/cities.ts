// src/delivery/cities.ts
// Where L'OPTION delivers. The server is the authority (public.delivery_zones,
// 20261107120000_v1_delivery_zones.sql; create_order() refuses other cities);
// this file only lets the customer pick their city and tells them early when
// it is not served yet. Launch (owner decision 2026-11-06): Casablanca only,
// from Kitchen A; other cities are opened later as new zones.
import { supabase } from '../lib/supabase';

export const LAUNCH_CITY = 'casablanca';

// Keys stored in user_profiles.delivery_city (^[a-z][a-z_]{1,39}$).
export const CITY_OPTIONS: readonly { key: string; name: string }[] = [
  { key: 'casablanca', name: 'Casablanca' },
  { key: 'rabat', name: 'Rabat' },
  { key: 'marrakech', name: 'Marrakech' },
  { key: 'fes', name: 'Fès' },
  { key: 'tanger', name: 'Tanger' },
  { key: 'agadir', name: 'Agadir' },
  { key: 'meknes', name: 'Meknès' },
  { key: 'oujda', name: 'Oujda' },
  { key: 'kenitra', name: 'Kénitra' },
  { key: 'tetouan', name: 'Tétouan' },
  { key: 'sale', name: 'Salé' },
  { key: 'mohammedia', name: 'Mohammédia' },
  { key: 'el_jadida', name: 'El Jadida' },
  { key: 'autre', name: 'Autre ville' },
];

export const cityName = (key: string | null | undefined): string | null =>
  key ? (CITY_OPTIONS.find((c) => c.key === key)?.name ?? key) : null;

// Other spellings returned by the phone's reverse geocoding.
const ALIASES: Record<string, string> = {
  casa: 'casablanca',
  'dar el beida': 'casablanca',
  'dar el baida': 'casablanca',
  'ad dar al bayda': 'casablanca',
  'الدار البيضاء': 'casablanca',
  'الرباط': 'rabat',
  'مراكش': 'marrakech',
  'فاس': 'fes',
  'طنجة': 'tanger',
  tangier: 'tanger',
  fez: 'fes',
  'أكادير': 'agadir',
  'مكناس': 'meknes',
  'وجدة': 'oujda',
  'القنيطرة': 'kenitra',
  'تطوان': 'tetouan',
  'سلا': 'sale',
  'المحمدية': 'mohammedia',
  'الجديدة': 'el_jadida',
};

// The city key of a geocoded city name, or null when it is not in the list.
export function cityKeyFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const plain = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return null;
  const alias = ALIASES[plain] ?? ALIASES[name.trim()];
  if (alias) return alias;
  const byKey = CITY_OPTIONS.find((c) => c.key !== 'autre' && (c.key === plain.replace(/ /g, '_') || c.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === plain));
  return byKey ? byKey.key : null;
}

// Served cities from the server; null when the server does not have zones
// yet (then nothing is promised either way).
export async function fetchServedCities(): Promise<string[] | null> {
  try {
    const { data, error } = await supabase.from('delivery_zones').select('city_key');
    if (error) return null; // incl. a server without zones (isMissingServerFeature)
    return (data ?? []).map((r: { city_key: string }) => r.city_key);
  } catch {
    return null;
  }
}

// Message for a customer whose city is not served yet (French).
export function notServedMessage(key: string | null | undefined): string {
  const name = key && key !== 'autre' ? cityName(key) : null;
  return `${name ? `La livraison n’est pas encore disponible à ${name}.` : 'La livraison n’est pas encore disponible dans votre ville.'} L’OPTION livre d’abord à Casablanca et arrivera bientôt dans d’autres villes. Votre adresse est enregistrée : vous pourrez commander dès que votre ville sera ouverte.`;
}
