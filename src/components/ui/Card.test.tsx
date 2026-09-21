import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "./Card";

describe("Card", () => {
  it("默认 raised + md：elevated 底、p-4、token 圆角与边框", () => {
    render(<Card data-testid="c">内容</Card>);
    const c = screen.getByTestId("c");
    expect(c.className).toContain("bg-[var(--bg-elevated)]");
    expect(c.className).toContain("p-4");
    expect(c.className).toContain("rounded-[var(--radius-md)]");
    expect(c.className).toContain("border-[color:var(--border-subtle)]");
  });

  it("flat + sm：无底色、窄内边距", () => {
    render(<Card data-testid="c" variant="flat" pad="sm">内容</Card>);
    const c = screen.getByTestId("c");
    expect(c.className).not.toContain("bg-[var(--bg-elevated)]");
    expect(c.className).toContain("px-3");
    expect(c.className).toContain("py-2.5");
  });

  it("interactive：hover 边框变 accent，带 zen 过渡", () => {
    render(<Card data-testid="c" interactive>内容</Card>);
    const c = screen.getByTestId("c");
    expect(c.className).toContain("hover:border-[color:var(--accent)]");
    expect(c.className).toContain("transition-colors");
    expect(c.className).toContain("duration-[var(--dur-md)]");
  });

  it("selected：accent 边框 + 洗色底，且不再叠加 raised 底", () => {
    render(<Card data-testid="c" selected>内容</Card>);
    const c = screen.getByTestId("c");
    expect(c.className).toContain("border-[color:var(--accent)]");
    expect(c.className).toContain("bg-[var(--accent-dim)]");
    expect(c.className).not.toContain("bg-[var(--bg-elevated)]");
  });

  it("根恒带 group，供卡内操作 group-hover 浮现；透传 data-* 等属性", () => {
    render(<Card data-testid="c">内容</Card>);
    expect(screen.getByTestId("c").className).toContain("group");
  });
});
