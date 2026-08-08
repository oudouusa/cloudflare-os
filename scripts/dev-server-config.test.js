import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getGatekeeperBaseUrl,
  getWranglerPortFromBackendHost,
} from "./dev-server-config.js";

describe("getWranglerPortFromBackendHost", () => {
  it("extracts a port from a localhost backend host", () => {
    assert.equal(getWranglerPortFromBackendHost("localhost:9000"), "9000");
  });

  it("extracts a port from an IPv6 backend host", () => {
    assert.equal(getWranglerPortFromBackendHost("[::1]:9001"), "9001");
  });

  it("returns null when the backend host has no port", () => {
    assert.equal(getWranglerPortFromBackendHost("localhost"), null);
  });

  it("rejects invalid ports", () => {
    assert.throws(
        () => getWranglerPortFromBackendHost("localhost:99999"),
        /VITE_BACKEND_HOST must include a valid port/);
  });

  it("rejects invalid IPv6 ports", () => {
    assert.throws(
        () => getWranglerPortFromBackendHost("[::1]:99999"),
        /VITE_BACKEND_HOST must include a valid port/);
  });

  it("rejects port zero", () => {
    assert.throws(
        () => getWranglerPortFromBackendHost("localhost:0"),
        /VITE_BACKEND_HOST must include a valid port/);
  });

  it("rejects invalid hosts", () => {
    assert.throws(
        () => getWranglerPortFromBackendHost("http://localhost:9000"),
        /VITE_BACKEND_HOST must include a valid host/);
  });
});

describe("getGatekeeperBaseUrl", () => {
  it("maps a gatekeeper package name onto the public workshop origin", () => {
    assert.equal(
        getGatekeeperBaseUrl("https://cloudflare-os.example.ts.net", "gatekeeper-mcp"),
        "https://cloudflare-os.example.ts.net/gatekeeper/mcp");
  });

  it("preserves an explicit public base path", () => {
    assert.equal(
        getGatekeeperBaseUrl("https://example.test/cloudflare-os/", "gatekeeper-github"),
        "https://example.test/cloudflare-os/gatekeeper/github");
  });

  it("allows a loopback development origin", () => {
    assert.equal(
        getGatekeeperBaseUrl("http://127.0.0.1:8877", "gatekeeper-mcp-portal"),
        "http://127.0.0.1:8877/gatekeeper/mcp-portal");
  });

  it("rejects non-HTTP public base URLs", () => {
    assert.throws(
        () => getGatekeeperBaseUrl("file:///tmp/cloudflare-os", "gatekeeper-mcp"),
        /PUBLIC_BASE_URL must be an absolute HTTP or HTTPS URL/);
  });

  it("rejects malformed gatekeeper names", () => {
    assert.throws(
        () => getGatekeeperBaseUrl("https://example.test", "mcp"),
        /gatekeeperName must start with gatekeeper-/);
  });
});
