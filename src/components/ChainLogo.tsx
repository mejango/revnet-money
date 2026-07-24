import { chainIdToLogo } from "@/app/constants";
import type { JBChainId } from "@/lib/nana/types";
import { JB_CHAINS } from "@bananapus/nana-sdk-core";
import Image from "next/image";

type ImageProps = React.ComponentProps<typeof Image>;

type Props = {
  chainId: JBChainId;
} & Omit<ImageProps, "src" | "alt" | "title">;

export const ChainLogo = (props: Props) => {
  const { chainId, width, height, style, ...rest } = props;
  const chainName = JB_CHAINS[chainId].name;
  const src = chainIdToLogo[chainId];
  const displayWidth = width ?? 20;
  const displayHeight = height ?? 20;
  const isArbitrum = src.endsWith("/arbitrum.svg");

  return (
    <Image
      {...rest}
      src={src}
      alt={`${chainName} Logo`}
      title={chainName}
      width={isArbitrum ? 374 : 1}
      height={isArbitrum ? 422 : 1}
      style={{
        width: displayWidth,
        height: "auto",
        minWidth: displayWidth,
        minHeight: displayHeight,
        flexShrink: 0,
        ...style,
      }}
    />
  );
};
