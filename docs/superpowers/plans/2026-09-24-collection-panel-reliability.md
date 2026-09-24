# Collection Panel Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make refresh, switching collections, and repeated member actions display the latest confirmed collection state without stale-request overwrites.

**Architecture:** Keep collection membership loading in one effect keyed by book, expanded collection, and refresh generation. Cancel obsolete responses in the effect cleanup. Serialize member writes in the panel and refetch once after each successful write; leave failed writes visually unchanged.

**Tech Stack:** React 19, TypeScript, Zustand, Tauri invoke API, Vitest, Testing Library.

**Spec:** `docs/superpowers/plans/2026-09-23-ordered-collections.md` plus the observed review findings documented below: the refresh button currently reloads only `collectionsList`; `toggle()` and member actions each write `members` asynchronously without checking whether the expanded collection changed.

## Global Constraints

- Preserve manual collection order and saved-search binder order.
- Do not change SQLite schema or the `collection_reorder` command.
- Preserve unrelated uncommitted workspace changes.
- Keep this plan independent of the future collection-scoped structure-view work in `docs/superpowers/plans/2026-09-24-collection-scoped-structure.md`.

---

### Task 1: Refresh and latest-selection-only loading

**Files:**
- Modify: `src/components/collections/CollectionsDockPanel.tsx:1-57`
- Test: `src/components/collections/CollectionsDockPanel.test.tsx`

**Interfaces:**
- Consumes: `api.collectionChapters(collectionId: number): Promise<ChapterMeta[]>`, `currentBookId`, `expanded`, `reload`.
- Produces: an effect that sets `members` only while its `(book, collection, reload)` request remains current; `toggle(id)` changes selection only.

- [ ] **Step 1: Write a failing refresh test**

```tsx
const load = api.collectionChapters as ReturnType<typeof vi.fn>;
load.mockResolvedValueOnce(MEMBERS).mockResolvedValueOnce([MEMBERS[1]]);
render(<CollectionsDockPanel />);
fireEvent.click(await screen.findByText("风雪"));
await screen.findByText("第一章");
fireEvent.click(screen.getByTitle("刷新（搜索集合成员随正文实时变化）"));
await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
await waitFor(() => expect(screen.queryByText("第一章")).not.toBeInTheDocument());
expect(screen.getByText("第二章")).toBeInTheDocument();
```

- [ ] **Step 2: Run the focused test and observe the stale member list**

Run: `npx vitest run src/components/collections/CollectionsDockPanel.test.tsx`. Expected: the new refresh test fails because `reload` is not a membership-load dependency.

- [ ] **Step 3: Move membership loading into a cancelable effect**

```tsx
useEffect(() => {
  if (currentBookId == null || expanded == null) {
    setMembers(null);
    return;
  }
  let cancelled = false;
  setMembers(null);
  api.collectionChapters(expanded)
    .then((next) => { if (!cancelled) setMembers(next); })
    .catch((error) => { if (!cancelled) setMsg(String(error)); });
  return () => { cancelled = true; };
}, [currentBookId, expanded, reload]);
```

Make `toggle(id)` only call `setExpanded(expanded === id ? null : id)`; remove the direct `setMembers(await api.collectionChapters(col.id))` calls after successful member writes and increment `reload` instead. A failed read must show an error, not falsely render an empty collection.

- [ ] **Step 4: Add a deferred-response switching test and rerun**

```tsx
let resolveFirst!: (value: ChapterMeta[]) => void;
const first = new Promise<ChapterMeta[]>((resolve) => { resolveFirst = resolve; });
(api.collectionChapters as ReturnType<typeof vi.fn>)
  .mockReturnValueOnce(first)
  .mockResolvedValueOnce([MEMBERS[1]]);
render(<CollectionsDockPanel />);
fireEvent.click(await screen.findByText("精选"));
fireEvent.click(screen.getByText("风雪"));
await screen.findByText("第二章");
resolveFirst([MEMBERS[0]]);
await waitFor(() => expect(screen.queryByText("第一章")).not.toBeInTheDocument());
```

Run: `npx vitest run src/components/collections/CollectionsDockPanel.test.tsx`. Expected: both new tests pass.

- [ ] **Step 5: Commit only this task's implementation and tests**

