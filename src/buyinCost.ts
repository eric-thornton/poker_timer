export const calculateBuyinCost = (
  count: number,
  buyInCost: number,
  rebuyCost: number
) => (count > 0 ? buyInCost + (count - 1) * rebuyCost : 0);

export const calculateTotalBuyinCost = (
  counts: number[],
  playing: boolean[],
  buyInCost: number,
  rebuyCost: number
) =>
  counts.reduce(
    (total, count, index) =>
      playing[index]
        ? total + calculateBuyinCost(count, buyInCost, rebuyCost)
        : total,
    0
  );

export const calculateChipValue = (
  count: number,
  buyInChipValue: number,
  rebuyChipValue: number
) => (count > 0 ? buyInChipValue + (count - 1) * rebuyChipValue : 0);

export const calculateTotalChipValue = (
  counts: number[],
  playing: boolean[],
  buyInChipValue: number,
  rebuyChipValue: number
) =>
  counts.reduce(
    (total, count, index) =>
      playing[index]
        ? total + calculateChipValue(count, buyInChipValue, rebuyChipValue)
        : total,
    0
  );

export const adjustBountyCount = (count: number, subtract: boolean) =>
  Math.max(0, count + (subtract ? -1 : 1));
