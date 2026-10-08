import { RichPreview } from "@/app/[slug]/about/components/RichPreview";
import { ProjectRichText } from "@/components/ui/html";
import { getProjectLinks } from "@/lib/projectLinks";
import type { JBProjectMetadata } from "@bananapus/nana-sdk-core";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

describe("untrusted project content", () => {
  it("removes script elements, event handlers, and executable links from generic HTML", () => {
    const maliciousHtml = [
      "<p>Project description</p><scr",
      "ipt>alert(1)</scr",
      "ipt><img src='x' onerror='alert(2)'><a href='javascript:alert(3)'>unsafe</a>",
    ].join("");
    const { container } = render(createElement(ProjectRichText, { source: maliciousHtml }));

    expect(screen.getByText("Project description")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("unsafe").closest("a")).toBeNull();
  });

  it("sanitizes rich previews while preserving ordinary formatting", () => {
    const { container } = render(
      createElement(RichPreview, {
        source:
          "<strong>Terms</strong><iframe src='https://attacker.invalid'></iframe><a href='javascript:alert(1)'>bad link</a>",
      }),
    );

    expect(screen.getByText("Terms").tagName).toBe("STRONG");
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByText("bad link").closest("a")).toBeNull();
  });

  it("drops legacy <p><br></p> spacer paragraphs", () => {
    const { container } = render(
      createElement(ProjectRichText, { source: "<p>One</p><p><br></p><p>Two</p><p></p>" }),
    );

    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(container.querySelector("br")).toBeNull();
  });

  it("hardens absolute external links and rejects relative project links", () => {
    const { container } = render(
      createElement(ProjectRichText, {
        source: '<a href="https://example.com/docs">external</a><a href="/account">relative</a>',
      }),
    );

    expect(screen.getByRole("link", { name: "external" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "external" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
    expect(screen.getByText("relative").closest("a")).toBeNull();
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });

  it("renders markdown formatting and restricts images to https and ipfs sources", () => {
    const cid = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
    const { container } = render(
      createElement(ProjectRichText, {
        source: [
          "# Heading",
          "**bold** text",
          `![pinned](ipfs://${cid})`,
          "![hot](https://example.com/a.png)",
          "![plain](http://example.com/a.png)",
          "![inline](data:image/png;base64,AAAA)",
        ].join("\n\n"),
      }),
    );

    expect(screen.getByText("Heading").tagName).toBe("H1");
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    const images = [...container.querySelectorAll("img")];
    expect(images[0].getAttribute("src")).toContain("/_next/image?url=");
    expect(images[0]).toHaveAttribute("data-original-src", `https://juicebox.center/ipfs/${cid}`);
    expect(images[0]).toHaveAttribute("srcset");
    expect(images[1]).toHaveAttribute("src", "https://example.com/a.png");
    expect(images[1]).not.toHaveAttribute("srcset");
    expect(images.map((image) => image.getAttribute("alt"))).toEqual(["pinned", "hot"]);
  });

  it("owns responsive attributes after sanitization and retries the original only once", () => {
    const cid = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
    render(
      <ProjectRichText
        source={`<img alt="Pinned art" src="ipfs://${cid}" srcset="https://attacker.example/track.png 1w" sizes="1px" data-original-src="https://attacker.example/track.png" data-original-fallback="true" data-image-fit="cover" style="position:fixed" onerror="alert(1)">`}
      />,
    );
    const image = screen.getByAltText("Pinned art");
    expect(image.outerHTML).not.toContain("attacker.example");
    expect(image).not.toHaveAttribute("onerror");
    expect(image).not.toHaveAttribute("data-original-fallback");
    expect(image).not.toHaveAttribute("data-image-fit");
    expect(image).toHaveStyle({ objectFit: "contain" });
    expect(image).not.toHaveStyle({ visibility: "hidden" });
    fireEvent.error(image);
    expect(image).toHaveAttribute("src", `https://juicebox.center/ipfs/${cid}`);
    expect(image).not.toHaveAttribute("srcset");
    fireEvent.error(image);
    expect(image).toHaveAttribute("src", `https://juicebox.center/ipfs/${cid}`);
    expect(image).not.toHaveStyle({ visibility: "hidden" });
  });

  it("uses the shared candidate progression for sanitized description images", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const cid = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
    render(<ProjectRichText source={`![Description panorama](ipfs://${cid})`} />);
    const image = screen.getByAltText("Description panorama") as HTMLImageElement;
    const candidates = image.srcset.split(", ");
    const initial = candidates.find((entry) => entry.endsWith(" 640w"))!.split(" ")[0];
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      currentSrc: { configurable: true, value: new URL(initial, window.location.href).href },
      naturalWidth: { configurable: true, value: 640 },
      naturalHeight: { configurable: true, value: 160 },
    });
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
      width: 300,
      height: 300,
    } as DOMRect);
    fireEvent.load(image);
    expect(new URL(image.src).searchParams.get("w")).toBe("1200");
    expect(image).not.toHaveAttribute("data-original-fallback");
    expect(image.style.objectFit).toBe("contain");
    expect(image.style.visibility).toBe("");
    // Native errors may retain the previously decoded currentSrc while the
    // selected replacement is pending. The ancestor capture still recovers.
    fireEvent.error(image);
    expect(image.src).toBe(`https://juicebox.center/ipfs/${cid}`);
    expect(image).toHaveAttribute("data-original-fallback", "true");
    fireEvent.error(image);
    expect(image.src).toBe(`https://juicebox.center/ipfs/${cid}`);
    expect(image.style.visibility).toBe("");
    expect(image.style.objectFit).toBe("");
  });

  it("caps project-controlled input before parsing", () => {
    const { container } = render(
      createElement(ProjectRichText, {
        source: `<p>${"a".repeat(60_000)}</p>`,
      }),
    );

    expect(container.textContent?.length).toBeLessThan(51_000);
  });

  it("returns no links for absent metadata and normalizes user handles to HTTPS", () => {
    expect(getProjectLinks()).toEqual([]);

    const links = getProjectLinks({
      name: "Juicebox",
      twitter: "juiceboxETH",
      infoUri: "juicebox.money/",
      farcaster: "juicebox",
      discord: "",
    } as JBProjectMetadata);

    expect(links).toEqual([
      { type: "twitter", label: "X", url: "https://x.com/juiceboxETH" },
      { type: "infoUri", label: "Website", url: "https://juicebox.money" },
      { type: "farcaster", label: "Farcaster", url: "https://farcaster.xyz/juicebox" },
    ]);
    expect(links.every((link) => link.url.startsWith("https://"))).toBe(true);
  });

  it("does not emit a javascript scheme from project metadata", () => {
    const [link] = getProjectLinks({
      name: "Unsafe metadata",
      infoUri: "javascript:alert(1)",
    } as JBProjectMetadata);

    expect(link.url.toLowerCase()).not.toMatch(/^javascript:/);
    expect(link.url).toMatch(/^https:\/\//);
  });
});
