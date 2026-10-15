/**
 * The bullet rich-text allowlist and its plain-text twin.
 *
 * The security property is the point: whatever reaches the sanitizer, only
 * strong/em/u and http(s)/mailto links come out, balanced.
 */

import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  hasFormatting,
  htmlToText,
  sanitizeInlineHtml,
  splitPastedLines,
  textToHtml,
} from "../src/lib/rich-text.ts";

describe("sanitizing bullet html", () => {
  test("keeps the allowed tags and normalises b/i", () => {
    assert.equal(
      sanitizeInlineHtml("<b>Led</b> a <i>team</i> of <u>five</u>"),
      "<strong>Led</strong> a <em>team</em> of <u>five</u>",
    );
  });

  test("drops disallowed tags but keeps their text", () => {
    assert.equal(sanitizeInlineHtml('<span style="color:red">Cut</span> <font>cost</font>'), "Cut cost");
  });

  test("never lets script or event handlers through", () => {
    const out = sanitizeInlineHtml('<img src=x onerror="alert(1)">Hi<script>alert(1)</script>');
    assert.ok(!/<img|<script|onerror/i.test(out));
    assert.ok(out.includes("Hi"));
  });

  test("links survive only with safe schemes", () => {
    assert.equal(
      sanitizeInlineHtml('<a href="https://x.com" onclick="evil()">site</a>'),
      '<a href="https://x.com">site</a>',
    );
    assert.equal(sanitizeInlineHtml('<a href="javascript:alert(1)">bad</a>'), "bad");
    assert.equal(sanitizeInlineHtml('<a href="github.com/me">gh</a>'), '<a href="https://github.com/me">gh</a>');
  });

  test("unbalanced input comes out balanced", () => {
    assert.equal(sanitizeInlineHtml("<strong>open <em>both"), "<strong>open <em>both</em></strong>");
    assert.equal(sanitizeInlineHtml("stray</strong> closer"), "stray closer");
  });

  test("stray angle brackets in text are escaped, entities kept", () => {
    assert.equal(sanitizeInlineHtml("latency < 50ms &amp; p99 > 2"), "latency &lt; 50ms &amp; p99 &gt; 2");
  });
});

describe("plain text", () => {
  test("strips tags and decodes entities", () => {
    assert.equal(htmlToText("<strong>Cut</strong> cost by 30% &amp; latency &lt;50ms"), "Cut cost by 30% & latency <50ms");
  });

  test("round-trips plain text through textToHtml", () => {
    const text = "Reduced p99 < 50ms & doubled throughput";
    assert.equal(htmlToText(textToHtml(text)), text);
  });

  test("knows when there is formatting worth keeping", () => {
    assert.equal(hasFormatting("plain"), false);
    assert.equal(hasFormatting("<em>x</em>"), true);
  });
});

describe("pasting lines", () => {
  test("list markers become bullets, other lines paragraphs", () => {
    assert.deepEqual(splitPastedLines("Intro line\n- first\n* second\n• third\n\n1. fourth"), [
      { text: "Intro line", isBullet: false },
      { text: "first", isBullet: true },
      { text: "second", isBullet: true },
      { text: "third", isBullet: true },
      { text: "fourth", isBullet: true },
    ]);
  });
});
