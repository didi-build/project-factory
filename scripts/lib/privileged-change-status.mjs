export const PRIVILEGED_CHANGE_CHECK_CONTEXT = "privileged-change";

export const PRIVILEGED_CHANGE_ERROR_STATUS_DESCRIPTION =
  "privileged-change check errored, review manually";

export function privilegedChangeErrorStatusPayload() {
  return {
    state: "failure",
    context: PRIVILEGED_CHANGE_CHECK_CONTEXT,
    description: PRIVILEGED_CHANGE_ERROR_STATUS_DESCRIPTION,
  };
}
