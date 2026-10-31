import { describe, expect, test } from "bun:test";
import type { FormField, PublicPageWidget } from "@shared/user-pages";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { type PageViewer, PageViewerProvider } from "../viewer/page-viewer";
import { type PageForms, PageFormsProvider } from "./form-environment";
import type { FormSubmitRequest, FormSubmitResult } from "./form-submit";
import { FormWidget, formAvailability } from "./form-widget";
import { PageWidgetView } from "./page-widget";
import type { TurnstileApi } from "./turnstile";

const FIELDS: FormField[] = [
  { id: "song", type: "text", label: "Song", required: true, maxLength: 10 },
  { id: "why", type: "textarea", label: "Why", required: false, maxLength: 500 },
  { id: "mood", type: "select", label: "Mood", required: false, options: [{ value: "hype", label: "Hype" }] },
  { id: "ok", type: "checkbox", label: "I follow", required: false },
];

function formWidget(accepting = true): Extract<PublicPageWidget, { type: "form" }> {
  return {
    id: "f",
    type: "form",
    accepting,
    form: { title: "Song requests", submitLabel: "Request", fields: FIELDS },
  };
}

const SIGNED_OUT: PageViewer = {
  session: { status: "signed_out" },
  canSignIn: true,
  canonicalUrl: "https://woofx3.tv/u/wolfy",
  roleCheck: "idle",
  signIn: () => {},
};
const SIGNED_IN: PageViewer = {
  ...SIGNED_OUT,
  session: { status: "signed_in", sessionToken: "session", profile: undefined },
};

/** Forms with a fake submit and a Turnstile that hands out numbered tokens as soon as it renders. */
function fakeForms(answers: FormSubmitResult[] = [{ ok: true }], siteKey: string | null = "site-key") {
  const requests: FormSubmitRequest[] = [];
  const rendered: { widgets: number; removed: number } = { widgets: 0, removed: 0 };
  const turnstile: TurnstileApi = {
    render: (_container, options) => {
      rendered.widgets += 1;
      options.callback(`token-${rendered.widgets}`);
      return String(rendered.widgets);
    },
    remove: () => {
      rendered.removed += 1;
    },
  };
  let keys = 0;
  let reloads = 0;
  const forms: PageForms = {
    slug: "wolfy",
    submit: async (request) => {
      requests.push(request);
      return answers.shift() ?? { ok: true };
    },
    turnstileSiteKey: siteKey,
    loadTurnstile: async () => turnstile,
    newIdempotencyKey: () => {
      keys += 1;
      return `key-${keys}`;
    },
    reload: () => {
      reloads += 1;
    },
  };
  return { forms, requests, rendered, reloads: () => reloads };
}

function wrap(element: ReactElement, forms: PageForms, viewer: PageViewer) {
  return (
    <PageViewerProvider viewer={viewer}>
      <PageFormsProvider forms={forms}>{element}</PageFormsProvider>
    </PageViewerProvider>
  );
}

function html(widget: PublicPageWidget, viewer: PageViewer, forms = fakeForms().forms): string {
  return renderToStaticMarkup(wrap(<PageWidgetView widget={widget} />, forms, viewer));
}

async function mount(forms: PageForms, viewer: PageViewer, widget = formWidget()): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(wrap(<FormWidget widget={widget} />, forms, viewer), { createNodeMock: () => ({}) });
  });
  if (!renderer) {
    throw new Error("nothing rendered");
  }
  return renderer;
}

function input(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const field = FIELDS.find((candidate) => candidate.label === label);
  return renderer.root.find(
    (node) => typeof node.type === "string" && String(node.props.id ?? "").endsWith(`-${field?.id}`)
  );
}

async function typeInto(renderer: ReactTestRenderer, label: string, value: string): Promise<void> {
  await act(async () => {
    input(renderer, label).props.onChange({ target: { value } });
  });
}

async function send(renderer: ReactTestRenderer): Promise<void> {
  await act(async () => {
    await renderer.root.findByType("form").props.onSubmit({ preventDefault: () => {} });
  });
}

