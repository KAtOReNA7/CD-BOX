import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { OfficialMusicHostResolver } from "@/lib/official-music/types";

const MAX_URL_LENGTH = 2_048;
const blockedHostSuffixes = [
  ".localhost",
  ".local",
  ".internal",
  ".home",
  ".lan",
  ".test",
  ".invalid",
  ".example",
  ".onion",
];

export type OfficialUrlFailure =
  | "invalid-official-url"
  | "blocked-official-host";

export type OfficialUrlValidation =
  | { ok: true; url: URL }
  | { ok: false; code: OfficialUrlFailure };

function validDomainName(hostname: string) {
  if (
    hostname.length > 253 ||
    !hostname.includes(".") ||
    hostname.startsWith(".") ||
    hostname.endsWith(".")
  ) return false;
  return hostname.split(".").every((label) =>
    label.length > 0 &&
    label.length <= 63 &&
    /^[a-z0-9-]+$/i.test(label) &&
    !label.startsWith("-") &&
    !label.endsWith("-"));
}

export function validateOfficialMusicUrl(value: string | URL): OfficialUrlValidation {
  const raw = value.toString().trim();
  if (!raw || raw.length > MAX_URL_LENGTH) {
    return { ok: false, code: "invalid-official-url" };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: "invalid-official-url" };
  }

  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    isIP(hostname) !== 0 ||
    !validDomainName(hostname)
  ) return { ok: false, code: "blocked-official-host" };

  if (
    hostname === "localhost" ||
    blockedHostSuffixes.some((suffix) =>
      hostname === suffix.slice(1) || hostname.endsWith(suffix))
  ) return { ok: false, code: "blocked-official-host" };

  url.hash = "";
  return { ok: true, url };
}

function publicIpv4(address: string) {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) return false;
  const [a, b, c] = octets;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function mappedIpv4(address: string) {
  const normalized = address.toLowerCase();
  const dotted = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (dotted) return dotted;
  const hex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function publicIpv6(address: string) {
  const mapped = mappedIpv4(address);
  if (mapped) return publicIpv4(mapped);

  // A deliberately conservative allow rule: globally routable unicast IPv6 is
  // currently allocated from 2000::/3. Link-local, ULA, multicast,
  // documentation, mapped, and other special-use ranges therefore fail closed.
  const first = address.toLowerCase().split(":", 1)[0];
  const value = Number.parseInt(first, 16);
  if (!Number.isInteger(value) || value < 0x2000 || value > 0x3fff) return false;
  return !address.toLowerCase().startsWith("2001:db8:");
}

export function isPublicInternetAddress(address: string) {
  const version = isIP(address);
  if (version === 4) return publicIpv4(address);
  if (version === 6) return publicIpv6(address);
  return false;
}

export const defaultOfficialMusicHostResolver: OfficialMusicHostResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return [...new Set(records.map((record) => record.address))];
};

export async function resolvePublicOfficialHost(
  hostname: string,
  resolver: OfficialMusicHostResolver,
) {
  try {
    const addresses = await resolver(hostname);
    if (addresses.length === 0) return { ok: false as const, reason: "dns-resolution-failed" as const };
    if (!addresses.every(isPublicInternetAddress)) {
      return { ok: false as const, reason: "non-public-address" as const };
    }
    return { ok: true as const };
  } catch {
    return { ok: false as const, reason: "dns-resolution-failed" as const };
  }
}

export function canonicalOfficialPageUrl(value: URL) {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}
