/**
 * streams.ts 单一真相源单元测试（Phase 3.6）
 * 运行：npm test  （node --test scripts/）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  streamToCategory,
  isResearchStream,
  STREAM_LABEL,
  NEWS_STREAMS,
  ALL_STREAMS,
} from "../src/lib/streams.ts";

test("streamToCategory：四方向映射正确", () => {
  assert.equal(streamToCategory("ai-news"), "ai");
  assert.equal(streamToCategory("intl-news"), "other");
  assert.equal(streamToCategory("cn-news"), "other");
  assert.equal(streamToCategory("ent-news"), "other");
  assert.equal(streamToCategory("world-news"), "other");
  assert.equal(streamToCategory("github-daily"), "github");
});

test("isResearchStream：接受四方向，拒绝非法值", () => {
  for (const s of ALL_STREAMS) assert.ok(isResearchStream(s), s + " 应合法");
  assert.ok(!isResearchStream("bogus"));
  assert.ok(!isResearchStream(""));
  assert.ok(!isResearchStream("world-news-extra"));
});

test("STREAM_LABEL：四方向中文名齐全", () => {
  assert.equal(STREAM_LABEL["ai-news"], "AI 新闻");
  assert.equal(STREAM_LABEL["intl-news"], "国际新闻");
  assert.equal(STREAM_LABEL["cn-news"], "国内新闻");
  assert.equal(STREAM_LABEL["ent-news"], "娱乐新闻");
  for (const s of NEWS_STREAMS) {
    assert.ok(STREAM_LABEL[s]?.length > 0, s + " 缺中文名");
  }
});

test("NEWS_STREAMS：不含 github-daily，ALL_STREAMS 含之", () => {
  assert.ok(!NEWS_STREAMS.includes("github-daily"));
  assert.ok(ALL_STREAMS.includes("github-daily"));
  assert.equal(ALL_STREAMS.length, NEWS_STREAMS.length + 1);
});
