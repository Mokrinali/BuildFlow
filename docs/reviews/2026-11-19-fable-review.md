# BuildFlow review, 2026-11-19 (Fable 5.2)

Full review of code and tests at commit 25a62b9. No project file was changed during the review.
CONFIRMED means the reviewer ran it (probe test, parser script or mutation); PLAUSIBLE means
found by reading only. All UI findings are PLAUSIBLE; nothing was run in a browser.

## Check results

| Check                    | Result                                    |
| ------------------------ | ----------------------------------------- |
| `npx vitest run`         | 14 files, 250 tests, 250 passed, 0 failed |
| `npx tsc --noEmit`       | exit 0                                    |
| `npx eslint .`           | exit 0                                    |
| `npx prettier --check .` | all files formatted                       |
| `npx next build`         | exit 0, 18 dynamic routes plus the proxy  |

Nothing is Critical.

## High

**H1. Other WhatsApp message headers leak into the item name, spec and desired date.** CONFIRMED

- `src/server/import/parser.ts:72-73`: `WHATSAPP_HEADER` only matches "date, time" at the line start.
- `გიორგი: ცემენტი 20 ტომარა` gives name `გიორგი: ცემენტი`, no flag.
- `[14:05, 19.11.2026] გიორგი: ცემენტი 20 ტომარა` gives name `[, ] გიორგი: ცემენტი` and desired
  date 2026-11-19 (the message date), no flag.
- `[19/11, 14:05] გიორგი: ცემენტი 20 ტომარა` gives spec `19/11`, no flag.
- `[11/19, 2:05 PM] Giorgi: არმატურა 12 მმ 2 ტონა` gives name `[, PM] Giorgi: არმატურა`.
- Fix: also strip `[time, date]` and `[d/m, time]` headers and a bare `Name:` prefix; never take a
  header date as the desired date.

**H2. A request can end CANCELLED while its order stays ACTIVE.** CONFIRMED

- `src/server/requests/service.ts:646-684`, with `src/server/orders/progress.ts:53`.
- A one-item request (25) is fully ordered, nothing received. The requester asks to cancel the
  remainder and the buyer confirms: request CANCELLED, order ACTIVE (delivery "CLOSED", total
  250 GEL in the active list). CLAUDE.md requires active orders to be cancelled first.
- The invariant test at `tests/orders.test.ts:795` covers only `cancelRequest`.
- Fix: cancel orders with nothing received in the same transaction (with an audit event), or
  refuse until the buyer cancels them.

**H3. Enter in a request row input saves and sends the request for review.** PLAUSIBLE

- `src/app/(app)/requests/request-form.tsx:272-277`: the first submit button is
  `intent=submit`, so implicit submission sends a half-finished request to IN_REVIEW.
- Fix: make "მონახაზის შენახვა" the default submit, or swallow Enter in row inputs.

## Medium

- **M1. A pending item cancellation can be confirmed after the request is reopened to DRAFT.**
  CONFIRMED. `src/server/requests/service.ts:597-687` (`decideItemCancellation` has no status
  check). Afterwards the approved request cannot be ordered. Fix: require a cancellable status
  and withdraw pending cancellations on reopen, withdraw or cancel.
- **M2. Order numbers of other projects leak through the shared-waybill hints.** CONFIRMED.
  `src/server/orders/service.ts:546-555` (`alsoOn`), `src/server/rs/service.ts:230-236`
  (`usedOn`). Fix: apply the actor's project-visibility filter.
- **M3. A second material on a line is folded into the first.** CONFIRMED.
  `ცემენტი 3 ტომარა წებო 2` gives one item `ცემენტი წებო`, no flag (`parser.ts:600-634`).
- **M4. Day-only and unsuffixed dates are missed and pollute the item.** CONFIRMED.
  `25-ში მოიტანეთ …`, `დეკემბრის 5-ში …`, trailing `30.11` (`parser.ts:194-262`).
- **M5. "ათასი" is ignored.** CONFIRMED. `აგური 3 ათასი ცალი` gives 3 ცალი.
- **M6. The Georgian validation bubble can block a form permanently.** PLAUSIBLE.
  `src/components/georgian-validation.tsx:39,49-57`; e.g. RS.ge waybill radios: the other radios
  keep their custom error after one is chosen.
- **M7. The order form gets stuck after a concurrent order uses up a line.** PLAUSIBLE.
  `src/app/(app)/orders/new/order-form.tsx:64,254,262`: a disabled but checked line is still sent.