```bash
git add src/components/collections/CollectionsDockPanel.tsx src/components/collections/CollectionsDockPanel.test.tsx
git commit -m "fix: keep collection panel membership refresh current"
```

### Task 2: Serialize member mutations and test the reorder controls

**Files:**
- Modify: `src/components/collections/CollectionsDockPanel.tsx:88-120,180-310`
- Modify: `src/components/collections/CollectionsDockPanel.test.tsx:1-130`

**Interfaces:**
- Consumes: `api.collectionAddChapters`, `api.collectionRemoveChapter`, `api.collectionReorder`, and Task 1's `reload` effect.
- Produces: a single-flight member-write path; `Row` receives `busy: boolean` and disables add/remove/move buttons while a write is pending.

- [ ] **Step 1: Add the missing reorder mock and failing tests**

```tsx
// Add to vi.mock("../../lib/tauri").api:
collectionReorder: vi.fn(),

// After expanding manual collection:
(api.collectionReorder as ReturnType<typeof vi.fn>).mockResolvedValue([12, 11]);
fireEvent.click(screen.getByTitle("下移「第一章」"));
await waitFor(() => expect(api.collectionReorder).toHaveBeenCalledWith(1, [12, 11]));
```

Also test that the first up button and last down button are disabled, search-collection rows have no move buttons, a rejected reorder preserves the visible list and shows an error, and a second click during a pending reorder does not send a second write.

```tsx
expect(screen.getByTitle("上移「第一章」")).toBeDisabled();
expect(screen.getByTitle("下移「第二章」")).toBeDisabled();
const pending = new Promise<number[]>((resolve) => { resolveReorder = resolve; });
(api.collectionReorder as ReturnType<typeof vi.fn>).mockReturnValue(pending);
fireEvent.click(screen.getByTitle("下移「第一章」"));
fireEvent.click(screen.getByTitle("下移「第一章」"));
expect(api.collectionReorder).toHaveBeenCalledTimes(1);
resolveReorder([12, 11]);
```

Declare `let resolveReorder!: (ids: number[]) => void` in that test before constructing `pending`. In a separate test, mock `collectionReorder` with `mockRejectedValue(new Error("写入失败"))`, click down, then assert the chapter titles remain in their original order and the error text appears. Open the saved collection and assert `queryByTitle("下移「第一章」")` is null.

- [ ] **Step 2: Run the focused test to verify the new cases fail**

Run: `npx vitest run src/components/collections/CollectionsDockPanel.test.tsx`. Expected: the rapid-click and failure-state cases fail against the current unsynchronized `moveMember()`.

- [ ] **Step 3: Gate every member write synchronously**

```tsx
const busyRef = useRef(false);
const [busy, setBusy] = useState(false);
const writeMember = async (action: () => Promise<unknown>) => {
  if (busyRef.current) return;
  busyRef.current = true;
  setBusy(true);
  try {
    await action();
    setMsg(null);
    setReload((value) => value + 1);
  } catch (error) {
    setMsg(String(error));
  } finally {
    busyRef.current = false;
    setBusy(false);
  }
};
```

Route `addCurrent`, `removeMember`, and `moveMember` through `writeMember`. Pass `busy` to `Row`; apply `disabled={busy || edgeCondition}` to member controls. The ref prevents a second call before React rerenders; the state supplies visible disabled feedback.

- [ ] **Step 4: Verify focused and full frontend suites**

Run: `npx vitest run src/components/collections/CollectionsDockPanel.test.tsx`, `npm test`, then `npm run build`. Expected: all pass.

- [ ] **Step 5: Commit only this task's implementation and tests**

```bash
git add src/components/collections/CollectionsDockPanel.tsx src/components/collections/CollectionsDockPanel.test.tsx
git commit -m "fix: serialize collection member actions"
```

## Self-review

Task 1 covers refresh and stale reads; Task 2 covers competing writes, boundary controls, failure behavior, and the missing `collectionReorder` mock. The separate scope-view plan covers the architectural gap. The local research report `docs/scrivener-logic-study.md` is currently untracked and is deliberately excluded from this plan's Git changes; reconcile its obsolete §8.3 when that report is intentionally added to the repository.
