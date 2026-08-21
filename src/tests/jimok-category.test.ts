import { describe, expect, it } from "vitest";
import { jimokToCategory } from "../lib/integrations/vworld";

describe("jimokToCategory", () => {
  it("keeps buildable, farmland and forest classification consistent", () => {
    expect(jimokToCategory("대")).toBe("buildable");
    expect(jimokToCategory("잡종지")).toBe("buildable");
    expect(jimokToCategory("전")).toBe("farmland");
    expect(jimokToCategory("답")).toBe("farmland");
    expect(jimokToCategory("임야")).toBe("forest");
  });

  it("returns other for an unknown or missing land category", () => {
    expect(jimokToCategory("구거")).toBe("other");
    expect(jimokToCategory("")).toBe("other");
  });
});
