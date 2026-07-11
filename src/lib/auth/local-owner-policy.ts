export const LOCAL_OWNER_USER_ID = "cd-box-local-owner";
export const LOCAL_OWNER_NAME = "Local owner";
export const LOCAL_OWNER_HANDLE = "local-owner";

const LOCAL_OWNER_MODE_ENABLED_VALUES = new Set(["1", "true"]);
const LOCAL_OWNER_MODE_DISABLED_VALUES = new Set(["0", "false"]);
const LOOPBACK_BIND_HOSTS = new Set(["127.0.0.1", "::1"]);

type Environment = Readonly<Record<string, string | undefined>>;

export type LocalOwnerMode = "disabled" | "enabled" | "invalid";

export type LocalOwnerConfiguration =
  | { status: "disabled" }
  | { status: "invalid"; reason: string }
  | {
      status: "enabled";
      bindHost: "127.0.0.1" | "::1";
      origin: string;
      requestHost: string;
      protocol: "http";
      port: string;
    };

export type LocalOwnerRequestMetadata = {
  host: string | null;
  forwardedHost: string | null;
  forwardedFor: string | null;
  forwardedPort: string | null;
  forwardedProto: string | null;
  forwarded: string | null;
  realIp: string | null;
  origin: string | null;
};

type HeaderReader = Pick<Headers, "get">;

export function resolveLocalOwnerMode(value: string | undefined): LocalOwnerMode {
  if (value === undefined) {
    return "disabled";
  }

  const normalized = value.trim().toLowerCase();
  if (LOCAL_OWNER_MODE_ENABLED_VALUES.has(normalized)) {
    return "enabled";
  }
  if (LOCAL_OWNER_MODE_DISABLED_VALUES.has(normalized)) {
    return "disabled";
  }

  return "invalid";
}

function normalizeLoopbackHost(value: string | undefined) {
  const normalized = value?.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized && LOOPBACK_BIND_HOSTS.has(normalized)
    ? (normalized as "127.0.0.1" | "::1")
    : null;
}

export function resolveLocalOwnerConfiguration(
  environment: Environment = process.env,
): LocalOwnerConfiguration {
  const mode = resolveLocalOwnerMode(environment.LOCAL_OWNER_MODE);

  if (mode === "disabled") {
    return { status: "disabled" };
  }
  if (mode === "invalid") {
    return {
      status: "invalid",
      reason: "LOCAL_OWNER_MODE must be true, false, 1, or 0.",
    };
  }
  const bindHost = normalizeLoopbackHost(environment.LOCAL_OWNER_BIND_HOST);
  if (!bindHost) {
    return {
      status: "invalid",
      reason: "LOCAL_OWNER_BIND_HOST must be the numeric loopback address 127.0.0.1 or ::1.",
    };
  }

  const configuredUrl = environment.NEXTAUTH_URL?.trim();
  if (!configuredUrl) {
    return {
      status: "invalid",
      reason: "NEXTAUTH_URL is required in local owner mode.",
    };
  }

  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    return { status: "invalid", reason: "NEXTAUTH_URL must be a valid absolute URL." };
  }

  const urlHost = normalizeLoopbackHost(url.hostname);
  if (
    url.protocol !== "http:" ||
    urlHost !== bindHost ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    return {
      status: "invalid",
      reason:
        "NEXTAUTH_URL must be an HTTP origin on the same numeric loopback address as LOCAL_OWNER_BIND_HOST.",
    };
  }

  return {
    status: "enabled",
    bindHost,
    origin: url.origin,
    requestHost: url.host.toLowerCase(),
    protocol: "http",
    port: url.port || "80",
  };
}

function parseRequestHost(value: string | null) {
  const normalized = value?.trim();
  if (!normalized || normalized.includes(",")) {
    return null;
  }

  try {
    const url = new URL(`http://${normalized}`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return null;
    }
    return url.host.toLowerCase();
  } catch {
    return null;
  }
}

function isLoopbackRemoteAddress(value: string | null) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized.includes(",")) {
    return false;
  }

  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "::ffff:127.0.0.1";
}

export function readLocalOwnerRequestMetadata(headers: HeaderReader): LocalOwnerRequestMetadata {
  return {
    host: headers.get("host"),
    forwardedHost: headers.get("x-forwarded-host"),
    forwardedFor: headers.get("x-forwarded-for"),
    forwardedPort: headers.get("x-forwarded-port"),
    forwardedProto: headers.get("x-forwarded-proto"),
    forwarded: headers.get("forwarded"),
    realIp: headers.get("x-real-ip"),
    origin: headers.get("origin"),
  };
}

export function isLocalOwnerRequestAllowed(
  configuration: Extract<LocalOwnerConfiguration, { status: "enabled" }>,
  request: LocalOwnerRequestMetadata,
) {
  if (parseRequestHost(request.host) !== configuration.requestHost) {
    return false;
  }

  const forwardedHeaders = [
    request.forwardedHost,
    request.forwardedFor,
    request.forwardedPort,
    request.forwardedProto,
  ];
  const hasForwardedHeaders = forwardedHeaders.some((value) => value !== null);

  if (
    hasForwardedHeaders &&
    (parseRequestHost(request.forwardedHost) !== configuration.requestHost ||
      request.forwardedProto?.trim().toLowerCase() !== configuration.protocol ||
      request.forwardedPort?.trim() !== configuration.port ||
      !isLoopbackRemoteAddress(request.forwardedFor))
  ) {
    return false;
  }

  if (request.forwarded !== null) {
    return false;
  }
  if (request.realIp !== null && !isLoopbackRemoteAddress(request.realIp)) {
    return false;
  }

  if (request.origin !== null) {
    try {
      if (new URL(request.origin).origin !== configuration.origin) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}
