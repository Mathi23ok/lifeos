# Financial commitments

Finance now has a commitments workspace alongside its existing expenses, income streams and budgets. It uses Toman and Tehran dates. Existing ledger periods and categories are preserved; no SQL schema migration is required.

## Payment plans

- **Recurring payment:** fixed amount per occurrence; daily, weekly, monthly or yearly, with an interval of 1–12 periods. A count and last date are optional. Mark an optional subscription explicitly if a period may be skipped.
- **Installments:** the full amount to repay, including any agreed charges, and a finite payment count. The total is divided into integer Toman amounts, with the rounding remainder in the last payment.
- **Debt:** the same finite repayment model; use one payment for a single due or several for a repayment schedule. Debt and installment schedules cannot be cancelled to erase amounts owed.

Plans have a name, payee/creditor, notes, first due date and recurrence. Terms remain fixed after creation, so changing a schedule cannot rewrite historical amounts. For a recurring payment with new terms, stop future dues and create its replacement. Stopping a recurring plan retains earlier dues and all saved decisions. An end date cannot truncate a finite debt schedule.

## Generated dues and statuses

The backend derives due occurrences when Finance or Calendar loads a date range. No cron job or placeholder expenses are needed. Occurrence identities are stable (`plan UUID:index`); refreshes cannot create duplicate dues. Monthly/yearly dates are anchored to the first due day and clamp to the end of shorter months (31 January → 28/29 February → 31 March).

| Stored status | Meaning |
| --- | --- |
| Pending | Payable; becomes overdue after the original due date. |
| Paid | Linked to a specific expense in an explicitly selected ledger period. |
| Rejected, optional subscription | That occurrence is skipped, excluded from remaining commitments and Calendar. Later occurrences remain scheduled. |
| Rejected, required payment/debt/installment | Deferred, still payable; becomes overdue after the original due date. The due date and amount do not change. |

An occurrence may be restored from rejected to pending. Paid occurrences must be undone before status changes. There are no bank transfers, automatic debits, interest calculations or background notification deliveries.

## Recording and undoing payments

Choose either **Create a new expense**, with the period's category, or **Link an existing expense**, with the exact due amount. An expense can pay only one occurrence. This version records full occurrence payments; use an installment schedule to split a debt. A payment date may be today or earlier; a future due can be paid early.

The payment decision and the expense are committed in one MySQL transaction. Revision checks cover the commitments document and both ledger documents after their rows are locked. Retried/double submissions cannot append a second expense to an already paid occurrence.

Undo atomically returns the due to pending. An unchanged expense created by that payment is removed. A preexisting expense that was merely linked, or an expense edited since payment, is retained and unlinked. Expense editing/deletion through the normal Finance controls is guarded while linked to a paid occurrence. “View expense” selects its period and highlights the transaction.

Bulk reset/import can replace expenses. If a linked expense disappears or its amount no longer matches, the commitment is shown as needing reconciliation and counted as unpaid. Undo the stale payment, review the retained expense if present, then record/link the correct payment. Payment changes have an audit history.

## Dashboard and Calendar

The due-month picker uses **Gregorian months**, independently of imported/custom ledger period names. Payment entry always asks for the destination ledger period instead of guessing from its name.

- **Commitments:** all due amounts in the selected month, minus optional skips.
- **Paid:** those monthly dues with a valid linked expense, regardless of which ledger period holds it.
- **Remaining:** monthly commitments minus verified paid amounts; includes required rejections.
- **Optional skips:** excluded monthly amounts, shown separately.
- **Earlier unpaid dues:** outstanding dues before the selected month, separately from monthly totals. For future selected months this includes earlier obligations that may not yet be overdue today.
- **Overdue this month:** unpaid monthly dues dated before today. Today is not overdue until the next Tehran date.

Each debt or installment plan also shows its verified payment count, repaid amount and balance across the full schedule, including future installments.

Calendar has a Financial commitments filter alongside board filters. It loads generated dues for its 42-day month grid and earlier unpaid dues. Paid entries follow the existing include-completed switch; optional skips are omitted. Clicking a due opens Finance at its month and occurrence. A Finance loading failure is explicit and does not silently hide obligations while claiming there are no dues.

## Architecture

- `lib/obligations.php`: validation, recurrence, integer repayment allocation, summaries and atomic payment mutations.
- `finance-obligations.php`: authenticated session API. `GET ?start=YYYY-MM-DD&end=YYYY-MM-DD` returns plans, generated dues, totals and recent history; `GET ?occurrence=ID` resolves a single due. POST uses the shared session CSRF token, expected revisions and an action (`create`, `cancel`, `pay`, `undo`, `reject`, `restore`).
- `edi_obligations_v1`: separate `app_state` document with `version`, `plans[]`, `decisions[occurrenceId]` and `history[]`. It is read through shared storage but can be changed only through the commitments service, not generic state PUTs.
- `appStorage.mutateItems`: sequences multi-document backend mutations with ordinary saves and adopts all returned revisions/data together. Finance adopts those records without resaving an old in-memory copy.
- `daramd_periods_v1` remains the primary ledger; `daramd_v1` remains its active-period compatibility mirror. Existing source metadata is preserved.

This adds no dedicated MCP tool; existing Finance integrations see payment expenses through the existing expense API. The session endpoint is not a bearer-token endpoint. Deploy the endpoint, library, StateStore changes, storage bridge, Finance assets, Calendar assets and navigation together.
