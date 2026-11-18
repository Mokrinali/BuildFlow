// Georgian UI strings. Keep user-facing text here so it stays consistent.
import type {
  Currency,
  OrderStatus,
  OrgRole,
  Priority,
  ProjectRole,
  ProjectStatus,
  RequestStatus,
} from "@/generated/prisma/enums";

export const orgRoleLabel: Record<OrgRole, string> = {
  ADMIN: "ადმინისტრატორი",
  MEMBER: "წევრი",
};

export const projectRoleLabel: Record<ProjectRole, string> = {
  REQUESTER: "მომთხოვნი",
  BUYER: "შემსყიდველი",
  RECEIVER: "მიმღები",
};

export const projectStatusLabel: Record<ProjectStatus, string> = {
  ACTIVE: "აქტიური",
  ARCHIVED: "არქივირებული",
};

export const requestStatusLabel: Record<RequestStatus, string> = {
  DRAFT: "მონახაზი",
  IN_REVIEW: "განხილვაში",
  APPROVED: "დამტკიცებული",
  REJECTED: "უარყოფილი",
  PARTIALLY_ORDERED: "ნაწილობრივ შეკვეთილი",
  ORDERED: "შეკვეთილი",
  PARTIALLY_RECEIVED: "ნაწილობრივ მიღებული",
  AWAITING_WAYBILL: "მიღებული, ზედნადები აკლია",
  RECEIVED: "მიღებული",
  CANCELLED: "გაუქმებული",
};

export const priorityLabel: Record<Priority, string> = {
  LOW: "დაბალი",
  NORMAL: "ჩვეულებრივი",
  HIGH: "მაღალი",
  URGENT: "სასწრაფო",
};

