// Meal choices, cart lines and phone formatting (pure). The server re-checks
// every choice and computes the charged price; these only guide the customer.
import {
  chosenOptions,
  describeOptions,
  formatMad,
  groupHint,
  lineKey,
  missingChoices,
  popularityLabel,
  toggleOption,
  unitPrice,
  type OptionGroup,
} from '../src/menu/customization';
import { formatMoroccanMobile, normalizeMoroccanMobile } from '../src/phone/moroccanPhone';
import { useCartStore } from '../src/stores/cartStore';
import { toGroups } from '../src/services/menuApi';

const GROUPS: OptionGroup[] = [
  { id: 'g-sauce', name: 'Sauce', minSelect: 1, maxSelect: 1, options: [{ id: 's1', name: 'Harissa', priceDelta: 0 }, { id: 's2', name: 'Algérienne', priceDelta: 0 }] },
  { id: 'g-extra', name: 'Suppléments', minSelect: 0, maxSelect: 2, options: [{ id: 'e1', name: 'Fromage', priceDelta: 5 }, { id: 'e2', name: 'Oeuf', priceDelta: 4.5 }, { id: 'e3', name: 'Avocat', priceDelta: 8 }] },
  { id: 'g-remove', name: 'Retirer', minSelect: 0, maxSelect: 3, options: [{ id: 'r1', name: 'Sans oignon', priceDelta: 0 }] },
];

describe('choices', () => {
  it('a single choice swaps; a required single choice cannot be emptied', () => {
    let s = toggleOption(GROUPS, [], 'g-sauce', 's1');
    expect(s).toEqual(['s1']);
    s = toggleOption(GROUPS, s, 'g-sauce', 's2');
    expect(s).toEqual(['s2']);
    expect(toggleOption(GROUPS, s, 'g-sauce', 's2')).toEqual(['s2']);
  });

  it('a multiple choice toggles up to its maximum', () => {
    let s = toggleOption(GROUPS, ['s1'], 'g-extra', 'e1');
    s = toggleOption(GROUPS, s, 'g-extra', 'e2');
    expect(toggleOption(GROUPS, s, 'g-extra', 'e3')).toEqual(['s1', 'e1', 'e2']); // max 2
    expect(toggleOption(GROUPS, s, 'g-extra', 'e1')).toEqual(['s1', 'e2']);
    expect(toggleOption(GROUPS, s, 'g-extra', 'unknown')).toBe(s);
  });

  it('required choices are reported until made', () => {
    expect(missingChoices(GROUPS, [])).toEqual(['Sauce']);
    expect(missingChoices(GROUPS, ['s1'])).toEqual([]);
    expect(groupHint(GROUPS[0])).toBe('Obligatoire · 1 choix');
    expect(groupHint(GROUPS[1])).toBe('Facultatif · jusqu’à 2');
  });

  it('the price shown updates with paid extras (centimes, no float drift)', () => {
    const opts = chosenOptions(GROUPS, ['s1', 'e1', 'e2', 'r1']);
    expect(unitPrice(50, opts)).toBe(59.5);
    expect(unitPrice(0.1, [{ price: 0.2 }])).toBe(0.3);
    expect(describeOptions(opts)).toBe('Harissa · Fromage (+5 MAD) · Oeuf (+4,50 MAD) · Sans oignon');
    expect(formatMad(119)).toBe('119 MAD');
    expect(formatMad(59.5)).toBe('59,50 MAD');
    expect(formatMad(1250)).toBe('1 250 MAD');
  });

  it('the cart line is the meal plus its set of choices, whatever the order', () => {
    expect(lineKey('m', ['b', 'a'])).toBe(lineKey('m', ['a', 'b']));
    expect(lineKey('m', [])).toBe('m');
  });

  it('only configured, available choices are shown; empty groups are hidden', () => {
    const groups = toGroups([
      { id: 'g2', name: 'B', min_select: 0, max_select: 1, sort_order: 2, meal_options: [{ id: 'o', name: 'x', price_delta: '2.50', sort_order: 1 }] },
      { id: 'g1', name: 'A', min_select: 1, max_select: 1, sort_order: 1, meal_options: [] },
    ]);
    expect(groups).toEqual([{ id: 'g2', name: 'B', minSelect: 0, maxSelect: 1, options: [{ id: 'o', name: 'x', priceDelta: 2.5 }] }]);
  });
});

describe('popularity', () => {
  it('shows the real count, rounded down, and hides small or missing numbers', () => {
    expect(popularityLabel(null)).toBeNull();
    expect(popularityLabel(9)).toBeNull();
    expect(popularityLabel(37)).toBe('Déjà commandé par 37 clients');
    expect(popularityLabel(128)).toBe('Déjà commandé par plus de 120 clients');
    expect(popularityLabel(5432)).toBe('Déjà commandé par plus de 5 400 clients');
  });
});

describe('cart lines', () => {
  const bowl = { id: 'bowl', name: 'Bol', price: 50, calories: 500, protein: 30 };
  const harissa = { id: 's1', name: 'Harissa', group: 'Sauce', price: 0 };
  const cheese = { id: 'e1', name: 'Fromage', group: 'Suppléments', price: 5 };
  beforeEach(() => useCartStore.setState({ ownerId: 'u', items: [] }));

  it('the same meal with other choices is another line; identical choices add up', () => {
    const { addItem } = useCartStore.getState();
    addItem({ ...bowl, options: [harissa] }, 1);
    addItem({ ...bowl, options: [harissa, cheese] }, 2);
    addItem({ ...bowl, options: [harissa] }, 1);
    const items = useCartStore.getState().items;
    expect(items.map((i) => [i.mealId, i.options.map((o) => o.name).join('+'), i.quantity, i.price])).toEqual([
      ['bowl', 'Harissa', 2, 50],
      ['bowl', 'Harissa+Fromage', 2, 55],
    ]);
    expect(useCartStore.getState().getTotalPrice()).toBe(210);
  });

  it('editing a line replaces it in place, or merges it with an identical line', () => {
    const { addItem } = useCartStore.getState();
    addItem({ ...bowl, options: [harissa] }, 1);
    addItem({ ...bowl, options: [harissa, cheese] }, 1);
    const [first, second] = useCartStore.getState().items;
    useCartStore.getState().replaceItem(first.id, { ...bowl, options: [harissa], notes: 'bien cuit' }, 3);
    expect(useCartStore.getState().items[0]).toMatchObject({ id: first.id, quantity: 3, notes: 'bien cuit' });
    useCartStore.getState().replaceItem(second.id, { ...bowl, options: [harissa] }, 1);
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useCartStore.getState().items[0].quantity).toBe(4);
    useCartStore.getState().updateQuantity(first.id, 99);
    expect(useCartStore.getState().items[0].quantity).toBe(20); // the server's maximum
  });
});

describe('Moroccan mobile numbers', () => {
  it('normalises like the server and formats for display', () => {
    expect(normalizeMoroccanMobile('06 12 34 56 78')).toBe('+212612345678');
    expect(normalizeMoroccanMobile('+212 7 12 34 56 78')).toBe('+212712345678');
    expect(normalizeMoroccanMobile('00212612345678')).toBe('+212612345678');
    expect(normalizeMoroccanMobile('+212 (0)6-12-34-56-78')).toBe('+212612345678');
    expect(normalizeMoroccanMobile('0522123456')).toBeNull();
    expect(normalizeMoroccanMobile('+33612345678')).toBeNull();
    expect(formatMoroccanMobile('+212612345678')).toBe('06 12 34 56 78');
  });
});
