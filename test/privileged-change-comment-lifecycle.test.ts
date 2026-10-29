import { describe, expect, it } from "vitest";
import { decidePrivilegedChangeCommentAction } from "../scripts/lib/privileged-change-comment-lifecycle.mjs";

describe("privileged-change-comment-lifecycle (table)", () => {
  const cases: {
    flagged: boolean;
    hasComment: boolean;
    action: "skip" | "create" | "update";
  }[] = [
    { flagged: false, hasComment: false, action: "skip" },
    { flagged: true, hasComment: false, action: "create" },
    { flagged: true, hasComment: true, action: "update" },
    { flagged: false, hasComment: true, action: "update" },
  ];

  for (const { flagged, hasComment, action } of cases) {
    it(`flagged=${flagged} hasComment=${hasComment} -> ${action}`, () => {
      expect(decidePrivilegedChangeCommentAction(flagged, hasComment)).toBe(action);
    });
  }
});
