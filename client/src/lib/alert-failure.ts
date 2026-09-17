/**
 * Turn a failure reason into something a streamer can act on.
 *
 * The engine and the scene manager both report why an alert did not play, and
 * they share a vocabulary on purpose: the same four structural messages come
 * from `validateAlertParams` in Go and `parseAlertLayout` in TypeScript. One
 * mapping therefore serves both surfaces — a failed workflow run and a refused
 * alert.
 *
 * Matching is on the message text rather than a transmitted code. A real code
 * would mean a proto field, a database migration, an outbox payload, a webhook
 * type and a Convex column, all to carry one string. That trade is acceptable
 * *here* precisely because this only chooses display copy: an unrecognised
 * message returns null and the caller shows it verbatim, which is the
 * behaviour that existed before this did. Matching a message to choose
 * behaviour would be a different and much worse idea, and this must not grow
 * into one.
 */

export interface AlertFailureCopy {
  /** Shown in place of the raw reason. */
  title: string;
  /** What to do about it. */
  hint: string;
}

/** The engine wraps its own reasons before they reach a workflow run. */
const ENGINE_PREFIX = "alert cannot be published: ";

const MISSING_TARGET = /^no alert widget named "(.+)" on a running scene$/;

export function describeAlertFailure(reason: string): AlertFailureCopy | null {
  const message = reason.startsWith(ENGINE_PREFIX) ? reason.slice(ENGINE_PREFIX.length) : reason;

  // Checked before the general "not an object" case below, which it would
  // otherwise match: an absent layout and a malformed one need different advice.
  if (message.startsWith("layout must be an object, got nothing")) {
    return {
      title: "This alert has no layout",
      hint: "The module that provides it may be out of date. Update the module, then open the workflow and re-save the alert step.",
    };
  }
  if (message.startsWith("layout must be an object")) {
    return {
      title: "This alert's layout is not usable",
      hint: "The step's layout is not an object. Re-saving the alert step in the workflow editor will rebuild it.",
    };
  }
  if (message.startsWith("layout.width") || message.startsWith("layout.height")) {
    return {
      title: "This alert's canvas size is invalid",
      hint: message.includes("got the string")
        ? "Width and height must be numbers, not text. Re-save the alert step to rebuild the layout."
        : "Width and height must both be greater than zero. Re-save the alert step to rebuild the layout.",
    };
  }
  if (message.startsWith("layout.widgets must be an array")) {
    return {
      title: "This alert has no widget list",
      hint: "The layout is missing its widgets. Re-saving the alert step in the workflow editor will rebuild it.",
    };
  }

  const missingTarget = MISSING_TARGET.exec(message);
  if (missingTarget) {
    return {
      title: "No alert widget was listening",
      hint: `Open a scene containing an alert widget named "${missingTarget[1]}", or change the alert step's target to a widget you already have.`,
    };
  }
  if (message.startsWith("no widget in the layout can play in an alert")) {
    return {
      title: "None of this alert's widgets can play in an alert",
      hint: "A widget has to declare the alert surface to appear in one. Replace them with widgets that can, or check the module is installed and up to date.",
    };
  }
  if (message.startsWith("the layout contains no widgets")) {
    return {
      title: "This alert has nothing to show",
      hint: "Add at least one widget to the alert in the workflow editor.",
    };
  }

  return null;
}
