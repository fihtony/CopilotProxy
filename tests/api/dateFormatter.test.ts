import { formatBucketToLocalTime, getBucketAxisLabel, hasVisibleSecondaryBucketAxisLabels } from "../../ui/src/utils/dateFormatter";

describe("date formatter", () => {
  it("suppresses redundant midnight time on 7d axis labels", () => {
    const currentYear = new Date().getFullYear();
    const label = getBucketAxisLabel(`${currentYear}-04-05 00:00:00`, { suppressMidnightTime: true });

    expect(label.primary).toBe("04-05");
    expect(label.secondary).toBeUndefined();
  });

  it("keeps non-midnight time on axis labels when needed", () => {
    const currentYear = new Date().getFullYear();
    const label = getBucketAxisLabel(`${currentYear}-04-05 08:00:00`, { suppressMidnightTime: true });

    expect(label.primary).toBe("04-05");
    expect(label.secondary).toBe("08:00");
  });

  it("keeps time in tooltip-style formatting", () => {
    const currentYear = new Date().getFullYear();
    expect(formatBucketToLocalTime(`${currentYear}-04-05 00:00:00`)).toBe("04-05 00:00");
  });

  it("formats cross-year dates as YY-MM-DD", () => {
    const previousYear = new Date().getFullYear() - 1;
    const label = getBucketAxisLabel(`${previousYear}-12-31`);

    expect(label.primary).toBe(`${String(previousYear).slice(-2)}-12-31`);
    expect(label.secondary).toBeUndefined();
  });

  it("does not reserve a second axis row when visible 7d ticks are all midnight", () => {
    const currentYear = new Date().getFullYear();
    const buckets = [
      `${currentYear}-04-01 00:00:00`,
      `${currentYear}-04-01 04:00:00`,
      `${currentYear}-04-01 08:00:00`,
      `${currentYear}-04-01 12:00:00`,
      `${currentYear}-04-01 16:00:00`,
      `${currentYear}-04-01 20:00:00`,
      `${currentYear}-04-02 00:00:00`,
    ];

    expect(hasVisibleSecondaryBucketAxisLabels(buckets, { suppressMidnightTime: true }, 6)).toBe(false);
  });

  it("reserves a second axis row when a visible tick includes a non-midnight time", () => {
    const currentYear = new Date().getFullYear();
    const buckets = [`${currentYear}-04-01 08:00:00`, `${currentYear}-04-02 08:00:00`];

    expect(hasVisibleSecondaryBucketAxisLabels(buckets, { suppressMidnightTime: true }, 1)).toBe(true);
  });

  it("suppressAllTime prevents any secondary axis labels regardless of time value (prevents 7d vs 30d/90d axis height jump)", () => {
    const currentYear = new Date().getFullYear();
    // 7d-style hourly buckets: mix of midnight and non-midnight
    const buckets7d = [
      `${currentYear}-04-01 00:00:00`,
      `${currentYear}-04-01 06:00:00`,
      `${currentYear}-04-01 12:00:00`,
      `${currentYear}-04-01 18:00:00`,
      `${currentYear}-04-02 00:00:00`,
    ];
    // With suppressAllTime (used for 7d), no secondary labels → same height=30 as 30d/90d
    expect(hasVisibleSecondaryBucketAxisLabels(buckets7d, { suppressAllTime: true })).toBe(false);
    // Without suppression, non-midnight times produce secondary labels → height=48
    expect(hasVisibleSecondaryBucketAxisLabels(buckets7d, {})).toBe(true);

    // 30d/90d-style daily buckets (no time component): never produce secondary labels
    const buckets30d = [`${currentYear}-04-01`, `${currentYear}-04-05`, `${currentYear}-04-10`];
    expect(hasVisibleSecondaryBucketAxisLabels(buckets30d, { suppressAllTime: true })).toBe(false);
    expect(hasVisibleSecondaryBucketAxisLabels(buckets30d, {})).toBe(false);

    // Stale-data flash scenario: 7d hourly data is still rendered while timeWindow
    // has switched to 30d/90d. The chart derives suppressAllTime from dataHasTimeBuckets
    // (true) && timeWindow !== "24h" (true) → suppressAllTime=true → height stays 30.
    // Verified here: even with the stale hourly buckets and suppressAllTime=true,
    // no secondary labels appear, so height stays at 30 during the transition.
    expect(hasVisibleSecondaryBucketAxisLabels(buckets7d, { suppressAllTime: true })).toBe(false);
  });

  it("suppressAllTime strips time from getBucketAxisLabel for any time value", () => {
    const currentYear = new Date().getFullYear();
    const noon = getBucketAxisLabel(`${currentYear}-04-05 12:00:00`, { suppressAllTime: true });
    expect(noon.primary).toBe("04-05");
    expect(noon.secondary).toBeUndefined();

    const midnight = getBucketAxisLabel(`${currentYear}-04-05 00:00:00`, { suppressAllTime: true });
    expect(midnight.primary).toBe("04-05");
    expect(midnight.secondary).toBeUndefined();
  });
});