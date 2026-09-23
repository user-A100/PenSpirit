# Ordered Manual Collections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give manual collections their own persistent chapter order, independently of the book's chapter order.

**Architecture:** Add a position to the membership table and migrate existing memberships in their current binder order. The repository owns order validation and atomic writes; commands expose it; the dock panel provides move-up/down controls. Saved-search collections retain binder order.

**Tech Stack:** Tauri/Rust, rusqlite/SQLite, React/TypeScript, Cargo tests, Vitest.

**Spec:** `docs/scrivener-logic-study.md` (P0: ordered manual collections). This is one independently testable P0 slice; stable IDs, hierarchy and scoped view state require separate plans.

## Global Constraints

- Preserve existing books, chapters, memberships, and saved-search semantics.
- Do not add packages or rewrite unrelated components.
- Do not commit while the shared worktree contains unrelated user changes.

---

### Task 1: Persistent independent order

**Files:**
- Create: `src-tauri/migrations/0018_ordered_collections.sql`
- Modify: `src-tauri/src/db.rs`, `src-tauri/src/repo/collections.rs`, `src-tauri/src/commands.rs`
- Test: `src-tauri/tests/collections_test.rs`

**Interfaces:**
- Consumes: existing `Collection`, `AppState`, `repo::collections::chapter_ids`.
- Produces: `collection_reorder_inner(s: &AppState, collection_id: i64, chapter_ids: &[i64]) -> AppResult<Vec<i64>>`.

- [x] **Step 1: Write the failing tests**

```rust
let ids = cmd::collection_add_chapters_inner(&s, col.id, &[c3, c1, c2]).unwrap();
assert_eq!(ids, vec![c3, c1, c2]);
assert_eq!(cmd::collection_reorder_inner(&s, col.id, &[c1, c2, c3]).unwrap(), vec![c1, c2, c3]);
assert_eq!(cmd::list_chapters_inner(&s, b1.id).unwrap().iter().map(|c| c.id).collect::<Vec<_>>(), vec![c1, c2, c3]);
assert!(cmd::collection_reorder_inner(&s, col.id, &[c1, c1, c3]).is_err());
```

- [x] **Step 2: Run the targeted test to confirm failure**

Run: `cargo test --test collections_test manual_membership_order_and_cross_book_guard` from `src-tauri`. Expected: old binder-order assertion fails.

- [x] **Step 3: Add migration and repository behavior**

```sql
ALTER TABLE collection_chapters ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
WITH ranked AS (
  SELECT cc.collection_id, cc.chapter_id,
         ROW_NUMBER() OVER (PARTITION BY cc.collection_id ORDER BY c.sort_key, c.id) - 1 AS new_position
  FROM collection_chapters cc JOIN chapters c ON c.id = cc.chapter_id
)
UPDATE collection_chapters SET position = (
  SELECT new_position FROM ranked
  WHERE ranked.collection_id = collection_chapters.collection_id
    AND ranked.chapter_id = collection_chapters.chapter_id
);
```

Append new members at `MAX(position)+1`; return IDs by position; reorder in a transaction after exact-membership validation. Preserve hidden soft-deleted members' slots when reordering visible members.

- [x] **Step 4: Run the Rust collection tests**

Run: `cargo test --test collections_test` from `src-tauri`. Expected: all tests pass.

### Task 2: Expose order in the dock panel

**Files:**
- Modify: `src-tauri/src/lib.rs`, `src/lib/tauri.ts`, `src/components/collections/CollectionsDockPanel.tsx`
- Test: `src-tauri/tests/collections_test.rs`

**Interfaces:**
- Consumes: `collection_reorder_inner` from Task 1.
- Produces: Tauri command `collection_reorder(collection_id: i64, chapter_ids: Vec<i64>) -> AppResult<Vec<i64>>`; TypeScript `api.collectionReorder(collectionId: number, chapterIds: number[]): Promise<number[]>`.

- [x] **Step 1: Add command-level validation test**

```rust
assert!(cmd::collection_reorder_inner(&s, saved.id, &[c1]).is_err());
```

- [x] **Step 2: Confirm the new test fails to compile**

Run: `cargo test --test collections_test` from `src-tauri`. Expected: missing `collection_reorder_inner`.

- [x] **Step 3: Add command, TS bridge and accessible up/down buttons**

```tsx
<button title={`上移「${m.title}」`} disabled={index === 0}
  onClick={() => props.onMoveMember!(index, -1)}><ArrowUp size={10} /></button>
```

The panel sends the full visible member ID order and refreshes only on success; failed writes leave the displayed order unchanged and show an error.

- [x] **Step 4: Verify backend and frontend**

Run: `cargo test --test collections_test` from `src-tauri`; `npm run build` and `npm test` from project root. Expected: pass.

## Self-review

The plan covers manual collection migration, insertion, reordering, validation, and UI. Saved-search ordering is intentionally unchanged. Stable IDs, hierarchy and per-scope view state are separate P0 work because they affect other persistence and navigation subsystems.
