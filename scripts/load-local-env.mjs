import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

export function loadLocalEnv() {
  const cwd = process.cwd();
  const candidates = [path.join(cwd, ".env.local"), path.join(cwd, ".env")];
  const envFilePath = candidates.find((candidate) => fs.existsSync(candidate)) ?? null;

  if (envFilePath) {
    dotenv.config({ path: envFilePath, override: false, quiet: true });
  }

  const providerCredential = process.env.OPENAI_API_KEY;
  const missingKeys = ["OPENAI_BASE_URL", "OPENAI_TEXT_MODEL"].filter(
    (key) => !process.env[key],
  );
  if (!providerCredential) {
    missingKeys.unshift("OPENAI_API_KEY");
  }

  return {
    cwd,
    envFileLoaded: Boolean(envFilePath),
    envFilePath,
    missingKeys,
  };
}