- **M8. Changing one waybill mapping wipes hand-entered received quantities.** PLAUSIBLE.
  `src/app/(app)/orders/[orderId]/order-actions.tsx:170-174`.
- **M9. The RS.ge "date differs" warning is never seen.** PLAUSIBLE.
  `orders/[orderId]/page.tsx:294-296`: the button unmounts with its message.
- **M10. The waybill line match form loses input on a server error.** PLAUSIBLE.
  `orders/[orderId]/rs-goods.tsx:263-266`.
- **M11. The login button stays disabled after a network failure.** PLAUSIBLE.
  `src/app/login/login-form.tsx:35-41`: no try/finally.

## Low

- **L1.** `from=0000-01-01` / `to=0000-01-01` makes `listRequests` and `listOrders` throw.
  CONFIRMED at service level.
- **L2.** `მოიტანეთ ფანერა 12.5 20 ფურცელი` reads 12.5 as a date; the thickness is lost.
  CONFIRMED.
- **L3.** `1.ცემენტი 20 ტომარა` gives spec `1`; `… 15 ლარად` gives name `ცემენტი ლარად`.
  CONFIRMED.
- **L4.** Stale pre-lock reads in waybill writes (`receipts/service.ts:382-409`,
  `rs/service.ts:283-316`, `rs/goods.ts:301-338`). PLAUSIBLE.
- **L5.** RS.ge verification accepts an empty seller code (`rs/service.ts:278`). PLAUSIBLE.
- **L6.** RS.ge response size is unbounded and `processEntities` is on (`rs/soap.ts:54-62,162`).
  PLAUSIBLE; the endpoint is a fixed HTTPS constant, so no SSRF.
- **L7.** The RS.ge rate limit is one counter per organization (`rs/service.ts:128-130`). PLAUSIBLE.
- **L8.** Account lockout can be kept up by anyone who knows an email. Deliberate tradeoff,
  documented in `src/lib/auth.ts`.
- **L9.** An entered tax ID is dropped when the supplier name already exists
  (`orders/service.ts:229-238`). PLAUSIBLE.
- **L10.** Save-and-submit of a draft: on a submit failure only an error shows, though the edit
  was saved (`requests/actions.ts:47-50`). PLAUSIBLE.
- **L11.** Export stops at 20,000 rows with no notice (`orders/service.ts:914,927`). PLAUSIBLE.
- **L12.** Minor UI (PLAUSIBLE): filter selects keep values after "გასუფთავება"; the receive form
  keeps the previous waybill date; the project switcher navigates on every arrow key; factor
  0.0005 displays as 0,001; the users list is squeezed at 360 px; mobile cards omit order note,
  close reason and priority.

Checked and found sound: lock order (request → project → organization, no cycle); auth surface
(sign-up, password reset and profile endpoints disabled); CSV formula guard; import token
binding; RS.ge password encryption; no message or WhatsApp text in logs.

## Test-suite quality

24 mutations were run (one guard removed each, full suite, file restored). 19 were caught,
including over-order and over-receive checks, cross-org and non-member guards, archived
read-only, import signature, rate limits and audit events. Removing `FOR UPDATE` from
`lockRequest` failed 7 tests.

Gaps:

- Self-confirmation of a cancellation (`requests/service.ts:619`): no test with an admin, or an
  author who is also a buyer, confirming their own ask.
- The project `FOR SHARE` lock (`access.ts:46`): no test races an archive against a write.
- `tests/orders.test.ts:803` and `tests/requests.test.ts:409` assert only inside an `if`.
- Many positive paths assert only `resolves.toBeTruthy()`.
- The export route, server actions and pages (`runAction`, `formPayload`, redirects,
  `requireUser` with `mustChangePassword`) are untested.
- No tests for H2, M1, M2, nor parser cases for Web/Android headers, "Name:", "N-ში" or "ათასი".

## Known and still open from the previous review

Year rollover across Dec/Jan in import dates; import review lost after a failed re-preview; NUL
characters in URL filters; dashboard IN_REVIEW/APPROVED tiles vs links; forms not cleared after
success; MemberRow roles form resets on error; "ხვალე"; "კილოვატი" → კგ; focus on "ტექსტის
შეცვლა"; aria on the add-member form; login-limit rows never cleaned; supplier name case race.
Open product decision: allow a receipt dated before the order (with a reason) or keep blocking.
