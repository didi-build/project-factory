import { REQUIRED_STATUS_CHECK } from "./constants.js";

export function targetBranchProtectionPayload() {
  return {
    required_status_checks: {
      strict: false,
      checks: [{ context: REQUIRED_STATUS_CHECK }],
    },
    enforce_admins: false,
    required_pull_request_reviews: {
      required_approving_review_count: 0,
    },
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false,
  };
}

export function protectionLooksCorrect(
  protection: Record<string, unknown> | null,
): boolean {
  if (!protection) {
    return false;
  }
  const checks =
    (
      protection.required_status_checks as
        { checks?: { context: string }[] } | undefined
    )?.checks ?? [];
  const contexts = checks.map((c) => c.context).sort();
  const reviews = protection.required_pull_request_reviews as
    { required_approving_review_count?: number } | undefined;
  return (
    contexts.includes(REQUIRED_STATUS_CHECK) &&
    reviews?.required_approving_review_count === 0 &&
    protection.allow_force_pushes === false &&
    protection.allow_deletions === false
  );
}
