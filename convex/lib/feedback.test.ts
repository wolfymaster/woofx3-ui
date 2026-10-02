import { describe, expect, test } from "bun:test";
import {
  authorCanChangeFeedbackPost,
  FEEDBACK_BODY_MAX,
  FEEDBACK_COMMENT_MAX,
  FEEDBACK_TITLE_MAX,
  feedbackRateLimitMessage,
  normalizeFeedbackBody,
  normalizeFeedbackComment,
  normalizeFeedbackTitle,
} from "./feedback";

describe("normalizeFeedbackTitle", () => {
  test("trims and collapses whitespace", () => {
    expect(normalizeFeedbackTitle("  Dark \n  mode   please ")).toBe("Dark mode please");
  });

  test("refuses a title too short to describe anything", () => {
    expect(() => normalizeFeedbackTitle("   ab   ")).toThrow();
  });

  test("refuses a title over the limit", () => {
    expect(() => normalizeFeedbackTitle("x".repeat(FEEDBACK_TITLE_MAX + 1))).toThrow();
    expect(normalizeFeedbackTitle("x".repeat(FEEDBACK_TITLE_MAX))).toHaveLength(FEEDBACK_TITLE_MAX);
  });
});

describe("normalizeFeedbackBody", () => {
  test("keeps line breaks inside the description", () => {
    expect(normalizeFeedbackBody("\n first line\n\nsecond line \n")).toBe("first line\n\nsecond line");
  });

  test("allows an empty description", () => {
    expect(normalizeFeedbackBody("   ")).toBe("");
  });

  test("refuses a description over the limit", () => {
    expect(() => normalizeFeedbackBody("x".repeat(FEEDBACK_BODY_MAX + 1))).toThrow();
  });
});

describe("normalizeFeedbackComment", () => {
  test("refuses an empty comment", () => {
    expect(() => normalizeFeedbackComment(" \n ")).toThrow();
  });

  test("refuses a comment over the limit", () => {
    expect(() => normalizeFeedbackComment("x".repeat(FEEDBACK_COMMENT_MAX + 1))).toThrow();
  });
});

describe("feedbackRateLimitMessage", () => {
  test("rounds the wait up to whole minutes", () => {
    expect(feedbackRateLimitMessage("post", 61_000)).toBe(
      "You've added a lot of posts recently. Try again in 2 minutes."
    );
  });

  test("never says less than a minute", () => {
    expect(feedbackRateLimitMessage("comment", 5_000)).toBe(
      "You've added a lot of comments recently. Try again in a minute."
    );
  });
});

describe("authorCanChangeFeedbackPost", () => {
  test("only an open post can be changed by its author", () => {
    expect(authorCanChangeFeedbackPost("open")).toBe(true);
    for (const status of ["planned", "in_progress", "done", "declined"] as const) {
      expect(authorCanChangeFeedbackPost(status)).toBe(false);
    }
  });
});
