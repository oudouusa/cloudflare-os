const endpointValue = process.env.CFOS_ASB_MCP_URL;

function fail(message) {
  console.error(`FAIL ${message}; endpoint and response details withheld`);
  process.exitCode = 1;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("metadata request failed");
  return response.json();
}

try {
  if (!endpointValue) throw new Error("CFOS_ASB_MCP_URL is required");
  const endpoint = new URL(endpointValue);
  if (endpoint.protocol !== "https:" || endpoint.pathname !== "/mcp" ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("expected a credential-free HTTPS /mcp endpoint");
  }

  const challenge = await fetch(endpoint, {
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  const authenticate = challenge.headers.get("www-authenticate") ?? "";
  const resourceMetadataMatch =
      authenticate.match(/resource_metadata="([^"]+)"/i);
  if (challenge.status !== 401 || !resourceMetadataMatch) {
    throw new Error("missing protected-resource challenge");
  }

  const resourceMetadataUrl = new URL(resourceMetadataMatch[1]);
  if (resourceMetadataUrl.origin !== endpoint.origin) {
    throw new Error("off-origin protected-resource metadata");
  }
  const resourceMetadata = await fetchJson(resourceMetadataUrl);
  if (!resourceMetadata.resource ||
      new URL(resourceMetadata.resource).href !== endpoint.href) {
    throw new Error("protected resource does not match the MCP endpoint");
  }
  const authorizationServers = resourceMetadata.authorization_servers ?? [];
  if (authorizationServers.length !== 1) {
    throw new Error("expected one authorization server");
  }

  const issuer = new URL(authorizationServers[0]);
  if (issuer.origin !== endpoint.origin) {
    throw new Error("off-origin authorization server");
  }

  let authorizationMetadata;
  for (const path of [
    "/.well-known/oauth-authorization-server",
    "/.well-known/openid-configuration",
  ]) {
    try {
      authorizationMetadata = await fetchJson(new URL(path, issuer));
      break;
    } catch {
      // Try the standard fallback without exposing metadata or endpoint details.
    }
  }
  if (!authorizationMetadata) throw new Error("authorization metadata unavailable");

  for (const field of [
    "authorization_endpoint",
    "token_endpoint",
    "registration_endpoint",
  ]) {
    const value = authorizationMetadata[field];
    if (!value || new URL(value).origin !== endpoint.origin) {
      throw new Error(`invalid ${field}`);
    }
  }
  if (!(authorizationMetadata.code_challenge_methods_supported ?? []).includes("S256")) {
    throw new Error("PKCE S256 unavailable");
  }

  console.log(
      "PASS ASB MCP 401 challenge, same-origin OAuth discovery, dynamic registration, and PKCE S256",
  );
} catch (error) {
  fail(error instanceof Error ? error.message : "ASB OAuth preflight failed");
}
