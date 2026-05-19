import { Page, expect, TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

type A11yOptions = {
  rules?: string[];
  exclude?: string[];
  include?: string[];
  testInfo?: TestInfo;
  disableRules?: string[];
};

const DEFAULT_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

function createBuilder(page: Page, options: A11yOptions = {}) {
  let builder = new AxeBuilder({ page }).withTags(DEFAULT_TAGS).exclude("#nprogress");

  if (options.rules?.length) {
    builder = builder.withRules(options.rules);
  }

  if (options.disableRules?.length) {
    builder = builder.disableRules(options.disableRules);
  }

  if (options.exclude?.length) {
    for (const sel of options.exclude) {
      builder = builder.exclude(sel);
    }
  }

  if (options.include?.length) {
    for (const sel of options.include) {
      builder = builder.include(sel);
    }
  }

  return builder;
}

function formatViolationSummary(
  violations: Array<{ id: string; impact?: string | null; nodes: unknown[] }>,
): string {
  if (violations.length === 0) return "Found 0 accessibility violations";
  const summary = violations
    .map(
      (v) =>
        `  - ${v.id} (${v.impact || "N/A"}): ${v.nodes.length} node(s) affected`,
    )
    .join("\n");
  return `Found ${violations.length} accessibility violation(s):\n${summary}`;
}

/**
 * Full-page WCAG scan. Use after page load / navigation for baseline coverage.
 * Mitigates: WCAG 1.3.1, 4.1.2, 2.4.6, 3.3.2
 */
export async function checkA11y(page: Page, options: A11yOptions = {}) {
  const builder = createBuilder(page, options);
  const results = await builder.analyze();

  if (options.testInfo) {
    await options.testInfo.attach("accessibility-report", {
      body: JSON.stringify(results.violations, null, 2),
      contentType: "application/json",
    });
  }

  if (results.violations.length > 0) {
    console.error(
      `\n[Accessibility Violations: ${results.violations.length}]\n`,
      JSON.stringify(results.violations, null, 2),
    );
  }

  expect(results.violations, formatViolationSummary(results.violations)).toHaveLength(0);
}

/**
 * Scoped scan on a specific container. Use for forms, dialogs, nav, etc.
 * Mitigates: WCAG 1.3.1, 4.1.2 within component boundaries
 */
export async function checkA11yComponent(
  page: Page,
  containerSelector: string,
  options: A11yOptions = {},
) {
  return checkA11y(page, { ...options, include: [containerSelector] });
}

/**
 * Scan targeting specific axe rules. Use for focused checks like heading-order, label, aria-valid-attr.
 * Mitigates: individual WCAG criteria (2.4.6, 3.3.2, 4.1.2)
 */
export async function checkA11yRules(
  page: Page,
  rules: string[],
  options: A11yOptions = {},
) {
  return checkA11y(page, { ...options, rules });
}

/**
 * Scan with exclusions. Use to bypass third-party widgets or known non-blocking violations.
 */
export async function checkA11yWithExclusions(
  page: Page,
  exclusions: { exclude: string[] },
  options: A11yOptions = {},
) {
  return checkA11y(page, { ...options, exclude: exclusions.exclude });
}

/**
 * Wait for the page to be fully loaded and hydrated before scanning.
 * Prevents flaky scans caused by incomplete DOM rendering.
 */
export async function waitForPageReady(page: Page) {
  await page.waitForLoadState("load");
  await page.waitForTimeout(300);
}
