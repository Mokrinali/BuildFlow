// Client-safe shapes for the RS.ge forms (no server-only imports here).
import type { ActionState } from "@/server/action-state";

export type RsWaybillView = {
  id: string;
  number: string;
  sellerName: string;
  date: string | null;
  amount: string | null;
  closed: boolean;
  usedOn: { id: string; number: number }[];
};

export type RsListState = ActionState & { options?: RsWaybillView[] };

/** A waybill goods line with the suggested order line and unit factor (new delivery form). */
export type RsGoodsLineView = {
  position: number;
  name: string;
  unit: string;
  quantity: string;
  orderItemId: string | null;
  factor: string | null;
};

export type RsGoodsPreviewState = ActionState & {
  preview?: {
    waybill: { id: string; number: string; date: string | null };
    lines: RsGoodsLineView[];
  };
};