export const errors = {
  unauthenticated: "გთხოვთ, გაიაროთ ავტორიზაცია.",
  forbidden: "ამ მოქმედების უფლება არ გაქვთ.",
  notFound: "ჩანაწერი ვერ მოიძებნა.",
  projectArchived: "პროექტი არქივირებულია და მისი შეცვლა შეუძლებელია.",
  projectNameTaken: "ამ სახელით პროექტი უკვე არსებობს.",
  emailTaken: "ამ ელფოსტით მომხმარებელი უკვე არსებობს.",
  memberExists: "მომხმარებელი უკვე ამ პროექტის წევრია.",
  rolesRequired: "აირჩიეთ მინიმუმ ერთი როლი.",
  userOtherOrg: "მომხმარებელი სხვა ორგანიზაციას ეკუთვნის.",
  invalidInput: "შეამოწმეთ შევსებული ველები.",
  unexpected: "მოხდა მოულოდნელი შეცდომა. სცადეთ თავიდან.",
  loginFailed: "ელფოსტა ან პაროლი არასწორია.",
  loginMissing: "შეიყვანეთ ელფოსტა და პაროლი.",
  tooManyAttempts: "ძალიან ბევრი მცდელობა. სცადეთ ერთ წუთში.",
  requestChanged:
    "მოთხოვნა შეიცვალა მას შემდეგ, რაც გვერდი გახსენით. განაახლეთ გვერდი და გადახედეთ ხელახლა.",
  staleStatus: "მოთხოვნის სტატუსი სხვა მომხმარებელმა უკვე შეცვალა. განაახლეთ გვერდი.",
  requestNotEditable: "მოთხოვნის შეცვლა შესაძლებელია მხოლოდ მონახაზის სტატუსში.",
  requestNoItems: "დაამატეთ მინიმუმ ერთი პოზიცია.",
  requestHasOrders: "მოთხოვნას აქტიური შეკვეთები აქვს. ჯერ შეკვეთები გააუქმეთ.",
  requestHasReceipts: "მიღების მქონე მოთხოვნის გაუქმება შეუძლებელია.",
  reasonRequired: "მიუთითეთ მიზეზი.",
  desiredDatePast: "სასურველი თარიღი წარსულშია.",
  requestHasAnyOrders:
    "მოთხოვნას შეკვეთები აქვს (გაუქმებულის ჩათვლით), ამიტომ მისი ხელახლა გახსნა შეუძლებელია.",
  requestNotOrderable: "შეკვეთის გაფორმება შესაძლებელია მხოლოდ დამტკიცებულ მოთხოვნაზე.",
  orderNoItems: "მიუთითეთ მინიმუმ ერთი პოზიცია დადებითი რაოდენობით.",
  orderDuplicateItem: "ერთი პოზიცია შეკვეთაში ორჯერ არის მითითებული.",
  orderItemForeign: "პოზიცია ამ მოთხოვნას არ ეკუთვნის.",
  overOrder: "შეკვეთილი რაოდენობა აჭარბებს დამტკიცებულს.",
  supplierRequired: "აირჩიეთ ან შეიყვანეთ მომწოდებელი.",
  orderNotActive: "შეკვეთა გაუქმებულია.",
  orderHasReceipts: "მიღების მქონე შეკვეთის გაუქმება შეუძლებელია.",
  receiptNoItems: "მიუთითეთ მინიმუმ ერთი მიღებული რაოდენობა.",
  receiptItemForeign: "პოზიცია ამ შეკვეთას არ ეკუთვნის.",
  overReceipt: "მიღებული რაოდენობა აჭარბებს შეკვეთილს.",
  receiptDateFuture: "მიღების თარიღი მომავალშია.",
  receiptBeforeOrder: "მიღების თარიღი შეკვეთის გაფორმებამდეა.",
  controlCharacters: "ტექსტი შეიცავს დაუშვებელ სიმბოლოს.",
  correctionSame: "ახალი რაოდენობა ემთხვევა მიმდინარეს.",
  correctionNegative: "შესწორების შემდეგ მიღებული რაოდენობა უარყოფითი გახდება.",
  importRepeat:
    "ეს ტექსტი ამ პროექტში უკვე შემოტანილია. თუ ხელახლა შემოტანა განზრახ გსურთ, მონიშნეთ შესაბამისი ველი.",
  correctionOfCorrection: "შესწორდება მხოლოდ თავდაპირველი მიღების ჩანაწერი.",
  waybillOnCorrection: "ზედნადები ეთითება თავდაპირველ მიღებაზე, არა შესწორებაზე.",
  waybillSame: "ზედნადების მონაცემები არ შეცვლილა.",
  waybillChangeReason: "არსებული ზედნადების შეცვლისთვის მიუთითეთ მიზეზი.",
  taxIdFormat: "საიდენტიფიკაციო კოდი უნდა იყოს 9 ან 11 ციფრი.",
  adjustNotAllowed: "დამტკიცებული რაოდენობის შეცვლა ამ სტატუსში შეუძლებელია.",
  adjustBelowOrdered: "დამტკიცებული რაოდენობა ვერ იქნება შეკვეთილზე ან მიღებულზე ნაკლები.",
  adjustSame: "ახალი რაოდენობა ემთხვევა მიმდინარე დამტკიცებულს.",
  adjustZero: "რაოდენობა უნდა იყოს დადებითი. სრული გაუქმებისთვის გამოიყენეთ „დარჩენილის გაუქმება“.",
  requestItemForeign: "პოზიცია ამ მოთხოვნას არ ეკუთვნის.",
  orderNothingToClose: "შეკვეთაზე დასახური ხაზი აღარ არის: ყველაფერი მიღებულია ან დახურულია.",
  receiptLineClosed: "ეს პოზიცია შეკვეთაში დახურულია. მიღება აღარ ფიქსირდება.",
  correctionClosedIncrease: "დახურულ ხაზზე მიღებული რაოდენობის გაზრდა შეუძლებელია.",
  cancelNotAllowed: "დარჩენილის გაუქმება ამ სტატუსში შეუძლებელია.",
  cancelNothingLeft: "პოზიციაზე გასაუქმებელი დარჩენილი რაოდენობა არ არის.",
  cancelPendingExists: "ამ პოზიციაზე გაუქმების მოთხოვნა უკვე განხილვის მოლოდინშია.",
  cancelNotPending: "გაუქმების მოთხოვნა უკვე გადაწყვეტილია ან გაწვეულია.",
  cancelOwnDecision: "საკუთარ მოთხოვნას ვერ დაადასტურებთ: საჭიროა მეორე მხარე.",
  cancelWrongSide:
    "გაუქმებას ადასტურებს მეორე მხარე: მომთხოვნის მოთხოვნას — შემსყიდველი, შემსყიდველისას — მომთხოვნი.",
} as const;

