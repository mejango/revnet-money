import { TierMediaPreview } from "@/app/[slug]/components/v6/shop/TierMediaPreview";
import { ImageWithFallback, IpfsImage } from "@/components/IpfsImage";
import { ResponsiveImage } from "@/components/ResponsiveImage";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const CID = "bafkreihz5xk2crdko5mllpxbfa443m2o6pmzcmbg5b3uvif6ho4x45z674";

describe("IPFS image failure handling", () => {
  it.each([
    {},
    { loading: "eager" as const },
    { loading: "lazy" as const, fetchPriority: "high" as const },
  ])("sizes critical images in visible contained server markup: %j", (hints) => {
    const src = `https://juicebox.center/ipfs/${CID}/logo.png`;
    const html = renderToStaticMarkup(
      <ResponsiveImage
        src={src}
        sizes="144px"
        alt="Critical logo"
        style={{ objectFit: "cover" }}
        {...hints}
      />,
    );
    const container = document.createElement("div");
    container.innerHTML = html;
    const image = container.querySelector("img")!;
    expect(image.getAttribute("src")).toContain("/_next/image?url=");
    expect(image.getAttribute("srcset")).toContain("w=384&q=90 384w");
    expect(image).toHaveAttribute("sizes", "144px");
    expect(image).toHaveAttribute("data-original-src", src);
    expect(image.style.objectFit).toBe("contain");
    expect(image.style.visibility).not.toBe("hidden");
    expect(image.getAttribute("loading")).toBe(hints.loading ?? null);
    expect(image.getAttribute("fetchpriority")).toBe(hints.fetchPriority ?? null);
  });

  it("requests a responsive derivative and retries the accepted original before fallback", () => {
    render(
      <IpfsImage
        loading="lazy"
        src={`ipfs://${CID}/logo.png`}
        alt="Project logo"
        width={48}
        height={48}
        sizes="48px"
        fallback={<span>Project image unavailable</span>}
      />,
    );

    const image = screen.getByAltText("Project logo");
    expect(image.getAttribute("src")).toContain("/_next/image?url=");
    expect(image.getAttribute("src")).toContain("q=90");
    expect(image.getAttribute("srcset")).toContain("128w");
    expect(image).toHaveAttribute("sizes", "48px");
    expect(image).toHaveAttribute(
      "data-original-src",
      `https://juicebox.center/ipfs/${CID}/logo.png`,
    );
    expect(image).toHaveAttribute("referrerpolicy", "no-referrer");

    fireEvent.error(image);
    expect(image).toHaveAttribute("src", `https://juicebox.center/ipfs/${CID}/logo.png`);
    expect(image).not.toHaveAttribute("srcset");
    expect(screen.queryByText("Project image unavailable")).not.toBeInTheDocument();
    fireEvent.error(image);
    expect(screen.getByText("Project image unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Project logo" })).not.toBeInTheDocument();
  });

  it("starts a newly selected source contained with its own original retry", () => {
    const { rerender } = render(
      <IpfsImage
        loading="lazy"
        src={`ipfs://${CID}/first.png`}
        sizes="48px"
        alt="Changing logo"
        fallback={<span>Unavailable</span>}
      />,
    );
    const first = screen.getByAltText("Changing logo");
    fireEvent.error(first);
    expect(first).toHaveAttribute("data-original-fallback", "true");
    rerender(
      <IpfsImage
        loading="lazy"
        src={`ipfs://${CID}/second.png`}
        sizes="48px"
        alt="Changing logo"
        fallback={<span>Unavailable</span>}
      />,
    );
    const second = screen.getByAltText("Changing logo");
    expect(second).not.toBe(first);
    expect(second).not.toHaveAttribute("data-original-fallback");
    expect(second).toHaveStyle({ objectFit: "contain" });
    expect(second).not.toHaveStyle({ visibility: "hidden" });
    expect(second.getAttribute("src")).toContain("second.png");
    fireEvent.error(second);
    expect(second).toHaveAttribute("src", `https://juicebox.center/ipfs/${CID}/second.png`);
    fireEvent.error(second);
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });

  it("retains the original across same-source layout and parent updates", () => {
    const src = `ipfs://${CID}/logo.png`;
    const { rerender } = render(
      <IpfsImage
        loading="lazy"
        src={src}
        sizes="48px"
        alt="Resized logo"
        fallback={<span>Unavailable</span>}
      />,
    );
    const image = screen.getByAltText("Resized logo");
    fireEvent.error(image);
    rerender(
      <IpfsImage
        loading="lazy"
        src={src}
        sizes="144px"
        className="large"
        alt="Resized logo"
        fallback={<span>Unavailable</span>}
      />,
    );
    expect(screen.getByAltText("Resized logo")).toBe(image);
    expect(image).toHaveAttribute("src", `https://juicebox.center/ipfs/${CID}/logo.png`);
    expect(image).not.toHaveAttribute("srcset");
    expect(image).not.toHaveAttribute("sizes");
    expect(image).toHaveAttribute("data-original-fallback", "true");
    fireEvent.error(image);
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });

  it("retains the smallest adequate upgrade across parent updates and later grows again", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const src = `https://juicebox.center/ipfs/${CID}/panorama.png`;
    const { rerender } = render(
      <ResponsiveImage
        src={src}
        sizes="144px"
        alt="Cropped image"
        width={144}
        height={144}
        style={{ objectFit: "cover" }}
      />,
    );
    const image = screen.getByAltText("Cropped image") as HTMLImageElement;
    const candidates = image.srcset.split(", ");
    const candidate = (width: number) =>
      new URL(
        candidates.find((entry) => entry.endsWith(` ${width}w`))!.split(" ")[0],
        window.location.href,
      ).href;
    let current = candidate(384);
    let size = 144;
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      currentSrc: { configurable: true, get: () => current },
      naturalWidth: { configurable: true, value: 400 },
      naturalHeight: { configurable: true, value: 100 },
    });
    vi.spyOn(image, "getBoundingClientRect").mockImplementation(
      () => ({ width: size, height: size }) as DOMRect,
    );
    fireEvent.load(image);
    expect(image.src).toBe(candidate(640));
    expect(image).not.toHaveAttribute("data-original-fallback");
    expect(image.style.objectFit).toBe("contain");
    expect(image.style.visibility).not.toBe("hidden");

    rerender(
      <ResponsiveImage
        src={src}
        sizes="200px"
        className="parent-refresh"
        alt="Cropped image"
        width={144}
        height={144}
        style={{ objectFit: "cover" }}
      />,
    );
    expect(image.src).toBe(candidate(640));
    expect(image).not.toHaveAttribute("srcset");
    current = candidate(640);
    fireEvent.load(image);
    expect(image.style.objectFit).toBe("cover");
    size = 350;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(image.src).toBe(candidate(1920));
    expect(image).not.toHaveAttribute("data-original-fallback");
  });

  it("requalifies changed fit at the same size and recovers from a failed pending upgrade", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const src = `https://juicebox.center/ipfs/${CID}/panorama.png`;
    const view = (objectFit: "contain" | "cover") => (
      <ImageWithFallback
        src={src}
        sizes="144px"
        alt="Changing fit"
        style={{ objectFit }}
        fallback={<span>Image unavailable</span>}
      />
    );
    const { rerender } = render(view("contain"));
    const image = screen.getByAltText("Changing fit") as HTMLImageElement;
    const current = new URL(
      image.srcset
        .split(", ")
        .find((entry) => entry.endsWith(" 384w"))!
        .split(" ")[0],
      window.location.href,
    ).href;
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      currentSrc: { configurable: true, value: current },
      naturalWidth: { configurable: true, value: 384 },
      naturalHeight: { configurable: true, value: 96 },
    });
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
      width: 144,
      height: 144,
    } as DOMRect);
    fireEvent.load(image);
    expect(image.style.objectFit).toBe("contain");
    expect(image).toHaveAttribute("srcset");
    rerender(view("cover"));
    expect(new URL(image.src).searchParams.get("w")).toBe("640");
    expect(image.style.objectFit).toBe("contain");
    expect(image.style.visibility).toBe("");
    // A failed replacement can retain the previous decoded currentSrc.
    fireEvent.error(image);
    expect(image.src).toBe(src);
    expect(image).toHaveAttribute("data-original-fallback", "true");
    expect(screen.queryByText("Image unavailable")).not.toBeInTheDocument();
    fireEvent.error(image);
    expect(screen.getByText("Image unavailable")).toBeInTheDocument();
  });

  it("never renders an arbitrary metadata URL", () => {
    render(
      <IpfsImage
        loading="lazy"
        src="https://attacker.example/tracker.png"
        alt="Project logo"
        fallback={<span>Safe fallback</span>}
      />,
    );

    expect(screen.getByText("Safe fallback")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders a bounded inert inline SVG from project metadata", () => {
    const svg =
      "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2010%2010%22%3E%3Crect%20width%3D%2210%22%20height%3D%2210%22%2F%3E%3C%2Fsvg%3E";
    render(
      <IpfsImage
        loading="lazy"
        src={svg}
        alt="Inline project logo"
        fallback={<span>Safe fallback</span>}
      />,
    );

    expect(screen.getByRole("img", { name: "Inline project logo" })).toHaveAttribute("src", svg);
  });

  it("rejects active inline SVG metadata", () => {
    render(
      <IpfsImage
        loading="lazy"
        src="data:image/svg+xml,%3Csvg%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E%3C%2Fsvg%3E"
        alt="Unsafe project logo"
        fallback={<span>Safe fallback</span>}
      />,
    );

    expect(screen.getByText("Safe fallback")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Unsafe project logo" })).not.toBeInTheDocument();
  });

  it.each(["https://example.com/image.png", "blob:https://revnet.money/preview"])(
    "keeps an already accepted non-IPFS image direct: %s",
    (src) => {
      render(
        <ImageWithFallback
          src={src}
          alt="Preview"
          fallback={<span>Unavailable</span>}
          sizes="48px"
        />,
      );
      const image = screen.getByRole("img", { name: "Preview" });
      expect(image).toHaveAttribute("src", src);
      expect(image).not.toHaveAttribute("srcset");
      expect(image).not.toHaveAttribute("data-original-src");
      fireEvent.error(image);
      expect(screen.getByText("Unavailable")).toBeInTheDocument();
    },
  );

  it("keeps shop cards usable when tier media fails in the browser", () => {
    render(
      <TierMediaPreview
        media={{ image: `https://juicebox.center/ipfs/${CID}/item.png` }}
        tierId={7}
        alt="Shop item"
      />,
    );

    const image = screen.getByAltText("Shop item");
    fireEvent.error(image);
    expect(image).toHaveAttribute("src", `https://juicebox.center/ipfs/${CID}/item.png`);
    fireEvent.error(image);
    expect(screen.getByText("#7")).toBeInTheDocument();
  });
});
