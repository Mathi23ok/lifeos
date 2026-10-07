# Personal growth workspace

Growth adds a planning and review layer over the existing Goals, Habittify and Kanban workspaces. It does not copy or rewrite their records, automatically categorize private data, or alter finance history.

## Getting started

1. Open **Growth** from the navigation or the six-dimension summary in Overview.
2. Choose a dimension and add a long-term goal: title, reason and optional target date.
3. Search and select existing SMART goals, daily habits and individual tasks. Linked SMART goals bring their checklist items into the dimension automatically.
4. Open a linked goal or task to update it in its original workspace. Manage habits in Habittify. Create SMART goals with the existing Goals wizard and then connect them.
5. Complete a weekly, monthly or quarterly review. Record a reflection and a concrete next step for each dimension. The previous next step is shown during your next review.

The six fixed dimensions are Religion & Spirituality, Health, Relationships & Family, Finance, Self Growth, and Fun & Rest. A goal may support multiple dimensions through explicit connections. Within a dimension, repeated references count once.

Long-term goals can be active, achieved or archived. Archived plans remain editable and keep their connections, but do not contribute to dimension indicators. An achieved plan stays visible and contributes until archived; it does not force its underlying SMART goals or tasks to complete.

## Progress definitions

- **SMART progress:** average of linked, non-archived goals that have usable measurements. Each goal averages recorded measure ratios (current / positive target, clamped to 0–100%) and task completion, equally if both exist. Measures with an unknown current value are excluded. A goal with neither usable measures nor tasks is unmeasured, rather than assumed complete or zero.
- **Habit consistency:** completions divided by eligible daily opportunities across the most recent seven Tehran dates, including today. Days before a habit's creation are excluded. Habittify currently treats active habits as daily. Unavailable habit data is shown explicitly and does not erase saved connections.
- **Tasks:** explicitly linked Kanban cards or goal tasks, plus tasks belonging to linked SMART goals. Scoped goal/task IDs prevent checklist collisions. Cards use their stable ID so a cross-project move retains the link; current board location is resolved each time. Cards marked completed or in a Done, Complete or Completed list count as done, matching Calendar.
- Missing/deleted source records and inactive habits are excluded from calculations; connections remain visible in the editor for deliberate unlinking. Archived goals are excluded without removing their saved references.

These indicators are not a wellbeing score. No composite life percentage is invented. A dimension without measured goals shows an empty measurement state.

## Reviews

Life Review is an eight-step flow: choose a cadence, reflect on each of the six dimensions, then edit the final summary before saving. Each dimension shows its connected progress and previous next step. Back/Continue and the step navigation retain input. Closing the modal keeps the draft in memory while the Growth page remains open; reloading or navigating away from that page discards the unsaved draft. Only the final Save review action writes a review. The layout uses a sidebar on desktop and compact step markers on mobile.

Reviews store the Tehran date, cadence, reflection and next step per dimension, and a numeric snapshot of goal/habit/task indicators at save time. Historical snapshots stay unchanged when source records change. Due dates follow a rolling interval from the latest review of the same cadence: weekly 7 days, monthly 30 days, quarterly 90 days. A cadence without a previous review is due today. There are no background notifications or email reminders.

## Persistence and architecture

`edi_growth_v1` is an authenticated, revision-protected `app_state` document:

```text
version: 1
plans[]: id, dimensionId, title, why, targetDate, status,
         goalIds[], habitIds[], taskKeys[], createdAt, updatedAt
reviews[]: id, cadence, date, createdAt,
           notes[dimensionId]: reflection, next
           snapshot[dimensionId]: goalPct, habitPct, taskPct,
                                  habitAvailable, goals, habits, tasks, done,
                                  completed, eligible
```

Task references are JSON-encoded tuples: `["goal", goalId, taskId]` or `["kanban", cardId]`. Goal and habit IDs are normalized to strings for MySQL/browser compatibility. Additional document properties are preserved on edits.

`assets/growth-model.js` provides shared source resolution and calculations for Growth and Overview. `growth/app.js` owns forms and reviews. Growth writes through the shared storage mutation queue, session authentication, CSRF token and compare-and-swap revisions, and shows success only after the server confirms the write. A form opened before another change must be reopened instead of overwriting it. No SQL schema migration is required.

No dedicated growth endpoint or MCP tool has been added. Existing integration clients continue to edit source goals, habits and tasks, and Growth derives updated indicators on refresh. Deploy the new growth assets together with `state.php`, shared storage, navigation, dashboard and Goals deep-link changes.
