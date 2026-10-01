# Collection-Scoped Structure Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open a manual or saved collection as the chapter scope of Corkboard, Outliner, and Scrivenings without accidentally changing the book's chapter order.

**Architecture:** Represent the current structure scope explicitly as either the current book or one collection in that book. The structure workspace resolves one ordered chapter array for the active scope and passes it to the three views. Manual-collection grid/outliner reorder writes `collection_reorder`; saved collections are read-only; book scope retains current reorder and freeform behavior.

**Tech Stack:** React 19, TypeScript, Zustand, Tauri invoke API, Vitest, Testing Library; existing Rust collection commands require no schema change.

**Spec:** `docs/superpowers/plans/2026-09-23-ordered-collections.md` establishes manual collection order. The architectural finding addressed here is that `StructureView`, `Corkboard`, `OutlinerTable`, and `Scrivenings` currently read `useWorkspace().chapters` directly, so a collection cannot be viewed as a structure scope.

## Global Constraints

- One chapter remains one content record; opening a collection does not duplicate text.
- Preserve book-scope reorder, book-scope freeform positions, and saved-search binder order.
- Collection-scope freeform positioning is unavailable until coordinates can be stored per scope; never write collection positions into chapter-global `freeform_x/y`.
- `collection_reorder` must never be called for saved-search collections.
- Numeric IDs in the session-only UI scope are not a substitute for stable UUIDs in future portable project files.
- Preserve unrelated uncommitted workspace changes.

---

### Task 1: Select and resolve a structure scope

**Files:**
- Create: `src/stores/structureScope.ts`
- Modify: `src/views/StructureView.tsx`
- Create: `src/views/StructureView.test.tsx`

**Interfaces:**
- Produces: `StructureScope = { kind: "book" } | { kind: "collection"; bookId: number; collectionId: number; name: string; collectionKind: "manual" | "saved" }`.
- Produces: `useStructureScope` with `scope`, `openCollection(bookId, collection)`, and `showBook()`.
- Consumes: `api.collectionChapters(collectionId): Promise<ChapterMeta[]>`, `useWorkspace().chapters`.

- [ ] **Step 1: Write failing scope-state and loading tests**

```tsx
const selected: Collection = { id: 1, book_id: 7, name: "精选", kind: "manual", query: "", created_at: "t", updated_at: "t" };
useStructureScope.getState().openCollection(7, selected);
expect(useStructureScope.getState().scope).toMatchObject({ kind: "collection", bookId: 7, collectionId: 1 });
useStructureScope.getState().showBook();
expect(useStructureScope.getState().scope).toEqual({ kind: "book" });
```

In `StructureView.test.tsx`, mock `api.collectionChapters(1)` to return a pair of chapter fixtures, open collection 1, render `StructureView`, and assert its loading state resolves to a collection count of 2. Switch books and assert scope returns to `{kind: "book"}`. The public opening control and three-view rendering are added together in Task 2.

- [ ] **Step 2: Run the targeted tests and verify they fail**

Run: `npx vitest run src/views/StructureView.test.tsx`. Expected: the structure-scope store and resolver are missing.

- [ ] **Step 3: Add a session-only scope store**

```ts
export type StructureScope =
  | { kind: "book" }
  | { kind: "collection"; bookId: number; collectionId: number; name: string; collectionKind: "manual" | "saved" };

export const useStructureScope = create<{
  scope: StructureScope;
  openCollection: (bookId: number, collection: Collection) => void;
  showBook: () => void;
}>((set) => ({
  scope: { kind: "book" },
  openCollection: (bookId, collection) => set({ scope: {
    kind: "collection", bookId, collectionId: collection.id, name: collection.name,
    collectionKind: collection.kind as "manual" | "saved",
  } }),
  showBook: () => set({ scope: { kind: "book" } }),
}));
```

Show current scope, member count, and a “返回整书” button in `StructureView`. Reset to book scope when `currentBookId` differs from stored `scope.bookId`. Do not expose the collection-opening control until Task 2 also renders the correct collection content.

- [ ] **Step 4: Resolve collection members with stale-request protection**

```tsx
useEffect(() => {
  if (scope.kind !== "collection" || scope.bookId !== currentBookId) return;
  let cancelled = false;
  setCollectionChapters(null);
  api.collectionChapters(scope.collectionId)
    .then((items) => { if (!cancelled) setCollectionChapters(items); })
    .catch((error) => { if (!cancelled) setScopeError(String(error)); });
  return () => { cancelled = true; };
}, [currentBookId, scope]);
```

Book scope uses the already loaded `useWorkspace().chapters`; collection scope loads `collectionChapters` order and member count. An empty collection reports zero members rather than the whole book. Reject stale results after changing book or scope.

- [ ] **Step 5: Verify and commit this vertical slice**

Run: `npx vitest run src/views/StructureView.test.tsx` and `npm run build`. Expected: pass.

```bash
git add src/stores/structureScope.ts src/views/StructureView.tsx src/views/StructureView.test.tsx
git commit -m "feat: model and load structure scopes"
```

