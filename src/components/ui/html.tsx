"use client";

import createDOMPurify from "dompurify";
import { useEffect, useState } from "react";

const PROJECT_RICH_TEXT_TAGS = [
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "i",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "strong",
  "u",
  "ul",
] as const;

const MAX_CONTENT_LENGTH = 50_000;
const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function safeExternalHref(value: string): boolean {
  try {
    return SAFE_LINK_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

function unwrap(element: Element) {
  element.replaceWith(...element.childNodes);
}

function toPlainParagraphs(source: string): string[] {
  return source
    .slice(0, MAX_CONTENT_LENGTH)
    .replace(/<\/(p|div|li|h[1-6]|blockquote|pre)>/giu, "\n")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<[^>]+>/gu, "")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/&nbsp;/gu, " ")
    .split(/\n+/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .slice(0, 40);
}

/**
 * Sanitize project-supplied rich text in a browser DOM.
 *
 * The policy is shared with the other V6 webclients: semantic formatting
 * only, no embedded content or active attributes, and only absolute external
 * HTTP(S)/mailto links. Unsafe anchors are unwrapped so their labels remain.
 */
export function sanitizeProjectRichText(source: string): string {
  if (typeof window === "undefined") return "";

  const purifier = createDOMPurify(window);
  const fragment = purifier.sanitize(source.slice(0, MAX_CONTENT_LENGTH), {
    ALLOWED_TAGS: [...PROJECT_RICH_TEXT_TAGS],
    ALLOWED_ATTR: ["href", "title"],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/iu,
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: [
      "audio",
      "button",
      "embed",
      "form",
      "iframe",
      "img",
      "input",
      "math",
      "object",
      "script",
      "style",
      "svg",
      "template",
      "video",
    ],
    RETURN_DOM_FRAGMENT: true,
    SANITIZE_DOM: true,
    SANITIZE_NAMED_PROPS: true,
  });

  for (const link of fragment.querySelectorAll("a")) {
    const href = link.getAttribute("href")?.trim();
    if (!href || !safeExternalHref(href)) {
      unwrap(link);
      continue;
    }
    link.setAttribute("href", href);
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  }

  const container = document.createElement("div");
  container.append(fragment);
  return container.innerHTML;
}

export const ProjectRichText = ({ className, source }: { className?: string; source: string }) => {
  const [sanitized, setSanitized] = useState<{
    source: string;
    html: string;
  } | null>(null);
  const sanitizedHtml = sanitized?.source === source ? sanitized.html : null;

  useEffect(() => {
    setSanitized({
      source,
      html: sanitizeProjectRichText(source),
    });
  }, [source]);

  if (sanitizedHtml === null) {
    return (
      <div id="rich-text" className={className}>
        {toPlainParagraphs(source).map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
    );
  }

  return (
    <div
      id="rich-text"
      className={className}
      // This is the single reviewed project-controlled HTML boundary.
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  );
};

export const Html = ProjectRichText;
