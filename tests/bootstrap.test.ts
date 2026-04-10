import { describe, expect, it } from "vitest";
import * as extension from "../src/extension";

describe("bootstrap extension exports", () => {
  it("exports activate and deactivate", () => {
    expect(typeof extension.activate).toBe("function");
    expect(typeof extension.deactivate).toBe("function");
  });
});
