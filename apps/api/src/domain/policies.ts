import type { Language } from "@homepro/shared";

type Localized = Record<Language, string>;

/**
 * Fixture from spec §2.2. The only allowed source for support answers.
 * SUP-02 is split so a handoff quotes its order/damaged `scope` only when that is the reason,
 * while the `disclosure` (no lookup, no ticketing) appears in every handoff.
 */
export const POLICIES: {
  readonly "SUP-01": { readonly id: "SUP-01"; readonly text: Localized };
  readonly "SUP-02": { readonly id: "SUP-02"; readonly scope: Localized; readonly disclosure: Localized };
} = {
  "SUP-01": {
    id: "SUP-01",
    text: {
      en: "For unopened items, a return request may be reviewed within 14 days with proof of purchase. Approval is not guaranteed.",
      th: "สินค้าที่ยังไม่ได้แกะกล่อง สามารถยื่นคำขอคืนสินค้าเพื่อพิจารณาได้ภายใน 14 วัน พร้อมหลักฐานการซื้อ ทั้งนี้ไม่รับประกันว่าคำขอจะได้รับการอนุมัติ",
    },
  },
  "SUP-02": {
    id: "SUP-02",
    scope: {
      en: "For order status or damaged deliveries, we pass you to staff.",
      th: "สำหรับการติดตามสถานะคำสั่งซื้อหรือสินค้าเสียหายระหว่างจัดส่ง เราจะส่งต่อให้เจ้าหน้าที่",
    },
    disclosure: {
      en: "This demo has no order lookup or real ticketing system.",
      th: "ระบบเดโมนี้ไม่มีการค้นหาคำสั่งซื้อหรือระบบเปิดเรื่องจริง",
    },
  },
};
