import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadLocalEnv(filePath = ".env.local"): void {
  const absolutePath = resolve(filePath);
  if (!existsSync(absolutePath)) return;

  const lines = readFileSync(absolutePath, "utf8").split(/\r?\n/u);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separator = normalized.indexOf("=");
    if (separator <= 0) continue;

    const name = normalized.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) || process.env[name] !== undefined) {
      continue;
    }

    const rawValue = normalized.slice(separator + 1).trim();
    const quote = rawValue[0];
    const value =
      (quote === '"' || quote === "'") && rawValue.at(-1) === quote
        ? rawValue.slice(1, -1)
        : rawValue;
    process.env[name] = value;
  }
}
