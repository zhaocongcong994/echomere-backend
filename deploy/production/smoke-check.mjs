import { pathToFileURL } from "node:url";

const DEFAULT_ATTEMPTS = 30;
const DEFAULT_INTERVAL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 5_000;

export async function checkDeployment(options = {}) {
  const baseUrl = normalizeBaseUrl(
    options.baseUrl ?? process.env.ECHOMERE_SMOKE_BASE_URL ?? "http://127.0.0.1:3001",
  );
  const frontUrl = normalizeBaseUrl(
    options.frontUrl ??
      process.env.ECHOMERE_SMOKE_FRONT_URL ??
      "http://127.0.0.1:3101",
  );
  const attempts = positiveInteger(
    options.attempts ?? process.env.ECHOMERE_SMOKE_ATTEMPTS,
    DEFAULT_ATTEMPTS,
    "ECHOMERE_SMOKE_ATTEMPTS",
  );
  const intervalMs = positiveInteger(
    options.intervalMs ?? process.env.ECHOMERE_SMOKE_INTERVAL_MS,
    DEFAULT_INTERVAL_MS,
    "ECHOMERE_SMOKE_INTERVAL_MS",
  );

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const frontStatus = await getStatus(frontUrl);
      const health = await getJson(`${baseUrl}/api/health`);
      const readiness = await getJson(`${baseUrl}/api/ready`);
      if (readiness.status !== 200 || readiness.body?.status !== "ready") {
        throw new Error(`Backend is not ready (HTTP ${readiness.status}).`);
      }
      return {
        ok: true,
        baseUrl,
        frontUrl,
        attempt,
        frontStatus,
        healthStatus: health.status,
        readiness: readiness.body,
      };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(intervalMs);
    }
  }

  throw new Error(
    `Deployment did not become ready after ${attempts} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function getStatus(url) {
  const response = await fetch(url, {
    headers: { Accept: "text/html" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${new URL(url).pathname} returned HTTP ${response.status}.`);
  }
  return response.status;
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    throw new Error(`${new URL(url).pathname} returned HTTP ${response.status}.`);
  }
  return { status: response.status, body };
}

function normalizeBaseUrl(value) {
  const url = new URL(String(value));
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Smoke-check URL must use http or https.");
  }
  return url.toString().replace(/\/$/u, "");
}

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 300) {
    throw new Error(`${name} must be an integer between 1 and 300.`);
  }
  return number;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkDeployment()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(
        `${JSON.stringify(
          {
            ok: false,
            code: "deployment_smoke_failed",
            message:
              error instanceof Error ? error.message : "Deployment smoke check failed.",
          },
          null,
          2,
        )}\n`,
      );
      process.exitCode = 1;
    });
}
