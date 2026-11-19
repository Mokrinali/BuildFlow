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
