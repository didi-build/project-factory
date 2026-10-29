/** @typedef {'skip' | 'create' | 'update'} PrivilegedChangeCommentAction */

/**
 * @param {boolean} flagged
 * @param {boolean} hasExistingMarkerComment
 * @returns {PrivilegedChangeCommentAction}
 */
export function decidePrivilegedChangeCommentAction(flagged, hasExistingMarkerComment) {
  if (!flagged && !hasExistingMarkerComment) {
    return "skip";
  }
  if (!hasExistingMarkerComment) {
    return "create";
  }
  return "update";
}
