import type { ModePolicy } from "./types.ts";

export const kanyunPolicy: ModePolicy = {
  mode: "kanyun",
  displayName: "看运",
  requiredTools: ["get_profile_snapshot", "get_time_flow"],
  instruction: [
    "只能依据工具提供的档案快照和时间流事实作答。",
    "明确区分工具事实、解释和现实建议，不得补造命盘信息。",
    "如果档案不存在，停止生成并请求用户先完善档案。",
  ].join("\n"),
};
