import { test } from "node:test";
import assert from "node:assert/strict";
import { RespondRequest, TtsRequest, TtsResponse } from "../src/contracts.js";

test("RespondRequest: audio-only turn is valid and defaults lang to bn", () => {
  const parsed = RespondRequest.parse({ audioB64: "AAAA" });
  assert.equal(parsed.lang, "bn");
  assert.equal(parsed.audioB64, "AAAA");
});

test("RespondRequest: text-only turn is valid", () => {
  const parsed = RespondRequest.parse({ text: "হ্যালো" });
  assert.equal(parsed.text, "হ্যালো");
});

test("RespondRequest: rejects a turn with neither audio nor text", () => {
  const res = RespondRequest.safeParse({ imageB64: "AAAA" });
  assert.equal(res.success, false);
});

test("TtsRequest: rejects empty text, accepts optional voice override", () => {
  assert.equal(TtsRequest.safeParse({ text: "" }).success, false);
  const parsed = TtsRequest.parse({ text: "কেমন আছো", voice: "bn-BD-PradeepNeural" });
  assert.equal(parsed.voice, "bn-BD-PradeepNeural");
});

test("TtsResponse: sampleRate must be a positive integer", () => {
  assert.equal(TtsResponse.safeParse({ audioB64: "AA", sampleRate: 24000 }).success, true);
  assert.equal(TtsResponse.safeParse({ audioB64: "AA", sampleRate: -1 }).success, false);
  assert.equal(TtsResponse.safeParse({ audioB64: "AA", sampleRate: 24000.5 }).success, false);
});
