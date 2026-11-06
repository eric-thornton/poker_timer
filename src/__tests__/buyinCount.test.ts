import getNextBuyinCount from '../buyinCount';

describe('getNextBuyinCount', () => {
  it('stays at the limit when wrapping is disabled', () => {
    expect(getNextBuyinCount(2, 2, false)).toBe(2);
  });

  it('returns to one at the limit when wrapping is enabled', () => {
    expect(getNextBuyinCount(2, 2, true)).toBe(1);
  });

  it('increments below the limit', () => {
    expect(getNextBuyinCount(1, 2, false)).toBe(2);
  });
});
