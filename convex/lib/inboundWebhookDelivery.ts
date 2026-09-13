/** Minimum gap between delivery-status writes for one endpoint, in ms. */
export const DELIVERY_WRITE_INTERVAL_MS = 10_000;

export type DeliveryState = {
  lastDeliveryAt?: number;
  lastStatus?: number;
  lastError?: string;
};

/**
 * Whether a delivery's outcome is worth a write. A burst of deliveries to one
 * endpoint would otherwise serialize on its row, so an unchanged outcome is
 * recorded at most once per interval; a changed status or error always is.
 */
export function shouldRecordDelivery(
  previous: DeliveryState,
  status: number,
  error: string | undefined,
  now: number
): boolean {
  if (previous.lastStatus !== status || previous.lastError !== error) {
    return true;
  }
  return previous.lastDeliveryAt === undefined || now - previous.lastDeliveryAt >= DELIVERY_WRITE_INTERVAL_MS;
}
