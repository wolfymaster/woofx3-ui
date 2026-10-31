import { createContext, type ReactNode, useContext } from "react";
import type { FormSubmitRequest, FormSubmitResult } from "./form-submit";
import type { TurnstileApi } from "./turnstile";

/** What a form needs from outside React, built once by main.tsx. */
export interface FormEnvironment {
  submit: (request: FormSubmitRequest) => Promise<FormSubmitResult>;
  /** Null when the page was built without one: anonymous visitors then can't send. */
  turnstileSiteKey: string | null;
  loadTurnstile: () => Promise<TurnstileApi>;
  newIdempotencyKey: () => string;
  reload: () => void;
}

export interface PageForms extends FormEnvironment {
  slug: string;
}

const PageFormsContext = createContext<PageForms | null>(null);

export function PageFormsProvider({ forms, children }: { forms: PageForms; children: ReactNode }) {
  return <PageFormsContext.Provider value={forms}>{children}</PageFormsContext.Provider>;
}

export function usePageForms(): PageForms {
  const forms = useContext(PageFormsContext);
  if (forms === null) {
    throw new Error("usePageForms needs a PageFormsProvider");
  }
  return forms;
}
