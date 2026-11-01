import {
  checkFormAnswers,
  emptyFormAnswers,
  type FormAnswers,
  type FormAnswerValue,
  type FormDefinition,
  type FormField,
} from "@shared/user-pages";
import { type FormEvent, useCallback, useId, useRef, useState } from "react";
import { type PageViewer, usePageViewer } from "../viewer/page-viewer";
import { type PageForms, usePageForms } from "./form-environment";
import { FORM_NOT_ACCEPTING_MESSAGE, type FormFailureCopy, formFailureCopy } from "./form-submit";
import { TurnstileChallenge } from "./turnstile";
import type { WidgetOf } from "./types";

const inputClass =
  "mt-1.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-base text-ink disabled:opacity-70";

/**
 * Whether this visitor can send the form from here:
 * - `closed`: Convex says it isn't accepting, or this build can't check an
 *   anonymous visitor.
 * - `elsewhere`: the submit route lives on the user-pages origin, and this
 *   page was opened on another.
 */
export type FormAvailability = "open" | "closed" | "elsewhere";

export function formAvailability(
  accepting: boolean,
  viewer: Pick<PageViewer, "session" | "canSignIn">,
  turnstileSiteKey: string | null
): FormAvailability {
  if (!accepting) {
    return "closed";
  }
  if (!viewer.canSignIn) {
    return "elsewhere";
  }
  return viewer.session.status !== "signed_in" && turnstileSiteKey === null ? "closed" : "open";
}

type FormPhase =
  | { kind: "editing" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "failed"; copy: FormFailureCopy };

/** A public form: answers are checked with the rules Convex uses, then sent through the edge. */
export function FormWidget({ widget }: { widget: WidgetOf<"form"> }) {
  const viewer = usePageViewer();
  const forms = usePageForms();
  if (widget.form === null) {
    return <p className="text-sm text-muted">This form isn't available right now.</p>;
  }
  const availability = formAvailability(widget.accepting, viewer, forms.turnstileSiteKey);
  return (
    <div>
      {widget.form.title !== undefined && <h3 className="text-lg font-semibold">{widget.form.title}</h3>}
      {availability === "open" ? (
        <OpenForm widgetId={widget.id} form={widget.form} viewer={viewer} forms={forms} />
      ) : (
        <ClosedForm form={widget.form} availability={availability} canonicalUrl={viewer.canonicalUrl} />
      )}
    </div>
  );
}

function ClosedForm({
  form,
  availability,
  canonicalUrl,
}: {
  form: FormDefinition;
  availability: Exclude<FormAvailability, "open">;
  canonicalUrl: string;
}) {
  const id = useId();
  const answers = emptyFormAnswers(form.fields);
  return (
    <form aria-describedby={`${id}-closed`} onSubmit={(event) => event.preventDefault()}>
      <p id={`${id}-closed`} className="mt-1 text-sm text-muted">
        {availability === "closed" ? (
          FORM_NOT_ACCEPTING_MESSAGE
        ) : (
          <a className="underline" href={canonicalUrl}>
            Open this page on woofx3 to answer this form.
          </a>
        )}
      </p>
      <fieldset disabled className="mt-4 flex flex-col gap-4">
        {form.fields.map((field) => (
          <FormFieldView
            key={field.id}
            field={field}
            id={`${id}-${field.id}`}
            value={answers[field.id]}
            problem={null}
            onChange={() => {}}
          />
        ))}
        <SubmitButton label={form.submitLabel} />
      </fieldset>
    </form>
  );
}

