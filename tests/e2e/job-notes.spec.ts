import { ENGINEER_EMAIL } from './support/env';
import { jobUuid, newJob, one } from './support/db';
import { expect, signIn, test } from './support/fixtures';

test('a long repair note saves and comes back whole on บันทึกงานซ่อม', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'the form rules are not viewport-dependent');
  const no = await newJob({ status: 2 });
  const detail = `${'เปลี่ยนชุดสายกล้องหน้าและทดสอบบันทึกวีดีโอ '.repeat(45)}จบ`.slice(0, 2000);
  const remark = `ใช้เมมลูกค้าทดสอบไม่สามารถอ่านได้\n${'ใช้เมมช่างทดสอบปกติ '.repeat(20)}`.trim();
  await signIn(page, ENGINEER_EMAIL);
  const url = `/jobs/repair?id=${await jobUuid(no)}`;
  await page.goto(url);
  await page.getByLabel('วิธีการซ่อม').fill(detail);
  // the job's own หมายเหตุ comes first on this page
  const engineerRemark = page.getByLabel('หมายเหตุ', { exact: true }).last();
  await engineerRemark.fill(remark);
  await page.getByRole('button', { name: 'บันทึกงานซ่อม' }).click();
  await expect(page.getByText('บันทึกงานซ่อมเรียบร้อย')).toBeVisible();

  await page.goto(url);
  await expect(page.getByLabel('วิธีการซ่อม')).toHaveValue(detail.trim());
  await expect(engineerRemark).toHaveValue(remark);
  const stored = await one<{ d: string; r: string }>(
    `SELECT engineer_repair_detail AS d, engineer_remark AS r FROM job WHERE job_no = $1`,
    [no],
  );
  expect(stored).toEqual({ d: detail.trim(), r: remark });
});
