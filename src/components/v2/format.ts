// French number grouping with a non-breaking space so values like "3 449"
// never wrap across lines.
export const formatNumber = (value: number) =>
  Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');

export const formatPrice = (value: number) => `${formatNumber(value)}\u00A0MAD`;
