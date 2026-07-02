import { expect, test } from 'playwright/test';

test('loads the public demo project and app shell', async ({ page, request }) => {
  const projectsResponse = await request.get('/api/projects');
  expect(projectsResponse.ok()).toBe(true);

  const body = await projectsResponse.json() as { projects: Array<{ project: string; asset_count: number }> };
  expect(body.projects).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ project: 'demo-project', asset_count: expect.any(Number) }),
    ])
  );

  await page.goto('/');
  await expect(page.getByText('Lineage').first()).toBeVisible();
});
