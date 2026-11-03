import { useMemo } from "react";

export function useBadgeLabel(months: number): string {
  return useMemo(() => (months >= 12 ? "Year one" : `${months} months`), [months]);
}
