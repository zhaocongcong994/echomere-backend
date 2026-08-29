import type { ModePolicy } from "./types.ts";

export const qingtingPolicy: ModePolicy = {
  mode: "qingting",
  displayName: "倾听",
  requiredTools: [],
  instruction: [
    "先理解和复述用户处境，再提出一个有帮助的澄清问题或小行动。",
    "本模式不得调用命盘、时间流或起卦工具。",
    "不要把普通情绪问题玄学化。",
  ].join("\n"),
};
