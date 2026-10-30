import type { FormField } from "@shared/user-pages";
import { useId } from "react";
import type { WidgetOf } from "./types";

const inputClass =
  "mt-1.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-base text-ink disabled:opacity-70";

/**
 * A form's questions, shown so visitors see what it will ask. Answers are not
 * accepted yet, so every field is disabled and the form says so; nothing is
 * sent or pretended to be.
 */
export function FormWidget({ widget }: { widget: WidgetOf<"form"> }) {
  const id = useId();
  const noticeId = `${id}-closed`;
  return (
    <form aria-describedby={noticeId} onSubmit={(event) => event.preventDefault()}>
      {widget.config.title !== undefined && <h3 className="text-lg font-semibold">{widget.config.title}</h3>}
      <p id={noticeId} className="mt-1 text-sm text-muted">
        This form isn't taking answers yet.
      </p>
      <fieldset disabled className="mt-4 flex flex-col gap-4">
        {widget.config.fields.map((field) => (
          <FormFieldView key={field.id} field={field} id={`${id}-${field.id}`} />
        ))}
        <button
          type="submit"
          className="self-start rounded-lg bg-accent px-4 py-2 font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {widget.config.submitLabel}
        </button>
      </fieldset>
    </form>
  );
}

function FormFieldView({ field, id }: { field: FormField; id: string }) {
  const label = (
    <>
      {field.label}
      {field.required && <span className="text-muted"> (required)</span>}
    </>
  );
  switch (field.type) {
    case "text":
      return (
        <label htmlFor={id} className="text-sm font-medium">
          {label}
          <input id={id} type="text" maxLength={field.maxLength} required={field.required} className={inputClass} />
        </label>
      );
    case "textarea":
      return (
        <label htmlFor={id} className="text-sm font-medium">
          {label}
          <textarea id={id} rows={4} maxLength={field.maxLength} required={field.required} className={inputClass} />
        </label>
      );
    case "select":
      return (
        <label htmlFor={id} className="text-sm font-medium">
          {label}
          <select id={id} required={field.required} className={inputClass} defaultValue="">
            <option value="" disabled>
              Choose one
            </option>
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      );
    case "checkbox":
      return (
        <label htmlFor={id} className="flex items-center gap-2.5 text-sm font-medium">
          <input id={id} type="checkbox" required={field.required} className="h-4 w-4 accent-[rgb(var(--accent))]" />
          {label}
        </label>
      );
  }
}
