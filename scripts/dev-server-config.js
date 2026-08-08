export function getWranglerPortFromBackendHost(backendHost) {
  const trimmed = backendHost.trim();
  if (!trimmed) return null;
  if (trimmed.includes("://")) {
    throw new Error("VITE_BACKEND_HOST must include a valid host with an optional port.");
  }

  let url;
  try {
    url = new URL(`http://${trimmed}`);
  } catch {
    if (/(^.*\]:|^[^:]+:)[^:]+$/.test(trimmed)) {
      throw new Error("VITE_BACKEND_HOST must include a valid port between 1 and 65535.");
    }
    throw new Error("VITE_BACKEND_HOST must include a valid host with an optional port.");
  }

  if (!url.port) return null;

  const port = Number(url.port);
  if (port < 1) {
    throw new Error("VITE_BACKEND_HOST must include a valid port between 1 and 65535.");
  }

  return url.port;
}

/**
 * Build the public URL for a locally routed gatekeeper.
 *
 * Gatekeepers run as services behind the dev router, so their OAuth callbacks
 * must use the externally reachable workshop origin rather than Wrangler's
 * localhost default.
 */
export function getGatekeeperBaseUrl(publicBaseUrl, gatekeeperName) {
  if (!gatekeeperName.startsWith("gatekeeper-") || gatekeeperName === "gatekeeper-") {
    throw new Error("gatekeeperName must start with gatekeeper- and include a name.");
  }

  let url;
  try {
    url = new URL(publicBaseUrl);
  } catch {
    throw new Error("PUBLIC_BASE_URL must be an absolute HTTP or HTTPS URL.");
  }

  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash) {
    throw new Error(
        "PUBLIC_BASE_URL must be an absolute HTTP or HTTPS URL without credentials, query, or fragment.");
  }

  const rootPath = url.pathname.replace(/\/+$/, "");
  const shortName = gatekeeperName.slice("gatekeeper-".length);
  url.pathname = `${rootPath}/gatekeeper/${shortName}`;
  return url.toString().replace(/\/$/, "");
}