function text(renderer: ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

describe("what a form shows", () => {
  test("no form to show: says so, with no questions and no check", () => {
    const out = html({ ...formWidget(), form: null }, SIGNED_OUT);
    expect(out).toContain("isn&#x27;t available");
    expect(out).not.toContain("<form");
  });

  test("open: its questions are enabled and there is no closed notice", () => {
    const out = html(formWidget(), SIGNED_IN);
    expect(out).toContain("Song requests");
    expect(out).not.toContain("<fieldset disabled");
    expect(out).not.toContain("accepting answers");
    for (const label of ["Song", "Why", "Hype", "I follow", "Request"]) {
      expect(out).toContain(label);
    }
  });

  test("not accepting: disabled, with the notice", () => {
    const out = html(formWidget(false), SIGNED_IN);
    expect(out).toContain("<fieldset disabled");
    expect(out).toContain("This form isn&#x27;t accepting answers right now.");
  });

  test("anonymous on a build with no site key: closed", () => {
    const out = html(formWidget(), SIGNED_OUT, fakeForms([], null).forms);
    expect(out).toContain("This form isn&#x27;t accepting answers right now.");
  });

  test("signed in on a build with no site key: open", () => {
    const out = html(formWidget(), SIGNED_IN, fakeForms([], null).forms);
    expect(out).not.toContain("<fieldset disabled");
  });

  test("off the user-pages origin: disabled, linking to the page there", () => {
    const out = html(formWidget(), { ...SIGNED_IN, canSignIn: false });
    expect(out).toContain("<fieldset disabled");
    expect(out).toContain('href="https://woofx3.tv/u/wolfy"');
  });

  test("answers and labels are text, never markup", () => {
    const widget: ReturnType<typeof formWidget> = {
      ...formWidget(),
      form: { submitLabel: "Send", fields: [{ id: "a", type: "checkbox", label: "<img src=x>", required: false }] },
    };
    expect(html(widget, SIGNED_IN)).toContain("&lt;img src=x&gt;");
  });
});

describe("sending a form", () => {
  test("a signed-in viewer sends every answer with their session and no check", async () => {
    const { forms, requests, rendered } = fakeForms();
    const renderer = await mount(forms, SIGNED_IN);
    await typeInto(renderer, "Song", "Never");
    await send(renderer);
    expect(requests).toEqual([
      {
        slug: "wolfy",
        widgetId: "f",
        idempotencyKey: "key-1",
        answers: { song: "Never", why: "", mood: "", ok: false },
        sessionToken: "session",
      },
    ]);
    expect(rendered.widgets).toBe(0);
    expect(text(renderer)).toContain("Thanks, your answer was sent.");
  });

  test("an anonymous visitor's send carries the check's token, and no session", async () => {
    const { forms, requests, rendered } = fakeForms();
    const renderer = await mount(forms, SIGNED_OUT);
    expect(rendered.widgets).toBe(1);
    await typeInto(renderer, "Song", "Never");
    await send(renderer);
    expect(requests[0].turnstileToken).toBe("token-1");
    expect(requests[0].sessionToken).toBeUndefined();
  });

  test("a closed form never loads the check", async () => {
    const { forms, rendered } = fakeForms();
    await mount(forms, SIGNED_OUT, formWidget(false));
    expect(rendered.widgets).toBe(0);
  });

  test("the shared checks stop a bad answer before sending", async () => {
    const { forms, requests } = fakeForms();
    const renderer = await mount(forms, SIGNED_IN);
    await send(renderer);
    expect(requests).toHaveLength(0);
    expect(text(renderer)).toContain("This one is required");
  });

  test("a refusal keeps the answers, says why and gets a fresh check", async () => {
    const { forms, requests, rendered } = fakeForms([{ ok: false, failure: "verification_failed" }, { ok: true }]);
    const renderer = await mount(forms, SIGNED_OUT);
    await typeInto(renderer, "Song", "Never");
    await send(renderer);
    expect(text(renderer)).toContain("confirm you're a person");
    expect(input(renderer, "Song").props.value).toBe("Never");
    expect(rendered.widgets).toBe(2);
    await send(renderer);
    expect(requests[1].turnstileToken).toBe("token-2");
  });

  test("resending the same answers reuses the key; changing one makes a new one", async () => {
    const { forms, requests } = fakeForms([
      { ok: false, failure: "network" },
      { ok: false, failure: "network" },
      { ok: true },
    ]);
    const renderer = await mount(forms, SIGNED_IN);
    await typeInto(renderer, "Song", "Never");
    await send(renderer);
    await send(renderer);
    await typeInto(renderer, "Song", "Gonna");
    await send(renderer);
    expect(requests.map((request) => request.idempotencyKey)).toEqual(["key-1", "key-1", "key-2"]);
  });

  test("a stale form offers a reload", async () => {
    const fake = fakeForms([{ ok: false, failure: "form_stale" }]);
    const renderer = await mount(fake.forms, SIGNED_IN);
    await typeInto(renderer, "Song", "Never");
    await send(renderer);
    expect(text(renderer)).toContain("Reload the page");
    await act(async () => {
      renderer.root.findByProps({ type: "button" }).props.onClick();
    });
    expect(fake.reloads()).toBe(1);
  });

  test("disabled while sending", async () => {
    let finish: (result: FormSubmitResult) => void = () => {};
    const { forms } = fakeForms();
    forms.submit = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const renderer = await mount(forms, SIGNED_IN);
    await typeInto(renderer, "Song", "Never");
    await act(async () => {
      void renderer.root.findByType("form").props.onSubmit({ preventDefault: () => {} });
    });
    expect(renderer.root.findByType("fieldset").props.disabled).toBe(true);
    await act(async () => {
      finish({ ok: true });
    });
  });
});

describe("formAvailability", () => {
  test("not accepting wins over everything", () => {
    expect(formAvailability(false, { ...SIGNED_IN, canSignIn: false }, "k")).toBe("closed");
  });
});
