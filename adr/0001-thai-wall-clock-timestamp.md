# 0001 — เวลาไทยเก็บใน `timestamp` ไม่มี TZ และ session DB เป็น Asia/Bangkok

- **Status:** Accepted
- **Date:** 2026-09-15 (ย้ายจาก `docs/backend-rebase-plan.md` §0)

## Context

DB legacy (`SHDElectronicServiceDB` แปลงจาก SQL Server) เก็บทุกเวลาเป็น `timestamp` **without time zone** ที่ถือค่าเวลาไทย
และต้อง re-dump ทับได้ก่อน go-live — แก้ชนิดคอลัมน์เป็น `timestamptz` จะโดน dump ทับ และระบบเดิมกับรายงานเก่าอ่านค่าแบบเดิมอยู่

## Decision

- คงชนิดคอลัมน์เดิม เขียน/อ่านเป็นเวลาไทย (wall clock) · sentinel `1900-01-01` / `-1` / `0` = ว่าง
- pool ตั้ง `TimeZone=Asia/Bangkok` ทุก connection (`src/db/client.ts`) → `now()` / `current_date` เป็นเวลาไทย
- process ก็ไทย: `TZ=Asia/Bangkok` (`render.yaml` + dashboard) · วันที่ทางธุรกิจผ่าน `src/lib/dates.ts` (`today()`, `isoDate()`, …)
- ESLint ห้ามตัดวันที่จาก `toISOString()` (UTC) — `eslint.config.mjs`

## Consequences

- ค่าใน DB ตรงกับที่ระบบเดิมและคนอ่านเห็น ไม่ต้องแปลงตอน re-dump
- ทุก connection ที่ไม่ผ่าน pool (psql, DBeaver, สคริปต์) ต้องตั้ง TZ เอง ไม่งั้น `now()` เป็น UTC
- ไม่มี offset ในข้อมูล — ถ้าวันหนึ่งมีสาขานอกไทยต้อง migrate เป็น `timestamptz` ทั้งระบบ
