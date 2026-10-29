import { describe, expect, it } from "vitest";
import {
  findKickoffEpicByMarker,
  resolveLinearTeamId,
} from "../../src/linear/operations.js";
import {
  createMockLinearClient,
  type RecordedLinearCall,
} from "../project-factory/linear-mock.js";

describe("Linear operations queries", () => {
  it("filters teams by exact configured name", async () => {
    const calls: RecordedLinearCall[] = [];
    const linear = createMockLinearClient((call) => {
      expect(call.variables).toEqual({
        filter: { name: { eq: "Didi Build" } },
      });
      return {
        ok: true,
        data: { teams: { nodes: [{ id: "team-1", name: "Didi Build" }] } },
      };
    }, calls);

    const result = await resolveLinearTeamId(linear, "Didi Build");
    expect(result).toMatchObject({ ok: true, teamId: "team-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toContain("query Teams");
  });

  it("filters kickoff epic lookup by project id and marker", async () => {
    const calls: RecordedLinearCall[] = [];
    const marker = "<!-- project-factory:epic:project-abc -->";
    const linear = createMockLinearClient((call) => {
      expect(call.variables).toEqual({
        filter: {
          project: { id: { eq: "project-abc" } },
          description: { contains: marker },
        },
      });
      return { ok: true, data: { issues: { nodes: [] } } };
    }, calls);

    const result = await findKickoffEpicByMarker(linear, "project-abc", marker);
    expect(result).toMatchObject({ ok: true, issues: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toContain("query KickoffByMarker");
  });
});
