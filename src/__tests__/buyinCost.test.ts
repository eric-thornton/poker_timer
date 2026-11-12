import {
  adjustBountyCount,
  calculateBuyinCost,
  calculateChipValue,
  calculateTotalBuyinCost,
  calculateTotalChipValue,
} from '../buyinCost';

describe('calculateBuyinCost', () => {
  it('uses the buy-in cost for the first entry', () => {
    expect(calculateBuyinCost(1, 10, 10)).toBe(10);
  });

  it('adds the rebuy cost for each additional entry', () => {
    expect(calculateBuyinCost(3, 10, 10)).toBe(30);
  });

  it('excludes a player with no entries', () => {
    expect(calculateBuyinCost(0, 10, 10)).toBe(0);
  });
});

describe('calculateTotalBuyinCost', () => {
  it('totals only players who are playing', () => {
    expect(
      calculateTotalBuyinCost([1, 2, 3], [true, false, true], 10, 10)
    ).toBe(40);
  });
});

describe('calculateChipValue', () => {
  it('uses the buy-in chip value for the first entry', () => {
    expect(calculateChipValue(1, 1500, 1000)).toBe(1500);
  });

  it('adds rebuy chip value for each additional entry', () => {
    expect(calculateChipValue(3, 1500, 1000)).toBe(3500);
  });
});

describe('calculateTotalChipValue', () => {
  it('totals chip values only for players who are playing', () => {
    expect(
      calculateTotalChipValue([1, 2, 3], [true, false, true], 1500, 1000)
    ).toBe(5000);
  });
});

describe('adjustBountyCount', () => {
  it('increments when subtraction is disabled', () => {
    expect(adjustBountyCount(0, false)).toBe(1);
  });

  it('decrements when subtraction is enabled', () => {
    expect(adjustBountyCount(2, true)).toBe(1);
  });

  it('does not decrement below zero', () => {
    expect(adjustBountyCount(0, true)).toBe(0);
  });
});
