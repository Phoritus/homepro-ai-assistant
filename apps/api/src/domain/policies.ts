import type { Language, PolicyId } from "@homepro/shared";

export interface PolicyRecord {
  id: PolicyId;
  text: Record<Language, string>;
}

/** Fixture from spec §2.2. The only allowed source for support answers. */
export const POLICIES: Readonly<Record<PolicyId, PolicyRecord>> = {
  "SUP-01": {
    id: "SUP-01",
    text: {
      en: "For unopened items, a return request may be reviewed within 14 days with proof of purchase. Approval is not guaranteed.",
      th: "สินค้าที่ยังไม่ได้แกะกล่อง สามารถยื่นคำขอคืนสินค้าเพื่อพิจารณาได้ภายใน 14 วัน พร้อมหลักฐานการซื้อ ทั้งนี้ไม่รับประกันว่าคำขอจะได้รับการอนุมัติ",
    },
  },
  "SUP-02": {
    id: "SUP-02",
    text: {
      en: "For order status or damaged deliveries, we pass you to staff. This demo has no order lookup or real ticketing system.",
      th: "สำหรับการติดตามสถานะคำสั่งซื้อหรือสินค้าเสียหายระหว่างจัดส่ง เราจะส่งต่อให้เจ้าหน้าที่ ระบบเดโมนี้ไม่มีการค้นหาคำสั่งซื้อหรือระบบเปิดเรื่องจริง",
    },
  },
};
