import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { test as base, expect } from "@playwright/test";
import { newRunId, seedUnits, UNIT_A_NO_NOTICE, UNIT_B, withRunData } from "../support/data";

interface Portfolio {
  runId: string;
  units: Record<string, number>;
  open(): Promise<void>;
}

export const test = base.extend<{ portfolio: Portfolio }>({
  portfolio: async ({ page }, use, testInfo) => {
    const runId = newRunId(testInfo.title);
    // Seeding, sign-in setup and the test all run inside withRunData, so a failure at any point
    // still resets the clock and removes this run's rows.
    await withRunData(
      runId,
      async () => {
        const units = await seedUnits(runId, [UNIT_B, UNIT_A_NO_NOTICE]);
        await setupClerkTestingToken({ page });
        await use({
          runId,
          units,
          open: async () => {
            await page.goto(`/showings?portfolio=${runId}`);
            await expect(page.getByTestId("signed-in-as")).toBeVisible();
          },
        });
      },
      { keep: !!process.env.KEEP_TEST_DATA },
    );
  },
});

export { expect };
