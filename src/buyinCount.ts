const getNextBuyinCount = (
  count: number,
  maxBuyins: number,
  wrapBuyins: boolean
) => {
  if (count < maxBuyins) return count + 1;
  return wrapBuyins ? 1 : count;
};

export default getNextBuyinCount;
