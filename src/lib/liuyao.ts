// 六爻起卦服务
// 规则：3 枚铜钱投掷 6 次，从初爻到上爻
// 3 正 = 老阴（动爻，阴变阳）; 2 正 1 反 = 少阳; 1 正 2 反 = 少阴; 3 反 = 老阳（动爻，阳变阴）

export type YaoType = "少阴" | "少阳" | "老阴" | "老阳";

export interface Yao {
  index: number; // 1-6, 1 为初爻
  type: YaoType;
  yin: boolean; // 本卦阴阳：true=阴，false=阳
  changing: boolean; // 是否动爻
}

export interface HexagramResult {
  originalName: string;
  originalNumber: number;
  changedName: string;
  changedNumber: number;
  changingYaos: number[];
  yaos: Yao[];
}

const STANDARD_HEXAGRAMS: Array<[string, string, number]> = [
  ["111111", "乾", 1], ["000000", "坤", 2], ["100010", "屯", 3], ["010001", "蒙", 4],
  ["111010", "需", 5], ["010111", "讼", 6], ["010000", "师", 7], ["000010", "比", 8],
  ["111011", "小畜", 9], ["110111", "履", 10], ["111000", "泰", 11], ["000111", "否", 12],
  ["101111", "同人", 13], ["111101", "大有", 14], ["001000", "谦", 15], ["000100", "豫", 16],
  ["011001", "随", 17], ["100110", "蛊", 18], ["011000", "临", 19], ["000110", "观", 20],
  ["101001", "噬嗑", 21], ["100101", "贲", 22], ["100000", "剥", 23], ["000001", "复", 24],
  ["111001", "无妄", 25], ["100111", "大畜", 26], ["100001", "颐", 27], ["011110", "大过", 28],
  ["010010", "坎", 29], ["101101", "离", 30], ["001110", "咸", 31], ["011100", "恒", 32],
  ["001111", "遁", 33], ["111100", "大壮", 34], ["000101", "晋", 35], ["101000", "明夷", 36],
  ["011101", "家人", 37], ["101110", "睽", 38], ["010011", "蹇", 39], ["110010", "解", 40],
  ["100011", "损", 41], ["110100", "益", 42], ["011111", "夬", 43], ["111110", "姤", 44],
  ["011011", "萃", 45], ["110110", "升", 46], ["010110", "困", 47], ["011010", "井", 48],
  ["110101", "革", 49], ["101011", "鼎", 50], ["001010", "震", 51], ["010100", "艮", 52],
  ["110001", "渐", 53], ["100011", "归妹", 54], ["001101", "丰", 55], ["101100", "旅", 56],
  ["110110", "巽", 57], ["011011", "兑", 58], ["010101", "涣", 59], ["101010", "节", 60],
  ["110011", "中孚", 61], ["001100", "小过", 62], ["010111", "既济", 63], ["101000", "未济", 64],
];

function getHexagramName(bits: string): { name: string; number: number } {
  const found = STANDARD_HEXAGRAMS.find(([b]) => b === bits);
  if (found) return { name: found[1], number: found[2] };
  return { name: "未知", number: 0 };
}

function seededRandom(seed: string): () => number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return () => {
    hash = (hash * 9301 + 49297) % 233280;
    return hash / 233280;
  };
}

export function castHexagram(seedText: string, timestamp = Date.now()): HexagramResult {
  const rnd = seededRandom(`${seedText}-${timestamp}`);
  const yaos: Yao[] = [];

  for (let i = 0; i < 6; i++) {
    const r = rnd();
    let type: YaoType;
    if (r < 0.125) type = "老阴";
    else if (r < 0.5) type = "少阳";
    else if (r < 0.875) type = "少阴";
    else type = "老阳";

    const yin = type === "老阴" || type === "少阴";
    const changing = type === "老阴" || type === "老阳";

    yaos.push({
      index: i + 1,
      type,
      yin,
      changing,
    });
  }

  // bits 从下到上：yaos[0] 是初爻，对应字符串最右边
  const originalBits = yaos.map((y) => (y.yin ? "0" : "1")).reverse().join("");
  const changedBits = yaos
    .map((y) => {
      if (y.type === "老阴") return "1";
      if (y.type === "老阳") return "0";
      return y.yin ? "0" : "1";
    })
    .reverse()
    .join("");

  const changingYaos = yaos.filter((y) => y.changing).map((y) => y.index);

  return {
    originalName: getHexagramName(originalBits).name,
    originalNumber: getHexagramName(originalBits).number,
    changedName: getHexagramName(changedBits).name,
    changedNumber: getHexagramName(changedBits).number,
    changingYaos,
    yaos,
  };
}
