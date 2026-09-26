import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { test as base, expect } from "@playwright/test";
import { cleanupRun, newRunId, seedUnits, setTestClock, UNIT_A_NO_NOTICE, UNIT_B } from "../support/data";

interface Portfolio {
  runId: string;
  units: Record<string, number>;
  open(): Promise<void>;
}

export const test = base.extend<{ portfolio: Portfolio }>({
  portfolio: async ({ page }, use, testInfo) => {
    const runId = newRunId(testInfo.title);
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
    await setTestClock(null);
    if (!process.env.KEEP_TEST_DATA) await cleanupRun(runId);
  },
});

export { expect };
