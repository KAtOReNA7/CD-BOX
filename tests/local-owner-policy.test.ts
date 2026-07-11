import assert from "node:assert/strict";
import {
  isLocalOwnerRequestAllowed,
  readLocalOwnerRequestMetadata,
  resolveLocalOwnerConfiguration,
  resolveLocalOwnerMode,
} from "@/lib/auth/local-owner-policy";

assert.equal(resolveLocalOwnerMode(undefined), "disabled");
assert.equal(resolveLocalOwnerMode("false"), "disabled");
assert.equal(resolveLocalOwnerMode("0"), "disabled");
assert.equal(resolveLocalOwnerMode(" TRUE "), "enabled");
assert.equal(resolveLocalOwnerMode("1"), "enabled");
assert.equal(resolveLocalOwnerMode("yes"), "invalid");
assert.equal(resolveLocalOwnerMode(""), "invalid");

assert.deepEqual(resolveLocalOwnerConfiguration({}), { status: "disabled" });

const enabledConfiguration = resolveLocalOwnerConfiguration({
  LOCAL_OWNER_MODE: "true",
  LOCAL_OWNER_BIND_HOST: "127.0.0.1",
  NEXTAUTH_URL: "http://127.0.0.1:3000",
  NODE_ENV: "production",
});
assert.deepEqual(enabledConfiguration, {
  status: "enabled",
  bindHost: "127.0.0.1",
  origin: "http://127.0.0.1:3000",
  requestHost: "127.0.0.1:3000",
  protocol: "http",
  port: "3000",
});

const ipv6Configuration = resolveLocalOwnerConfiguration({
  LOCAL_OWNER_MODE: "1",
  LOCAL_OWNER_BIND_HOST: "::1",
  NEXTAUTH_URL: "http://[::1]:3000",
});
assert.equal(ipv6Configuration.status, "enabled");
if (ipv6Configuration.status === "enabled") {
  assert.equal(
    isLocalOwnerRequestAllowed(
      ipv6Configuration,
      readLocalOwnerRequestMetadata(
        new Headers({
          host: "[::1]:3000",
          "x-forwarded-host": "[::1]:3000",
          "x-forwarded-for": "::1",
          "x-forwarded-port": "3000",
          "x-forwarded-proto": "http",
        }),
      ),
    ),
    true,
  );
}

assert.equal(
  resolveLocalOwnerConfiguration({
    LOCAL_OWNER_MODE: "true",
    LOCAL_OWNER_BIND_HOST: "localhost",
    NEXTAUTH_URL: "http://localhost:3000",
  }).status,
  "invalid",
);
assert.equal(
  resolveLocalOwnerConfiguration({
    LOCAL_OWNER_MODE: "true",
    LOCAL_OWNER_BIND_HOST: "127.0.0.1",
    NEXTAUTH_URL: "https://127.0.0.1:3000",
  }).status,
  "invalid",
);
assert.equal(
  resolveLocalOwnerConfiguration({
    LOCAL_OWNER_MODE: "true",
    LOCAL_OWNER_BIND_HOST: "127.0.0.1",
    NEXTAUTH_URL: "http://127.0.0.1:3000/auth",
  }).status,
  "invalid",
);
assert.equal(
  resolveLocalOwnerConfiguration({
    LOCAL_OWNER_MODE: "true",
    LOCAL_OWNER_BIND_HOST: "127.0.0.1",
    NEXTAUTH_URL: "http://192.168.1.10:3000",
  }).status,
  "invalid",
);

assert.equal(enabledConfiguration.status, "enabled");
if (enabledConfiguration.status === "enabled") {
  assert.equal(
    isLocalOwnerRequestAllowed(
      enabledConfiguration,
      readLocalOwnerRequestMetadata(new Headers({ host: "127.0.0.1:3000" })),
    ),
    true,
  );
  assert.equal(
    isLocalOwnerRequestAllowed(
      enabledConfiguration,
      readLocalOwnerRequestMetadata(
        new Headers({
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
        }),
      ),
    ),
    true,
  );

  function requestHeaders(overrides: Record<string, string> = {}) {
    return new Headers({
      host: "127.0.0.1:3000",
      "x-forwarded-host": "127.0.0.1:3000",
      "x-forwarded-for": "127.0.0.1",
      "x-forwarded-port": "3000",
      "x-forwarded-proto": "http",
      ...overrides,
    });
  }

  assert.equal(
    isLocalOwnerRequestAllowed(
      enabledConfiguration,
      readLocalOwnerRequestMetadata(requestHeaders()),
    ),
    true,
  );
  assert.equal(
    isLocalOwnerRequestAllowed(
      enabledConfiguration,
      readLocalOwnerRequestMetadata(
        requestHeaders({
          "x-forwarded-for": "::ffff:127.0.0.1",
          origin: "http://127.0.0.1:3000",
        }),
      ),
    ),
    true,
  );

  const deniedHeaderOverrides: Array<Record<string, string>> = [
    { host: "192.168.1.10:3000" },
    { "x-forwarded-host": "example.test" },
    { "x-forwarded-for": "192.168.1.10" },
    { "x-forwarded-for": "127.0.0.1, 192.168.1.10" },
    { "x-forwarded-port": "3001" },
    { "x-forwarded-proto": "https" },
    { forwarded: "for=127.0.0.1" },
    { "x-real-ip": "192.168.1.10" },
    { origin: "https://attacker.example" },
  ];

  for (const overrides of deniedHeaderOverrides) {
    assert.equal(
      isLocalOwnerRequestAllowed(
        enabledConfiguration,
        readLocalOwnerRequestMetadata(requestHeaders(overrides)),
      ),
      false,
    );
  }

  const missingForwardedFor = requestHeaders();
  missingForwardedFor.delete("x-forwarded-for");
  assert.equal(
    isLocalOwnerRequestAllowed(
      enabledConfiguration,
      readLocalOwnerRequestMetadata(missingForwardedFor),
    ),
    false,
  );

  assert.equal(
    isLocalOwnerRequestAllowed(
      enabledConfiguration,
      readLocalOwnerRequestMetadata(
        new Headers({
          host: "127.0.0.1:3000",
          "x-forwarded-host": "127.0.0.1:3000",
        }),
      ),
    ),
    false,
  );
  assert.equal(
    isLocalOwnerRequestAllowed(
      enabledConfiguration,
      readLocalOwnerRequestMetadata(
        new Headers({ host: "127.0.0.1:3000", forwarded: "" }),
      ),
    ),
    false,
  );
}

console.log("Local owner policy test passed.");
