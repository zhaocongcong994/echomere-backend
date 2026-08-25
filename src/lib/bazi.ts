import { Solar } from "lunar-javascript";

const GAN = ["", "甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
const ZHI = ["", "子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
const WUXING_MAP: Record<string, string> = {
  甲: "木", 乙: "木", 丙: "火", 丁: "火", 戊: "土", 己: "土",
  庚: "金", 辛: "金", 壬: "水", 癸: "水",
  子: "水", 丑: "土", 寅: "木", 卯: "木", 辰: "土", 巳: "火",
  午: "火", 未: "土", 申: "金", 酉: "金", 戌: "土", 亥: "水",
};

export interface BaziPillar {
  year: string;
  month: string;
  day: string;
  hour: string;
  dayMaster: { gan: string; zhi: string; wuxing: string };
  genderLabel: string;
  wuxing: Record<string, number>;
  shishen: { gan: string[]; zhi: string[] };
  nayin: string[];
  lunarDate: { year: string; month: string; day: string };
  bodyStrength: "强" | "弱" | "中和";
  xiYongShen: { xi: string[]; ji: string[] };
}

export interface YearlyFlow {
  year: number;
  ganZhi: string;
  gan: string;
  zhi: string;
  shiShen: string;
  naYin: string;
  wuXing: { gan: string; zhi: string };
}

function countWuxing(pillar: BaziPillar): Record<string, number> {
  const counts: Record<string, number> = { 金: 0, 木: 0, 水: 0, 火: 0, 土: 0 };
  const all = [pillar.year, pillar.month, pillar.day, pillar.hour].join("");
  for (const char of all) {
    const wx = WUXING_MAP[char];
    if (wx) counts[wx] = (counts[wx] || 0) + 1;
  }
  return counts;
}

export function getBaziProfile(
  birthDateTime: Date,
  gender: "male" | "female" | string
): BaziPillar {
  const solar = Solar.fromYmdHms(
    birthDateTime.getFullYear(),
    birthDateTime.getMonth() + 1,
    birthDateTime.getDate(),
    birthDateTime.getHours(),
    birthDateTime.getMinutes(),
    birthDateTime.getSeconds()
  );
  const lunar = solar.getLunar();

  const year = lunar.getYearInGanZhiExact();
  const month = lunar.getMonthInGanZhiExact();
  const day = lunar.getDayInGanZhiExact();
  const hour = lunar.getTimeInGanZhi();

  const dayGan = lunar.getDayGanExact();
  const dayZhi = lunar.getDayZhiExact();

  const genderLabel = gender === "male" ? "元男" : gender === "female" ? "元女" : "元身";

  const pillar: BaziPillar = {
    year,
    month,
    day,
    hour,
    dayMaster: {
      gan: dayGan,
      zhi: dayZhi,
      wuxing: WUXING_MAP[dayGan] || "",
    },
    genderLabel,
    wuxing: {},
    shishen: { gan: lunar.getBaZiShiShenGan(), zhi: lunar.getBaZiShiShenZhi() },
    nayin: lunar.getBaZiNaYin(),
    lunarDate: {
      year: lunar.getYearInChinese(),
      month: lunar.getMonthInChinese(),
      day: lunar.getDayInChinese(),
    },
    bodyStrength: "中和",
    xiYongShen: { xi: [], ji: [] },
  };

  pillar.wuxing = countWuxing(pillar);
  const analysis = analyzeBodyStrength(pillar);
  pillar.bodyStrength = analysis.strength;
  pillar.xiYongShen = analysis.xiYongShen;
  return pillar;
}

const GENERATES: Record<string, string> = {
  木: "火",
  火: "土",
  土: "金",
  金: "水",
  水: "木",
};

const OVERCOMES: Record<string, string> = {
  木: "土",
  土: "水",
  水: "火",
  火: "金",
  金: "木",
};

function isHelpful(dayWx: string, targetWx: string) {
  return dayWx === targetWx || GENERATES[targetWx] === dayWx;
}

function isConsuming(dayWx: string, targetWx: string) {
  return GENERATES[dayWx] === targetWx || OVERCOMES[dayWx] === targetWx;
}

function analyzeBodyStrength(pillar: BaziPillar): {
  strength: "强" | "弱" | "中和";
  xiYongShen: { xi: string[]; ji: string[] };
} {
  const dayWx = pillar.dayMaster.wuxing;
  const monthZhi = pillar.month.slice(1);
  const monthWx = WUXING_MAP[monthZhi] || "";

  let helpful = 0;
  let consuming = 0;

  const allChars = [pillar.year, pillar.month, pillar.day, pillar.hour].join("");
  for (const char of allChars) {
    const wx = WUXING_MAP[char];
    if (!wx) continue;
    if (isHelpful(dayWx, wx)) helpful++;
    if (isConsuming(dayWx, wx)) consuming++;
  }

  // 月令加权
  if (isHelpful(dayWx, monthWx)) helpful += 1.5;
  if (isConsuming(dayWx, monthWx)) consuming += 1.5;

  const strength: "强" | "弱" | "中和" =
    helpful > consuming + 2 ? "强" : consuming > helpful + 2 ? "弱" : "中和";

  const allWuxing = ["金", "木", "水", "火", "土"];
  const xi = allWuxing.filter((wx) =>
    strength === "强" ? isConsuming(dayWx, wx) : isHelpful(dayWx, wx)
  );
  const ji = allWuxing.filter((wx) =>
    strength === "强" ? isHelpful(dayWx, wx) : isConsuming(dayWx, wx)
  );

  return { strength, xiYongShen: { xi, ji } };
}

function getShiShenFor(dayMasterGan: string, targetGan: string): string {
  // Simplified lookup based on standard BaZi ten-gods for same-sex reference.
  // This is a heuristic used for yearly stem; full ten-god logic is handled by lunar-javascript for pillars.
  const dayIdx = GAN.indexOf(dayMasterGan);
  const targetIdx = GAN.indexOf(targetGan);
  if (dayIdx <= 0 || targetIdx <= 0) return "未知";

  const samePolarity = dayIdx % 2 === targetIdx % 2;
  const dayWx = WUXING_MAP[dayMasterGan];
  const targetWx = WUXING_MAP[targetGan];

  if (dayMasterGan === targetGan) return "比肩";

  const generates: Record<string, string> = {
    木: "火", 火: "土", 土: "金", 金: "水", 水: "木",
  };
  const overcomes: Record<string, string> = {
    木: "土", 土: "水", 水: "火", 火: "金", 金: "木",
  };

  if (generates[dayWx] === targetWx) {
    return samePolarity ? "食神" : "伤官";
  }
  if (generates[targetWx] === dayWx) {
    return samePolarity ? "偏印" : "正印";
  }
  if (overcomes[dayWx] === targetWx) {
    return samePolarity ? "偏财" : "正财";
  }
  if (overcomes[targetWx] === dayWx) {
    return samePolarity ? "七杀" : "正官";
  }
  return "未知";
}

export function getYearlyFlow(profile: BaziPillar, year: number): YearlyFlow {
  // Build a solar date for Li Chun (start of BaZi year) approximated as Feb 4 of the Gregorian year.
  // For more accurate Li Chun the library offers getJieQi, but this is sufficient for MVP yearly flow.
  const solar = Solar.fromYmd(year, 2, 4);
  const lunar = solar.getLunar();
  const ganZhi = lunar.getYearInGanZhiByLiChun();
  const gan = lunar.getYearGanByLiChun();
  const zhi = lunar.getYearZhiByLiChun();

  const shiShen = getShiShenFor(profile.dayMaster.gan, gan);
  const naYin = getNaYin(ganZhi);

  return {
    year,
    ganZhi,
    gan,
    zhi,
    shiShen,
    naYin,
    wuXing: {
      gan: WUXING_MAP[gan] || "",
      zhi: WUXING_MAP[zhi] || "",
    },
  };
}

// 六十甲子纳音表（完整）
const NA_YIN_MAP: Record<string, string> = {
  甲子: "海中金", 乙丑: "海中金", 丙寅: "炉中火", 丁卯: "炉中火",
  戊辰: "大林木", 己巳: "大林木", 庚午: "路旁土", 辛未: "路旁土",
  壬申: "剑锋金", 癸酉: "剑锋金", 甲戌: "山头火", 乙亥: "山头火",
  丙子: "涧下水", 丁丑: "涧下水", 戊寅: "城头土", 己卯: "城头土",
  庚辰: "白蜡金", 辛巳: "白蜡金", 壬午: "杨柳木", 癸未: "杨柳木",
  甲申: "泉中水", 乙酉: "泉中水", 丙戌: "屋上土", 丁亥: "屋上土",
  戊子: "霹雳火", 己丑: "霹雳火", 庚寅: "松柏木", 辛卯: "松柏木",
  壬辰: "长流水", 癸巳: "长流水", 甲午: "砂中金", 乙未: "砂中金",
  丙申: "山下火", 丁酉: "山下火", 戊戌: "平地木", 己亥: "平地木",
  庚子: "壁上土", 辛丑: "壁上土", 壬寅: "金箔金", 癸卯: "金箔金",
  甲辰: "覆灯火", 乙巳: "覆灯火", 丙午: "天河水", 丁未: "天河水",
  戊申: "大驿土", 己酉: "大驿土", 庚戌: "钗钏金", 辛亥: "钗钏金",
  壬子: "桑柘木", 癸丑: "桑柘木", 甲寅: "大溪水", 乙卯: "大溪水",
  丙辰: "沙中土", 丁巳: "沙中土", 戊午: "天上火", 己未: "天上火",
  庚申: "石榴木", 辛酉: "石榴木", 壬戌: "大海水", 癸亥: "大海水",
};

function getNaYin(ganZhi: string): string {
  return NA_YIN_MAP[ganZhi] || "";
}

export interface DailyFlow {
  date: string;
  yearGanZhi: string;
  monthGanZhi: string;
  dayGanZhi: string;
  dayShiShen: string;
  dayNaYin: string;
  dayWuXing: string;
}

export function getDailyFlow(profile: BaziPillar, date: Date): DailyFlow {
  const solar = Solar.fromYmd(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate()
  );
  const lunar = solar.getLunar();

  const yearGanZhi = lunar.getYearInGanZhiByLiChun();
  const monthGanZhi = lunar.getMonthInGanZhi();
  const dayGanZhi = lunar.getDayInGanZhi();

  const dayGan = lunar.getDayGan();
  const dayShiShen = getShiShenFor(profile.dayMaster.gan, dayGan);

  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    yearGanZhi,
    monthGanZhi,
    dayGanZhi,
    dayShiShen,
    dayNaYin: getNaYin(dayGanZhi),
    dayWuXing: WUXING_MAP[dayGan] || "",
  };
}