function OpenForm({
  widgetId,
  form,
  viewer,
  forms,
}: {
  widgetId: string;
  form: FormDefinition;
  viewer: PageViewer;
  forms: PageForms;
}) {
  const id = useId();
  const { fields } = form;
  const [answers, setAnswers] = useState<FormAnswers>(() => emptyFormAnswers(fields));
  const [problems, setProblems] = useState<ReadonlyMap<string, string>>(new Map());
  const [phase, setPhase] = useState<FormPhase>({ kind: "editing" });
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [challengeRound, setChallengeRound] = useState(0);
  const onToken = useCallback((token: string | null) => setTurnstileToken(token), []);
  // Stays the same while the answers do, so resending after a lost response
  // cannot queue them twice; changing an answer makes a new submission.
  const idempotencyKey = useRef<string | null>(null);
  const sessionToken = viewer.session.status === "signed_in" ? viewer.session.sessionToken : null;
  const needsChallenge = sessionToken === null;

  const setAnswer = (fieldId: string, value: FormAnswerValue) => {
    idempotencyKey.current = null;
    setAnswers((current) => ({ ...current, [fieldId]: value }));
    setProblems((current) => {
      const next = new Map(current);
      next.delete(fieldId);
      return next;
    });
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (phase.kind === "sending") {
      return;
    }
    const checked = checkFormAnswers(fields, answers);
    if (checked.kind === "stale") {
      setPhase({ kind: "failed", copy: formFailureCopy("form_stale") });
      return;
    }
    if (checked.kind === "invalid") {
      setProblems(new Map(checked.problems.map((problem) => [problem.fieldId, problem.message])));
      setPhase({ kind: "editing" });
      return;
    }
    if (needsChallenge && turnstileToken === null) {
      setPhase({
        kind: "failed",
        copy: { message: "We're still checking that you're a person. Try again in a moment.", action: null },
      });
      return;
    }
    idempotencyKey.current ??= forms.newIdempotencyKey();
    setPhase({ kind: "sending" });
    const result = await forms.submit({
      slug: forms.slug,
      widgetId,
      idempotencyKey: idempotencyKey.current,
      answers,
      ...(sessionToken !== null ? { sessionToken } : {}),
      ...(needsChallenge && turnstileToken !== null ? { turnstileToken } : {}),
    });
    if (result.ok) {
      setPhase({ kind: "sent" });
      return;
    }
    setPhase({ kind: "failed", copy: formFailureCopy(result.failure) });
    setTurnstileToken(null);
    setChallengeRound((round) => round + 1);
  };

  if (phase.kind === "sent") {
    return <output className="mt-2 block text-base font-medium">Thanks, your answer was sent.</output>;
  }

  const sending = phase.kind === "sending";
  return (
    <form noValidate onSubmit={onSubmit}>
      <fieldset disabled={sending} className="mt-4 flex flex-col gap-4">
        {fields.map((field) => (
          <FormFieldView
            key={field.id}
            field={field}
            id={`${id}-${field.id}`}
            value={answers[field.id]}
            problem={problems.get(field.id) ?? null}
            onChange={(value) => setAnswer(field.id, value)}
          />
        ))}
        {needsChallenge && forms.turnstileSiteKey !== null && (
          <TurnstileChallenge
            key={challengeRound}
            siteKey={forms.turnstileSiteKey}
            load={forms.loadTurnstile}
            onToken={onToken}
          />
        )}
        {phase.kind === "failed" && (
          <FormFailureNotice copy={phase.copy} onReload={forms.reload} onSignIn={viewer.signIn} />
        )}
        <SubmitButton label={sending ? "Sending…" : form.submitLabel} />
      </fieldset>
    </form>
  );
}

function FormFailureNotice({
  copy,
  onReload,
  onSignIn,
}: {
  copy: FormFailureCopy;
  onReload: () => void;
  onSignIn: () => void;
}) {
  return (
    <div role="alert" className="text-sm font-medium">
      <p>{copy.message}</p>
      {copy.action === "reload" && (
        <button type="button" className="mt-1 underline" onClick={onReload}>
          Reload the page
        </button>
      )}
      {copy.action === "sign_in" && (
        <button type="button" className="mt-1 underline" onClick={onSignIn}>
          Sign in again
        </button>
      )}
    </div>
  );
}

function SubmitButton({ label }: { label: string }) {
  return (
    <button
      type="submit"
      className="self-start rounded-lg bg-accent px-4 py-2 font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-60"
    >
      {label}
    </button>
  );
}

function FormFieldView({
  field,
  id,
  value,
  problem,
  onChange,
}: {
  field: FormField;
  id: string;
  value: FormAnswerValue;
  problem: string | null;
  onChange: (value: FormAnswerValue) => void;
}) {
  const label = (
    <>
      {field.label}
      {field.required && <span className="text-muted"> (required)</span>}
    </>
  );
  const problemId = `${id}-problem`;
  const described = problem === null ? {} : { "aria-invalid": true, "aria-describedby": problemId };
  const problemText = problem !== null && (
    <span id={problemId} className="mt-1 block text-sm font-normal">
      {problem}
    </span>
  );
  const text = typeof value === "string" ? value : "";
  switch (field.type) {
    case "text":
      return (
        <label htmlFor={id} className="text-sm font-medium">
          {label}
          <input
            id={id}
            type="text"
            maxLength={field.maxLength}
            required={field.required}
            className={inputClass}
            value={text}
            onChange={(event) => onChange(event.target.value)}
            {...described}
          />
          {problemText}
        </label>
      );
    case "textarea":
      return (
        <label htmlFor={id} className="text-sm font-medium">
          {label}
          <textarea
            id={id}
            rows={4}
            maxLength={field.maxLength}
            required={field.required}
            className={inputClass}
            value={text}
            onChange={(event) => onChange(event.target.value)}
            {...described}
          />
          {problemText}
        </label>
      );
    case "select":
      return (
        <label htmlFor={id} className="text-sm font-medium">
          {label}
          <select
            id={id}
            required={field.required}
            className={inputClass}
            value={text}
            onChange={(event) => onChange(event.target.value)}
            {...described}
          >
            <option value="" disabled={field.required}>
              Choose one
            </option>
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {problemText}
        </label>
      );
    case "checkbox":
      return (
        <div>
          <label htmlFor={id} className="flex items-center gap-2.5 text-sm font-medium">
            <input
              id={id}
              type="checkbox"
              required={field.required}
              className="h-4 w-4 accent-[rgb(var(--accent))]"
              checked={value === true}
              onChange={(event) => onChange(event.target.checked)}
              {...described}
            />
            {label}
          </label>
          {problemText}
        </div>
      );
  }
}
