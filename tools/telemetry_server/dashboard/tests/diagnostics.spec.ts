import { test, expect } from "@playwright/test";
test("SQL filters, pagination and export states preserve the selected scope", async ({
  page,
}) => {
  const requests: string[] = [];
  let posted: any;
  await page.route("**/admin/api/**", async (route) => {
    const url = route.request().url();
    requests.push(url);
    let body: any = { items: [], total: 0 };
    if (url.includes("/v2/groups"))
      body = {
        items: [
          {
            fingerprint: "f-one",
            error_code: "TTS_RUNTIME_TIMEOUT",
            reports: 220,
            occurrences: 500,
            installations: 2,
          },
        ],
        total: 1,
      };
    if (url.includes("/records/errors"))
      body = {
        items: [
          {
            id: 1,
            report_id: "a",
            error_code: "TTS_RUNTIME_TIMEOUT",
            run_id: "run-one",
            installation_id: "install-one",
            details: { stage: "device_probe" },
          },
        ],
        total: 205,
        hasMore: !url.includes("cursor="),
        nextCursor: "next",
      };
    if (url.endsWith("/v2/exports")) {
      posted = route.request().postDataJSON();
      body = { id: "job-one", status: "running" };
    }
    if (url.endsWith("/exports/job-one"))
      body = { id: "job-one", status: "ready" };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.goto("/admin/#diagnostics?tab=reports&build=release-one");
  await expect(page.getByText("共 205 条记录")).toBeVisible();
  await page.getByRole("button", { name: "下一页" }).click();
  await expect
    .poll(() =>
      requests.some(
        (u) => u.includes("cursor=next") && u.includes("build=release-one"),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "生成分析包", exact: true }).click();
  await expect(page.getByRole("link", { name: "下载 ZIP" })).toBeVisible();
  expect(posted.build).toBe("release-one");
  await page.screenshot({
    path: "/private/tmp/sakura-diagnostics-v2.png",
    fullPage: true,
  });
});
test("operation-only links require an explicit run", async ({ page }) => {
  await page.route("**/admin/api/**", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: '{"items":[],"total":0}',
    }),
  );
  await page.goto("/admin/#diagnostics?tab=timeline&operation=duplicate");
  await expect(
    page.getByText(
      "请先指定 Installation ID 和 Run ID。旧链接只有 Operation ID 时，需要选择具体运行。",
    ),
  ).toBeVisible();
});
test("export failure is visible and does not offer a partial ZIP", async ({
  page,
}) => {
  await page.route("**/admin/api/**", async (r) => {
    let body: any = { items: [], total: 0 };
    if (r.request().method() === "POST")
      body = { id: "limited", status: "running" };
    else if (r.request().url().endsWith("/exports/limited"))
      body = { status: "failed", error: "EXPORT_SIZE_LIMIT" };
    await r.fulfill({
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.goto("/admin/#diagnostics");
  await page.getByRole("button", { name: "生成分析包", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("缩小时间范围");
  await expect(page.getByRole("link", { name: "下载 ZIP" })).toHaveCount(0);
});
