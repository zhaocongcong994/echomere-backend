import type { AgentState } from "./types.ts";

const terminalStates = new Set<AgentState>(["completed", "failed", "interrupted"]);

const transitions: Record<AgentState, ReadonlySet<AgentState>> = {
  received: new Set(["validated", "failed"]),
  validated: new Set(["context_loaded", "waiting_input", "failed"]),
  context_loaded: new Set(["tools_running", "generating", "waiting_input", "failed"]),
  tools_running: new Set(["generating", "waiting_input", "failed", "interrupted"]),
  generating: new Set(["validating", "retrying", "failed", "interrupted"]),
  retrying: new Set(["generating", "failed", "interrupted"]),
  validating: new Set(["retrying", "persisting", "failed"]),
  persisting: new Set(["completed", "failed"]),
  waiting_input: new Set(["context_loaded", "failed", "interrupted"]),
  completed: new Set(),
  failed: new Set(),
  interrupted: new Set(),
};

export class AgentStateMachine {
  private currentState: AgentState = "received";

  get state(): AgentState {
    return this.currentState;
  }

  get isTerminal(): boolean {
    return terminalStates.has(this.currentState);
  }

  transition(next: AgentState): AgentState {
    if (!transitions[this.currentState].has(next)) {
      throw new Error(`Invalid agent state transition: ${this.currentState} -> ${next}`);
    }

    this.currentState = next;
    return this.currentState;
  }
}
