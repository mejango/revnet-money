import { TierMediaPreview } from "@/app/[slug]/components/v6/shop/TierMediaPreview";
import { IpfsImage } from "@/components/IpfsImage";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

const CID = "bafkreihz5xk2crdko5mllpxbfa443m2o6pmzcmbg5b3uvif6ho4x45z674";

describe("IPFS image failure handling", () => {
  it("bypasses Next optimization, then falls back from the media cache to the bounded route", () => {
    render(
      <IpfsImage
        src={`ipfs://${CID}/logo.png`}
        alt="Project logo"
        width={48}
        height={48}
        fallback={<span>Project image unavailable</span>}
      />,
    );

    let image = screen.getByRole("img", { name: "Project logo" });
    expect(image).toHaveAttribute("src", `https://${CID}.eth.sucks/logo.png`);
    expect(image).not.toHaveAttribute("srcset");
    expect(image).toHaveAttribute("referrerpolicy", "no-referrer");

    fireEvent.error(image);
    image = screen.getByRole("img", { name: "Project logo" });
    expect(image).toHaveAttribute("src", `/api/ipfs/${CID}/logo.png`);

    fireEvent.error(image);
    expect(screen.getByText("Project image unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Project logo" })).not.toBeInTheDocument();
  });

  it("never renders an arbitrary metadata URL", () => {
    render(
      <IpfsImage
        src="https://attacker.example/tracker.png"
        alt="Project logo"
        fallback={<span>Safe fallback</span>}
      />,
    );

    expect(screen.getByText("Safe fallback")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("keeps shop cards usable when tier media fails in the browser", () => {
    render(
      <TierMediaPreview
        media={{ image: `/api/ipfs/${CID}/item.png` }}
        tierId={7}
        alt="Shop item"
      />,
    );

    fireEvent.error(screen.getByRole("img", { name: "Shop item" }));
    expect(screen.getByText("#7")).toBeInTheDocument();
  });
});
