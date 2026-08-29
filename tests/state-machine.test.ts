import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AgentStateMachine } from "../src/agent/state-machine.ts";

describe("AgentStateMachine", () => {
  it("supports the successful foundation flow", () => {
    const machine = new AgentStateMachine();

    assert.equal(machine.transition("validated"), "validated");
    assert.equal(machine.transition("context_loaded"), "context_loaded");
    assert.equal(machine.transition("generating"), "generating");
    assert.equal(machine.transition("validating"), "validating");
    assert.equal(machine.transition("persisting"), "persisting");
    assert.equal(machine.transition("completed"), "completed");
    assert.equal(machine.isTerminal, true);
  });

  it("rejects an invalid transition", () => {
    const machine = new AgentStateMachine();
    assert.throws(
      () => machine.transition("completed"),
      /Invalid agent state transition: received -> completed/,
    );
  });

  it("supports one validation repair cycle", () => {
    const machine = new AgentStateMachine();
    for (const state of [
      "validated",
      "context_loaded",
      "generating",
      "validating",
      "retrying",
      "generating",
      "validating",
      "persisting",
      "completed",
    ] as const) {
      machine.transition(state);
    }
    assert.equal(machine.state, "completed");
  });
});
