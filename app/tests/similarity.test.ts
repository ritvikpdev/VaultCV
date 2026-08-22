import assert from "node:assert/strict";
import test from "node:test";

import { findSimilar, textSimilarity } from "../src/lib/similarity.ts";

test("identical text scores 1", () => {
  const text = "Engineered a payment pipeline processing 300K transactions daily";
  assert.equal(textSimilarity(text, text), 1);
});

test("unrelated text scores near 0", () => {
  const a = "Engineered a payment pipeline processing 300K transactions daily";
  const b = "Volunteered at the campus animal shelter on weekends";
  assert.ok(textSimilarity(a, b) < 0.2);
});

test("reworded duplicate scores high even with different words", () => {
  const a = "Engineered Spring Boot microservices for a payment system, reducing latency 35%";
  const b = "Built Spring Boot microservices for a payment platform, cutting latency by 35%";
  assert.ok(textSimilarity(a, b) > 0.4);
});

test("empty strings never match anything", () => {
  assert.equal(textSimilarity("", "something"), 0);
  assert.equal(textSimilarity("something", ""), 0);
});

test("findSimilar returns the best match at or above the threshold", () => {
  const target = "Reduced deployment time by 40% using Jenkins and Docker";
  const candidates = [
    "Volunteered at the campus animal shelter",
    "Cut deployment time 40% using Jenkins and Docker automation",
  ];
  assert.equal(findSimilar(target, candidates), candidates[1]);
});

test("findSimilar returns null below the threshold", () => {
  const target = "Reduced deployment time by 40% using Jenkins and Docker";
  const candidates = ["Volunteered at the campus animal shelter"];
  assert.equal(findSimilar(target, candidates), null);
});
