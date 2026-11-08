// Badge colour per order status on the staff screens.
import { theme } from '../theme';

export const STAFF_STATUS_COLOR: Record<string, string> = {
  pending: theme.colors.pending,
  confirmed: theme.colors.brand,
  preparing: theme.colors.preparing,
  ready: theme.colors.movement,
  picked_up: theme.colors.onTheWay,
  on_the_way: theme.colors.onTheWay,
  delivered: theme.colors.delivered,
  cancelled: theme.colors.cancelled,
};
