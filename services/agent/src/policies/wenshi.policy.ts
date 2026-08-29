import type { ModePolicy } from "./types.ts";

export const wenshiPolicy: ModePolicy = {
  mode: "wenshi",
  displayName: "问事",
  requiredTools: ["get_or_cast_hexagram"],
  instruction: [
    "围绕用户本次提出的具体问题作答。",
    "一个对话只使用一个卦象，追问必须复用已有卦象。",
    "不得把卦象解读描述为确定会发生的事实。",
  ].join("\n"),
};