### Task 2: Route three views through the resolved scope

**Files:**
- Modify: `src/components/structure/Corkboard.tsx`
- Modify: `src/components/structure/OutlinerTable.tsx`
- Modify: `src/components/structure/Scrivenings.tsx`
- Modify: `src/components/collections/CollectionsDockPanel.tsx`
- Modify: `src/components/collections/CollectionsDockPanel.test.tsx`
- Modify: `src/views/StructureView.tsx`
- Modify: `src/components/structure/structure.test.tsx`

**Interfaces:**
- Consumes: Task 1's `StructureScope` and ordered `ChapterMeta[]`.
- Produces: each view accepts `chapters: ChapterMeta[]`; Corkboard and Outliner also accept `scope: StructureScope` and `onReorder: ((ids: number[]) => Promise<void>) | null`; Scrivenings accepts `scopeKey: string`.

- [ ] **Step 1: Write tests for collection order and mutation boundaries**

```tsx
const MEMBERS: ChapterMeta[] = [
  { id: 11, book_id: 7, title: "第一章", sort_key: 1, file_path: "a.md" } as ChapterMeta,
  { id: 12, book_id: 7, title: "第二章", sort_key: 2, file_path: "b.md" } as ChapterMeta,
];
const reorderCollection = vi.fn().mockResolvedValue(undefined);
render(<OutlinerTable chapters={[MEMBERS[1], MEMBERS[0]]}
  scope={{ kind: "collection", bookId: 7, collectionId: 1, name: "精选", collectionKind: "manual" }}
  onReorder={reorderCollection} />);
expect(screen.getAllByTestId("outliner-row").map((row) => row.textContent)).toEqual([
  expect.stringContaining("第二章"), expect.stringContaining("第一章"),
]);
```

Add `data-testid="outliner-row"` to each rendered row. Drag in manual scope and assert `api.collectionReorder(1, ids)` is called while `useWorkspace().reorderChapters` is not. In saved scope, assert rows/cards cannot be dragged. In collection scope, assert the freeform toggle and “落序” action are unavailable; in book scope, retain existing tests and behavior. Add a panel test that clicks `在结构视图打开「精选」`, then asserts `useStructureScope.getState().scope.collectionId === 1` and `useUiNav.getState().activeView === "structure"`.

- [ ] **Step 2: Run the focused tests and verify the old component signatures fail**

Run: `npx vitest run src/components/structure/structure.test.tsx`. Expected: the new props do not affect views because they still read global `useWorkspace().chapters`.

- [ ] **Step 3: Pass explicit data and reorder capability into both sortable views**

```tsx
type SortableStructureProps = {
  chapters: ChapterMeta[];
  scope: StructureScope;
  onReorder: ((ids: number[]) => Promise<void>) | null;
};
```

Add the panel's collection-opening control now that the views can render it. In `StructureView`, use `useWorkspace().reorderChapters` for book scope, a callback that awaits `api.collectionReorder(scope.collectionId, ids)` and refetches members for manual collection scope, and `null` for saved scope. Both `drop()` handlers call `onReorder` only when non-null. Corkboard renders freeform controls only for book scope; switching from book freeform to a collection displays its grid without mutating the saved book-mode preference.

- [ ] **Step 4: Make Scrivenings react to scope and order changes**

```tsx
const idsKey = chapters.map((chapter) => chapter.id).join(",");
useEffect(() => {
  if (chapters.length === 0) { setDocs([]); return; }
  let cancelled = false;
  setDocs(null);
  Promise.all(chapters.map((chapter) => api.readChapter(chapter.id)))
    .then((items) => { if (!cancelled) setDocs(items); })
    .catch((error) => { if (!cancelled) setError(String(error)); });
  return () => { cancelled = true; };
}, [scopeKey, idsKey]);
```

Use `scopeKey = "book:" + currentBookId` or `"collection:" + scope.collectionId`; a same-length reorder must reload/reorder the rendered documents. Add a test that changes `[11,12]` to `[12,11]` and asserts the displayed order changes.

- [ ] **Step 5: Verify and commit the completed scoped views**

Run: `npx vitest run src/components/structure/structure.test.tsx src/views/StructureView.test.tsx`, `npm test`, and `npm run build`. Expected: all pass.

```bash
git add src/components/collections/CollectionsDockPanel.tsx src/components/collections/CollectionsDockPanel.test.tsx src/components/structure/Corkboard.tsx src/components/structure/OutlinerTable.tsx src/components/structure/Scrivenings.tsx src/components/structure/structure.test.tsx src/views/StructureView.tsx src/views/StructureView.test.tsx
git commit -m "feat: render structure views from collection scope"
```

## Self-review

This plan covers collection opening, three-view data flow, manual-vs-saved mutation rules, stale-load handling, and the Scrivenings same-length reorder bug. It does not claim to implement persistent per-scope view state, collection-specific freeform coordinates, stable UUIDs, a hierarchy, or “apply collection order to book” (which requires explicit full-book validation and undo semantics). Those are distinct follow-up designs; the present feature is independently usable without risking binder order.
