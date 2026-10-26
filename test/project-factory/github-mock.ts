import { GitHubClient } from "../../src/github/client.js";

export type RecordedGithubCall = {
  method: string;
  path: string;
  body?: unknown;
};

type RouteHandler = (
  method: string,
  path: string,
  body?: unknown,
) => { status: number; body?: unknown };

export async function createMockGitHub(
  handler: RouteHandler,
  calls?: RecordedGithubCall[],
): Promise<GitHubClient> {
  const privateKeyPem = await fakePkcs8Pem();
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const path =
      typeof url === "string"
        ? url.replace("https://api.github.com", "")
        : url.toString();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (calls) {
      calls.push({ method, path, body });
    }
    if (path.includes("/app/installations/") && path.endsWith("/access_tokens")) {
      return new Response(JSON.stringify({ token: "installation-token" }), {
        status: 201,
      });
    }
    const parsed = new URL(path, "https://api.github.com");
    const routePath = parsed.pathname + parsed.search;
    const result = handler(method, routePath, body);
    if (result.status === 204) {
      return new Response(null, { status: 204 });
    }
    return new Response(result.body ? JSON.stringify(result.body) : "", {
      status: result.status,
    });
  };
  return new GitHubClient({
    appId: "123",
    installationId: "456",
    privateKeyPem,
    fetchImpl: fetchImpl as typeof fetch,
  });
}

export async function fakePkcs8Pem(): Promise<string> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign"],
  );
  const exported = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(exported)));
  const lines = b64.match(/.{1,64}/g) ?? [];
  const header = (kind: string) => `-----${kind} PRIVATE KEY-----`;
  return `${header("BEGIN")}\n${lines.join("\n")}\n${header("END")}`;
}
