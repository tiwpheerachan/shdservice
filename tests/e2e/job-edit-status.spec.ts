import { OWNER_EMAIL } from './support/env';
import { jobUuid, newJob, one, rows } from './support/db';
import { expect, signIn, test } from './support/fixtures';

const statusName = async (id: number) =>
  (await one<{ n: string }>('SELECT trim(job_status_name) AS n FROM job_status WHERE job_status_id = $1', [id])).n;

test('แก้ไขข้อมูลงาน: สถานะงาน picks an open status (no closed / ยกเลิก one) and saves it with its job_log row', async ({
  page,
}) => {
  const no = await newJob({ status: 2 });
  const [waitParts, closed, cancelled] = await Promise.all([3, 20, 0].map(statusName));
  await signIn(page, OWNER_EMAIL);
  await page.goto(`/jobs/edit?id=${await jobUuid(no)}`);

  await page.getByRole('combobox', { name: 'สถานะงาน' }).click();
  await expect(page.getByRole('option', { name: closed, exact: true })).toHaveCount(0);
  await expect(page.getByRole('option', { name: cancelled, exact: true })).toHaveCount(0);
  await page.getByRole('option', { name: waitParts, exact: true }).click();
  await page.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
  await expect(page.getByText('บันทึกการแก้ไขงานแล้ว').first()).toBeVisible();

  expect((await one<{ s: number }>('SELECT job_status_id AS s FROM job WHERE job_no = $1', [no])).s).toBe(3);
  const logged = await rows<{ s: number }>(
    'SELECT job_status_id AS s FROM job_status_log WHERE job_pk = (SELECT pk FROM job WHERE job_no = $1)',
    [no],
  );
  expect(logged.map((r) => r.s)).toContain(3);
});
