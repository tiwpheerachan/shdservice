import { ENGINEER_EMAIL, OWNER_EMAIL } from './support/env';
import { jobUuid, newJob, one } from './support/db';
import { expect, signIn, test } from './support/fixtures';

const [A, B] = ['E2E ตรวจพบ จอไม่ติด', 'E2E ตรวจพบ แบตบวม'];

const stored = (no: string) =>
  one<{ first: string | null; rest: number }>(
    `SELECT s.symptom_name AS first,
            (SELECT count(*)::int FROM job_engineer_symptom r WHERE r.job_pk = j.pk) AS rest
       FROM job j LEFT JOIN symptom s ON s.pk = j.engineer_symptom_pk WHERE j.job_no = $1`,
    [no],
  );

test('several found symptoms save and come back, nothing marked as main; all removed = none', async ({ page }) => {
  const no = await newJob({ status: 2 });
  const id = await jobUuid(no);
  await signIn(page, ENGINEER_EMAIL);
  await page.goto(`/jobs/repair?id=${id}`);
  const save = async () => {
    await page.getByRole('button', { name: 'บันทึกงานซ่อม' }).click();
    await expect(page.getByText('บันทึกงานซ่อมเรียบร้อย').first()).toBeVisible();
  };

  await page.getByRole('combobox', { name: /อาการเสียที่ตรวจพบ/ }).click();
  await page.getByRole('option', { name: A }).click();
  await page.getByRole('option', { name: B }).click();
  await page.getByRole('button', { name: 'เสร็จ' }).click();
  await expect(page.getByText('เลือกแล้ว 2 อาการ')).toBeVisible();
  await expect(page.getByRole('button', { name: `เอา ${B} ออก` })).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(`ตั้ง ${B} เป็นอาการหลัก`) })).toHaveCount(0);
  await save();
  expect(await stored(no)).toEqual({ first: A, rest: 1 });

  await page.goto(`/jobs/repair?id=${id}`);
  await expect(page.getByRole('button', { name: `เอา ${A} ออก` })).toBeVisible();
  await expect(page.getByRole('button', { name: `เอา ${B} ออก` })).toBeVisible();

  await page.getByRole('button', { name: `เอา ${A} ออก` }).click();
  await page.getByRole('button', { name: `เอา ${B} ออก` }).click();
  await save();
  expect(await stored(no)).toEqual({ first: null, rest: 0 });
});

test('the return note and the repair close sheet print every found symptom, comma-separated', async ({ page }) => {
  const no = await newJob({ status: 5 });
  await one(
    `WITH s AS (SELECT pk, symptom_name n FROM symptom WHERE symptom_name IN ($2, $3))
     , u AS (UPDATE job SET engineer_symptom_pk = (SELECT pk FROM s WHERE n = $2) WHERE job_no = $1 RETURNING pk)
     INSERT INTO job_engineer_symptom (job_pk, symptom_pk) SELECT u.pk, s.pk FROM u, s WHERE s.n = $3 RETURNING 1`,
    [no, A, B],
  );
  await signIn(page, OWNER_EMAIL);
  const id = await jobUuid(no);
  for (const doc of ['return', 'repair-close']) {
    await page.goto(`/print/job/${id}/${doc}?auto=0`);
    await expect(page.getByText(`${A}, ${B}`, { exact: true })).toBeVisible();
  }
});
