import { describe, it, expect } from "vitest";
import { LogTail } from "./log-tail.ts";

describe("LogTail", () => {
  it("retains only the last N entries in insertion order", () => {
    const tail = new LogTail<number>(3);
    tail.push(1); tail.push(2); tail.push(3); tail.push(4); tail.push(5);
    expect(tail.drain()).toEqual([3, 4, 5]);
  });
  it("returns empty when nothing pushed", () => {
    expect(new LogTail<string>(5).drain()).toEqual([]);
  });
  it("never grows beyond capacity", () => {
    const tail = new LogTail<number>(2);
    for (let i = 0; i < 100; i++) tail.push(i);
    expect(tail.drain()).toEqual([98, 99]);
  });
});