/** Badge tone per request status (always shown together with the text label). */
export const requestStatusTone: Record<
  RequestStatus,
  "gray" | "navy" | "green" | "red" | "orange"
> = {
  DRAFT: "gray",
  IN_REVIEW: "navy",
  APPROVED: "green",
  REJECTED: "red",
  PARTIALLY_ORDERED: "orange",
  ORDERED: "navy",
  PARTIALLY_RECEIVED: "orange",
  AWAITING_WAYBILL: "orange",
  RECEIVED: "green",
  CANCELLED: "gray",
};

export const requestEventLabel: Record<string, string> = {
  "request.created": "მოთხოვნა შეიქმნა",
  "request.updated": "მოთხოვნა შეიცვალა",
  "request.submitted": "გაიგზავნა განსახილველად",
  "request.withdrawn": "განხილვიდან დაბრუნდა მონახაზში",
  "request.approved": "დამტკიცდა",
  "request.rejected": "უარყოფილია",
  "request.returned_to_draft": "დაბრუნდა მონახაზში",
  "request.reopened": "ხელახლა გაიხსნა შესაცვლელად",
  "request.cancelled": "გაუქმდა",
  "request.imported": "მოთხოვნა შეიქმნა WhatsApp ტექსტიდან",
  "request.status_changed": "სტატუსი შეიცვალა",
  "request.item_adjusted": "დამტკიცებული რაოდენობა შეიცვალა",
  "request.cancel_requested": "მოთხოვნილია დარჩენილის გაუქმება",
  "request.cancel_confirmed": "დარჩენილის გაუქმება დადასტურდა",
  "request.cancel_rejected": "დარჩენილის გაუქმება უარყოფილია",
  "request.cancel_withdrawn": "დარჩენილის გაუქმების მოთხოვნა გაწვეულია",
};

export const orderStatusLabel: Record<OrderStatus, string> = {
  ACTIVE: "აქტიური",
  CANCELLED: "გაუქმებული",
};

export const currencyLabel: Record<Currency, string> = {
  GEL: "ლარი (GEL)",
  USD: "დოლარი (USD)",
  EUR: "ევრო (EUR)",
};

/** Delivery progress of an order (derived from received vs ordered quantities). */
export type DeliveryState =
  "CANCELLED" | "AWAITING" | "PARTIAL" | "WAYBILL_MISSING" | "RECEIVED" | "CLOSED";

export const deliveryStateLabel: Record<DeliveryState, string> = {
  CANCELLED: "გაუქმებული",
  AWAITING: "მოსალოდნელი",
  PARTIAL: "ნაწილობრივ მიღებული",
  RECEIVED: "მიღებული",
  CLOSED: "დახურული (ნაწილობრივ)",
  WAYBILL_MISSING: "მიღებული, ზედნადები აკლია",
};

export const deliveryStateTone: Record<DeliveryState, "gray" | "navy" | "green" | "orange"> = {
  CANCELLED: "gray",
  AWAITING: "navy",
  PARTIAL: "orange",
  RECEIVED: "green",
  CLOSED: "gray",
  WAYBILL_MISSING: "orange",
};

export const orderEventLabel: Record<string, string> = {
  "order.created": "შეკვეთა გაფორმდა",
  "order.cancelled": "შეკვეთა გაუქმდა",
  "order.closed": "შეკვეთა დაიხურა ნაკლები რაოდენობით",
  "receipt.created": "მიწოდება დაფიქსირდა",
  "receipt.corrected": "მიღება შესწორდა",
  "receipt.waybill_set": "ზედნადები მიეთითა",
  "receipt.waybill_changed": "ზედნადები შეიცვალა",
  "supplier.tax_id_set": "მომწოდებლის საიდენტიფიკაციო კოდი მიეთითა",
  "supplier.created": "მომწოდებელი დაემატა",
};

/**
 * Georgian label for an audit action. `extra` adds page-specific labels (e.g. projects).
 * An unknown action shows a neutral Georgian word, never the raw English key.
 */
export function eventLabel(action: string, extra: Record<string, string> = {}): string {
  return extra[action] ?? requestEventLabel[action] ?? orderEventLabel[action] ?? "ცვლილება";
}
