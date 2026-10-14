# Architecture decision records — OneService

บันทึก **การตัดสินใจ** ที่ใครมาแก้โค้ดต้องรู้ก่อน (ทำไมเป็นแบบนี้ ไม่ใช่วิธีใช้) · รูปแบบเดียวกับ OneLink (`../../../shd_onelink/adr/`)
แผนงาน/รายละเอียด implement อยู่ที่ `../docs/` — ADR เก็บแค่ข้อตัดสินใจ แล้ว docs ลิงก์มาที่นี่ (ไม่เขียนซ้ำสองที่)

| #    | การตัดสินใจ | สถานะ |
| ---- | ----------- | ----- |
| 0001 | [เวลาไทยใน `timestamp` ไม่มี TZ + session DB เป็น Asia/Bangkok](0001-thai-wall-clock-timestamp.md) | Accepted |
| 0002 | [Soft delete แบบเดียวทั้งระบบด้วย `record_status`](0002-soft-delete-record-status.md) | Accepted |
| 0003 | [Instance เดียว: cache และ rate limit อยู่ใน memory](0003-single-instance-in-memory.md) | Accepted |
| 0004 | [หน้าติดตามสาธารณะ fail-closed](0004-public-tracking-fail-closed.md) | Accepted |
| 0005 | [ความปลอดภัยของ DB production](0005-production-db-safety.md) | Accepted |
| 0006 | [แบ่งงาน agent ตามพื้นที่โค้ด](0006-agents-split-by-area.md) | Accepted |

## เขียน ADR ใหม่

1. ไฟล์ `NNNN-ชื่อสั้น.md` เลขถัดไป · หัวข้อ `# NNNN — <การตัดสินใจเป็นประโยคเดียว>`
2. `- **Status:** Accepted | Deferred | Superseded by NNNN` และ `- **Date:** YYYY-MM-DD`
3. สามหัวข้อ: **Context** (ปัญหา/ข้อจำกัด) · **Decision** (ทำอะไร, path ของโค้ดที่บังคับใช้) · **Consequences** (ได้อะไร เสียอะไร เพดานอยู่ตรงไหน)
4. สั้น — ครึ่งหน้า · เพิ่มแถวในตารางด้านบน · ถ้าย้ายมาจาก docs ให้แทนข้อความเดิมด้วยลิงก์มาที่ ADR
5. เปลี่ยนใจ = ADR ใหม่ แล้วแก้ของเก่าเป็น **Superseded by NNNN** — ไม่ลบ
