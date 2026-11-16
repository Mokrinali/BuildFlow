// Georgian UI strings. Keep user-facing text here so it stays consistent.
import type {
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
  tooManyAttempts: "ძალიან ბევრი მცდელობა. სცადეთ ერთ წუთში.",
} as const;
