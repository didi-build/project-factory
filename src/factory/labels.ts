export const dependabotAutomergeLabelName = "launchpad-dependabot-automerge";

export type FactoryLabel = {
  name: string;
  color: string;
  description: string;
};

export const STANDARD_FACTORY_LABELS: FactoryLabel[] = [
  {
    name: "privileged-change-reviewed",
    color: "0E8A16",
    description: "Maintainer reviewed privileged-change warning",
  },
  {
    name: "delegatable",
    color: "5319E7",
    description: "Work that agents may take without privileged maintainer review",
  },
  {
    name: dependabotAutomergeLabelName,
    color: "1D76DB",
    description: "Dependabot minor/patch PR eligible for auto-merge when CI is green",
  },
];

export function standardLabelNames(): string[] {
  return STANDARD_FACTORY_LABELS.map((l) => l.name);
}
