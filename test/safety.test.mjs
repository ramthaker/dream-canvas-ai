import test from "node:test";
import assert from "node:assert/strict";
import { isSafeStory, safeProfile } from "../src/safety.mjs";

test("safeProfile applies bedtime defaults and bounds age", () => {
  const profile = safeProfile({
    childName: "  Mia ",
    age: 99,
    themes: "stars",
    email: "parent@example.com",
  });
  assert.deepEqual(profile, {
    childName: "Mia",
    age: 12,
    themes: "stars",
    email: "parent@example.com",
    timezone: "Europe/Stockholm",
    bedtime: "20:00",
  });
});

test("isSafeStory accepts a calm story", () => {
  assert.equal(
    isSafeStory({
      title: "The Moon Garden",
      body: "A gentle adventure begins. ".repeat(10),
    }),
    true,
  );
});

test("isSafeStory rejects unsafe content and malformed output", () => {
  assert.equal(isSafeStory({ title: "A scary night", body: "A story" }), false);
  assert.equal(isSafeStory(null), false);
});
