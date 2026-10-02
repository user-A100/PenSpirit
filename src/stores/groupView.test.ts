import { beforeEach, describe, expect, it } from "vitest";
import { useGroupView } from "./groupView";

describe("组视图模式（每个分屏各记一份）", () => {
  beforeEach(() => {
    localStorage.removeItem("bixian.groupView.preferred");
    useGroupView.setState({ modes: { a: "single", b: "single" }, preferred: "corkboard" });
  });

  it("toggle：切到该模式；已在该模式再按回单章；两个窗格互不影响", () => {
    const g = useGroupView.getState();
    g.toggle("a", "outliner");
    expect(useGroupView.getState().modes).toEqual({ a: "outliner", b: "single" });
    useGroupView.getState().toggle("b", "scrivenings");
    expect(useGroupView.getState().modes).toEqual({ a: "outliner", b: "scrivenings" });
    useGroupView.getState().toggle("a", "outliner");
    expect(useGroupView.getState().modes).toEqual({ a: "single", b: "scrivenings" });
  });

  it("上次用过的组模式即偏好（持久化）；showGroup 只把单章窗格切到偏好模式", () => {
    useGroupView.getState().setMode("a", "outliner");
    expect(useGroupView.getState().preferred).toBe("outliner");
    expect(localStorage.getItem("bixian.groupView.preferred")).toBe("outliner");
    useGroupView.getState().setMode("a", "single");
    expect(useGroupView.getState().preferred).toBe("outliner");
    useGroupView.getState().showGroup("b");
    expect(useGroupView.getState().modes.b).toBe("outliner");
    // 已在组模式的窗格不被改写
    useGroupView.getState().setMode("a", "scrivenings");
    useGroupView.getState().showGroup("a");
    expect(useGroupView.getState().modes.a).toBe("scrivenings");
  });
});
