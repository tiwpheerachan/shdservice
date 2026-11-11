# 0006 — แบ่งงาน agent ตามพื้นที่โค้ด

- **Status:** Accepted
- **Date:** 2026-10-14

## Context

งาน production-readiness ทำด้วย AI agent หลายตัวพร้อมกัน · agent สองตัวแก้ไฟล์เดียวกันจะทับงานกัน
และรายงานของ agent ไม่ใช่หลักฐานว่าโค้ดผ่าน

## Decision

- กติกาอยู่ที่ [`AGENTS.md`](../AGENTS.md) (§ Splitting work across agents) — ไม่เขียนซ้ำที่นี่
- สรุป: หนึ่ง agent ต่อหนึ่งพื้นที่ (เช่น auth/proxy vs services/migrations), รันขนานเฉพาะเมื่อชุดไฟล์ไม่ทับกัน · brief ระบุไฟล์ที่เป็นเจ้าของ/ห้ามแตะ, `.env` = production, ห้าม commit, รายงาน file:line + สิ่งที่ข้าม
- session หลักรวมงาน รัน `tsc` / `eslint .` / `npm test` / `npm run test:db` เอง แล้วติ๊ก `docs/production-readiness.md`

## Consequences

- งานขนานได้โดยไม่ชนกัน · ต้นทุนคือ session หลักต้องเขียน brief และ verify ซ้ำทุกครั้ง
- งานที่ข้ามพื้นที่ (เช่น key ของ rate limit ใน `/track`) ต้องแจ้งในรายงานให้ session หลักตรวจรวม
