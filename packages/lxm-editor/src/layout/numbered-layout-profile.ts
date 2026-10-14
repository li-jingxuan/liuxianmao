import type { ILXMLayoutPurpose } from "./layout-types";

/** 编辑净空与成品净空只改变投影，不进入音乐时间、文档和历史。 */
export const numberedLayoutProfile = (
  purpose: ILXMLayoutPurpose = "presentation",
) =>
  purpose === "editing"
    ? {
        purpose,
        glyphGap: 4,
        itemGap: 4,
        stretch: 1.15,
        octaveGap: 1.8,
        octaveStackGap: 1.2,
        markGap: 2.5,
        staffGap: 6,
        tieHeight: [2.5, 4] as const,
        slurHeight: [3.5, 5.5] as const,
        widths: {
          whole: 40,
          half: 32,
          quarter: 26,
          eighth: 24,
          sixteenth: 22,
          thirtySecond: 20,
        },
      }
    : {
        purpose,
        glyphGap: 2.5,
        itemGap: 2,
        stretch: 1.08,
        octaveGap: 1.3,
        octaveStackGap: 0.8,
        markGap: 2,
        staffGap: 4,
        tieHeight: [2, 3.5] as const,
        slurHeight: [3, 5] as const,
        widths: {
          whole: 32,
          half: 26,
          quarter: 20,
          eighth: 18,
          sixteenth: 16,
          thirtySecond: 15,
        },
      };
export type NumberedLayoutProfile = ReturnType<typeof numberedLayoutProfile>;
