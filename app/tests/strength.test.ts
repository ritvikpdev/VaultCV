/**
 * Bullet strength scorer tests.
 *
 * Run: npm run test
 *
 * The cases are real bullets from the reference resumes plus deliberately weak
 * controls. Exact scores are not asserted — thresholds and relative ordering
 * are, because the scorer is a heuristic and tuning its weights shouldn't break
 * the suite. What must hold is that a strong rewrite always outranks its weak
 * original.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { scoreBullet } from "../src/lib/bullet-strength.ts";

const STRONG: string[] = [
  "Engineered Spring Boot microservices for a major U.S. bank's payment system processing 300K transactions daily, reducing latency by 35% and ensuring 99.9% uptime.",
  "Automated CI/CD pipelines using Jenkins, Maven, and Bitbucket, cutting deployment time by 40% and eliminating manual release errors.",
  "Containerized services with Docker and deployed on Kubernetes clusters, improving scalability and environment consistency by 25%.",
  "Optimized database interactions with Entity Framework and parameterized SQL queries, reducing data retrieval time by 30%.",
];

const WEAK: string[] = [
  "Responsible for testing the application.",
  "Helped with various backend tasks as needed.",
  "Worked on the frontend using React.",
  "Participated in team meetings and sprint ceremonies on a regular basis.",
  "Contributed to the codebase.",
];

test("strong bullets score 4 or above", () => {
  for (const text of STRONG) {
    const { score } = scoreBullet(text);
    assert.ok(score >= 4, `expected >=4, got ${score} for: ${text.slice(0, 60)}…`);
  }
});

test("weak bullets score 2 or below", () => {
  for (const text of WEAK) {
    const { score } = scoreBullet(text);
    assert.ok(score <= 2, `expected <=2, got ${score} for: ${text}`);
  }
});

test("a strong rewrite always outscores its weak original", () => {
  const pairs: Array<[weak: string, strong: string]> = [
    [
      "Responsible for improving database performance.",
      "Optimized database queries and schemas, improving data-retrieval performance by 25% across distributed modules.",
    ],
    [
      "Worked on CI/CD.",
      "Automated CI/CD pipelines using Jenkins and Maven, cutting deployment time by 40%.",
    ],
    [
      "Helped build the payments service.",
      "Built a payments service handling 300K transactions daily at 99.9% uptime.",
    ],
  ];

  for (const [weak, strong] of pairs) {
    assert.ok(
      scoreBullet(strong).score > scoreBullet(weak).score,
      `rewrite did not outscore original: "${weak}"`,
    );
  }
});

test("empty input scores the floor and explains nothing", () => {
  const { score, reasons } = scoreBullet("   ");
  assert.equal(score, 1);
  assert.equal(reasons.length, 0);
});

test("score is always within 1..5", () => {
  const inputs = [
    ...STRONG,
    ...WEAK,
    "x",
    "Responsible for ".repeat(40),
    "Architected ".repeat(40) + "99% 300K Kubernetes",
  ];
  for (const text of inputs) {
    const { score } = scoreBullet(text);
    assert.ok(score >= 1 && score <= 5, `out of range: ${score}`);
  }
});

test("a metric raises the score of an otherwise identical bullet", () => {
  const without = scoreBullet("Reduced page load time for the checkout flow.").score;
  const with_ = scoreBullet("Reduced page load time for the checkout flow by 40%.").score;
  assert.ok(with_ > without, `metric did not help: ${without} -> ${with_}`);
});
