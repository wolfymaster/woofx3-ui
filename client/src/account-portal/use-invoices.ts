import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Invoice } from "@convex/lib/billingClient";
import { useAction } from "convex/react";
import { useEffect, useState } from "react";
import { actionErrorMessage } from "@/lib/action-error";
import { billingErrorCode } from "./billing-view";

export type InvoiceList =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "ready"; invoices: Invoice[] };

/** The organization's invoices when the viewer manages its billing; nobody else's. */
export function useInvoices(accountId: Id<"accounts"> | null): InvoiceList {
  const listInvoices = useAction(api.billingCommands.invoices);
  const [list, setList] = useState<InvoiceList>(
    accountId === null ? { state: "ready", invoices: [] } : { state: "loading" }
  );
  useEffect(() => {
    if (accountId === null) {
      setList({ state: "ready", invoices: [] });
      return;
    }
    let current = true;
    setList({ state: "loading" });
    listInvoices({ accountId: accountId }).then(
      (invoices) => {
        if (current) {
          setList({ state: "ready", invoices: invoices ?? [] });
        }
      },
      (error: unknown) => {
        if (!current) {
          return;
        }
        // An organization with no billing yet, such as one with only self-hosted engines, has no invoices to list.
        setList(
          billingErrorCode(error) === "subscription_not_found"
            ? { state: "ready", invoices: [] }
            : { state: "failed", message: actionErrorMessage(error) }
        );
      }
    );
    return () => {
      current = false;
    };
  }, [listInvoices, accountId]);
  return list;
}
