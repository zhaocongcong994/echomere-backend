import type { ModeResolution } from "./types.ts";

const wenshiPattern = /起卦|问事|能不能|是否|该不该|要不要|会不会|结果如何|能否|可不可以/u;
const kanyunPattern = /命盘|八字|流年|流月|流日|大运|运势|事业运|财运|桃花|今年|本月运/u;
const qingtingPattern = /难过|焦虑|压力|烦恼|不开心|孤独|倾诉|失眠|委屈|迷茫|情绪/u;

export function resolveSuiyuanMode(message: string): ModeResolution {
  if (wenshiPattern.test(message)) {
    return {
      resolvedMode: "wenshi",
      reason: "随缘模式检测到明确的是非、选择或结果型问题。",
    };
  }

  if (kanyunPattern.test(message)) {
    return {
      resolvedMode: "kanyun",
      reason: "随缘模式检测到命盘或时间运势相关意图。",
    };
  }

  if (qingtingPattern.test(message)) {
    return {
      resolvedMode: "qingting",
      reason: "随缘模式检测到情绪表达或倾诉意图。",
    };
  }

  return {
    resolvedMode: "qingting",
    reason: "未检测到明确占测意图，默认以非玄学的倾听方式回应。",
  };
}
