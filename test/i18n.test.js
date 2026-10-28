import assert from "node:assert/strict";
import test from "node:test";
import {
  getTranslationKeys,
  normalizeLocale,
  setLocale,
  t,
} from "../public/i18n.js";

test("Chinese and English dictionaries contain the same keys", () => {
  const zhKeys = new Set(getTranslationKeys("zh-CN"));
  const enKeys = new Set(getTranslationKeys("en"));
  assert.deepEqual([...zhKeys].sort(), [...enKeys].sort());
});

test("locale normalization and interpolation are deterministic", () => {
  assert.equal(normalizeLocale("en-US"), "en");
  assert.equal(normalizeLocale("zh-TW"), "zh-CN");
  setLocale("en");
  assert.equal(
    t("room.participantSummary", { employees: 2, modes: 3, tasks: 1 }),
    "Employees: 2 · Modes: 3 · Tasks: 1",
  );
  setLocale("zh-CN");
  assert.equal(
    t("room.participantSummary", { employees: 2, modes: 3, tasks: 1 }),
    "2 名员工 · 3 个 Modes · 1 个任务",
  );
});
