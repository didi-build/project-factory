import { describe, expect, it } from "vitest";
import { shouldClearStalePrivilegedReview } from "../scripts/lib/privileged-change-stale-review.mjs";
import { privilegedChangeReviewedLabel } from "../scripts/lib/privileged-change-labels.mjs";

describe("privileged-change-stale-review (table)", () => {
  const cases: {
    event: string;
    flagged: boolean;
    labels: string[];
    clear: boolean;
  }[] = [
    {
      event: "synchronize",
      flagged: true,
      labels: [privilegedChangeReviewedLabel],
      clear: true,
    },
    {
      event: "synchronize",
      flagged: true,
      labels: [],
      clear: false,
    },
    {
      event: "synchronize",
      flagged: false,
      labels: [privilegedChangeReviewedLabel],
      clear: false,
    },
    {
      event: "labeled",
      flagged: true,
      labels: [privilegedChangeReviewedLabel],
      clear: false,
    },
  ];

  for (const { event, flagged, labels, clear } of cases) {
    it(`${event} flagged=${flagged} labels=${labels.join(",")} -> ${clear}`, () => {
      expect(shouldClearStalePrivilegedReview(event, flagged, labels)).toBe(clear);
    });
  }
});
