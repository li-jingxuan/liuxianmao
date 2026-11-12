/** 网站文案只解释真实比例，不参与核心比例校验或音乐编辑。 */
export const formatTupletLabel = ({ actual, normal }: { actual: number; normal: number }) => {
  const name = ({ 2: "二连音", 3: "三连音", 4: "四连音", 5: "五连音", 6: "六连音" } as Record<number, string>)[actual];
  return name ? `${name}${actual === 5 ? `（${actual}:${normal}）` : ""}` : `连音（${actual}:${normal}）`;
};

export const formatTupletExplanation = ({ actual, normal }: { actual: number; normal: number }) =>
  `${actual} 个等时值音符，占原本 ${normal} 个音符的时间`;
