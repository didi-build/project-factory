import { FACTORY_WORKER_TAG } from "../../src/factory/provision-constants.js";
import {
  EXPECTED_DEMO_APP_PREVIEW_SCRIPT_TAG,
  EXPECTED_DEMO_APP_PRODUCTION_SCRIPT_TAG,
} from "./expected-provision-payloads.js";

export type WorkerScriptRegistry = Map<string, string | undefined>;

export type CfPermissionGroupFixture = {
  id: string;
  name: string;
  scopes: string[];
};

export type CloudflareMockOptions = {
  tokensListFails?: boolean;
  revokeFails?: boolean;
  accountsStatus?: number;
  accountsCode?: number;
  permissionGroups?: CfPermissionGroupFixture[];
  existingDeployToken?: { id: string; name: string };
};

export type WorkerRegistry = {
  scriptTags: WorkerScriptRegistry;
  settingsTags: Map<string, string[]>;
  cf: CloudflareMockOptions;
};

export function defaultWorkerRegistry(): WorkerRegistry {
  return {
    scriptTags: new Map([
      ["demo-app", EXPECTED_DEMO_APP_PRODUCTION_SCRIPT_TAG],
      ["demo-app-preview", EXPECTED_DEMO_APP_PREVIEW_SCRIPT_TAG],
    ]),
    settingsTags: new Map([
      ["demo-app", [FACTORY_WORKER_TAG]],
      ["demo-app-preview", [FACTORY_WORKER_TAG]],
    ]),
    cf: {},
  };
}
