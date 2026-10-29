import { privilegedChangeReviewedLabel } from "./privileged-change-labels.mjs";

/**
 * @param {string} eventAction
 * @param {boolean} flagged
 * @param {string[]} prLabels
 * @returns {boolean}
 */
export function shouldClearStalePrivilegedReview(eventAction, flagged, prLabels) {
  return (
    eventAction === "synchronize" &&
    flagged &&
    prLabels.includes(privilegedChangeReviewedLabel)
  );
}
