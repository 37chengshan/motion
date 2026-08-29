/**
 * 时间窗口纯函数单元测试（Phase 3.6）
 * 覆盖：morning/evening 窗口边界、时区换算、非法日期
 * 背景：冒烟时曾因用未来日期导致窗口过滤 0 条，这里固化窗口计算为回归测试
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { windowFor, windowForEdition } from "./daily-research.ts";

test("windowFor：morning 窗口 = 前日08:00 → 当日08:00 (Asia/Shanghai)", () => {
  const w = windowFor("2026-08-29", "Asia/Shanghai");
  // 2026-08-29 08:00 CST = 2026-08-29 00:00 UTC；since = until - 24h
  assert.equal(w.since, "2026-08-28T00:00:00.000Z");
  assert.equal(w.until, "2026-08-29T00:00:00.000Z");
  assert.equal(w.business_date, "2026-08-29");
});

test("windowForEdition：evening 窗口 = 当日06:00 → 17:30 (Asia/Shanghai)", () => {
  const w = windowForEdition("2026-08-29", "Asia/Shanghai", "evening");
  // 2026-08-29 06:00 CST = 2026-08-28 22:00 UTC；17:30 CST = 09:30 UTC
  assert.equal(w.since, "2026-08-28T22:00:00.000Z");
  assert.equal(w.until, "2026-08-29T09:30:00.000Z");
});

test("windowForEdition：morning 与 windowFor 一致", () => {
  const a = windowFor("2026-08-29", "Asia/Shanghai");
  const b = windowForEdition("2026-08-29", "Asia/Shanghai", "morning");
  assert.deepEqual(a, b);
});

test("windowFor：非法日期抛错", () => {
  assert.throws(() => windowFor("not-a-date", "Asia/Shanghai"));
  assert.throws(() => windowFor("2026/08/29", "Asia/Shanghai"));
  assert.throws(() => windowFor("20260829", "Asia/Shanghai"));
});

test("窗口一致性：条目在 since..until 内保留，越界剔除", () => {
  const w = windowFor("2026-08-29", "Asia/Shanghai");
  // 窗口 = 08-28 00:00Z .. 08-29 00:00Z
  const inWin = "2026-08-28T10:00:00.000Z";
  const tooOld = "2026-08-27T10:00:00.000Z";
  const tooNew = "2026-08-29T06:00:00.000Z";
  assert.ok(inWin >= w.since && inWin <= w.until);
  assert.ok(tooOld < w.since);
  assert.ok(tooNew > w.until);
});
