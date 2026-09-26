import { chromium } from "@playwright/test";
const out = process.argv[2], url = process.argv[3], tag = process.argv[4] ?? "v1";
const b = await chromium.launch();
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.goto(url, { waitUntil: "networkidle" });
  await p.screenshot({ path: `${out}/${tag}_${w}_haut.png` });
  await p.screenshot({ path: `${out}/${tag}_${w}_complet.png`, fullPage: true });
  await p.getByRole("button", { name: "After the fix" }).click();
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/${tag}_${w}_corrige.png` });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log(w, "horizontal overflow px:", overflow);
  await p.close();
}
await b.close();
