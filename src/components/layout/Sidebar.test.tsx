import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sidebar } from "./Sidebar";
import { useWorkspace } from "../../stores/workspace";

describe("Sidebar", () => {
  it("显示书籍与章节", () => {
    useWorkspace.setState({
      books: [{ id: 1, slug: "shu", title: "红楼梦", created_at: "", updated_at: "" }],
      chapters: [{ id: 11, book_id: 1, file_path: "", title: "初见", sort_key: 1, word_count: 0, created_at: "", updated_at: "" }],
      currentBookId: 1,
    });
    render(<Sidebar />);
    expect(screen.getByText("红楼梦")).toBeInTheDocument();
    expect(screen.getByText("初见")).toBeInTheDocument();
  });
});
