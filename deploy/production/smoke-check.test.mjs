import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { checkDeployment } from "./smoke-check.mjs";

test("deployment smoke check requires front, liveness and readiness", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end("<main>Echomere</main>");
      return;
    }
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/health") {
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (request.url === "/api/ready") {
      response.end(
        JSON.stringify({
          status: "ready",
          components: { database: "ok", agent: "ok", rateLimit: "ok" },
        }),
      );
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const result = await checkDeployment({
      baseUrl: `http://127.0.0.1:${address.port}`,
      frontUrl: `http://127.0.0.1:${address.port}`,
      attempts: 1,
      intervalMs: 1,
    });
    assert.equal(result.ok, true);
    assert.equal(result.frontStatus, 200);
    assert.equal(result.readiness.status, "ready");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("deployment smoke check fails closed on a not-ready dependency", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end("<main>Echomere</main>");
      return;
    }
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/health") {
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    response.writeHead(503).end(JSON.stringify({ status: "not_ready" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await assert.rejects(
      checkDeployment({
        baseUrl: `http://127.0.0.1:${address.port}`,
        frontUrl: `http://127.0.0.1:${address.port}`,
        attempts: 1,
        intervalMs: 1,
      }),
      /did not become ready/u,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
