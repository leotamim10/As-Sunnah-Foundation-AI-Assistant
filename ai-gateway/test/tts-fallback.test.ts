import { test } from "node:test";
import assert from "node:assert/strict";
import { FallbackTtsAdapter, type TtsAdapter, type TtsResult } from "../src/adapters/tts.js";

const ok = (tag: string): TtsAdapter => ({
  async synthesize(): Promise<TtsResult> {
    return { pcm: Buffer.from(tag), sampleRate: 24000 };
  },
});

const fails = (msg: string): TtsAdapter => ({
  async synthesize(): Promise<TtsResult> {
    throw new Error(msg);
  },
});

test("FallbackTtsAdapter: returns the first adapter that succeeds", async () => {
  const adapter = new FallbackTtsAdapter([ok("primary"), ok("secondary")]);
  const { pcm } = await adapter.synthesize({ text: "হ্যালো" });
  assert.equal(pcm.toString(), "primary");
});

test("FallbackTtsAdapter: falls through to the next adapter on failure", async () => {
  const adapter = new FallbackTtsAdapter([fails("azure down"), ok("fallback")]);
  const { pcm } = await adapter.synthesize({ text: "হ্যালো" });
  assert.equal(pcm.toString(), "fallback");
});

test("FallbackTtsAdapter: throws an AggregateError when every adapter fails", async () => {
  const adapter = new FallbackTtsAdapter([fails("a"), fails("b")]);
  await assert.rejects(() => adapter.synthesize({ text: "হ্যালো" }), (err: unknown) => {
    assert.ok(err instanceof AggregateError);
    assert.equal(err.errors.length, 2);
    return true;
  });
});

test("FallbackTtsAdapter: rejects an empty adapter chain at construction", () => {
  assert.throws(() => new FallbackTtsAdapter([]));
});
