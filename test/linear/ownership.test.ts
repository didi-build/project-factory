import { describe, expect, it } from "vitest";
import {
  detectForeignProjectConflict,
  detectRepoLabelConflict,
} from "../../src/linear/ownership.js";

const REPO_GROUP_ID = "group-repo";

describe("linear ownership detection", () => {
  it("detectRepoLabelConflict flags labels outside the repo group", () => {
    const conflict = detectRepoLabelConflict(
      [
        {
          id: "wrong",
          name: "didi-build/demo-app",
          isGroup: false,
          parent: { id: "other-group", name: "other" },
        },
      ],
      "didi-build/demo-app",
      REPO_GROUP_ID,
    );
    expect(conflict).toMatchObject({
      code: "conflict_not_factory_owned",
      step: "repo_project_label",
    });
  });

  it("detectRepoLabelConflict allows labels under the repo group", () => {
    expect(
      detectRepoLabelConflict(
        [
          {
            id: "ok",
            name: "didi-build/demo-app",
            isGroup: false,
            parent: { id: REPO_GROUP_ID, name: "repo" },
          },
        ],
        "didi-build/demo-app",
        REPO_GROUP_ID,
      ),
    ).toBeNull();
  });

  it("detectForeignProjectConflict flags projects without factory marker", () => {
    const conflict = detectForeignProjectConflict(
      {
        id: "p1",
        name: "Demo",
        url: "https://linear.app/demo",
        description: "no marker",
      },
      "demo-app",
      "read_project_by_name",
    );
    expect(conflict).toMatchObject({
      code: "conflict_not_factory_owned",
      step: "read_project_by_name",
    });
  });
});
