/* eslint-disable @next/next/no-img-element */
"use client";

import EtherscanLink from "@/components/EtherscanLink";
import { useProfile } from "@/components/ProfilesContext";
import { sdk } from "@farcaster/miniapp-sdk";
import { useEffect } from "react";
import { twMerge } from "tailwind-merge";
import { Address, Chain } from "viem";
import { ensAvatarUrlForAddress } from "./EthereumAddress";

export function ProfileAvatar({
  address,
  short,
  withAvatar,
  avatarProps,
  className,
  chain,
}: {
  address: Address;
  short?: boolean;
  withAvatar?: boolean;
  avatarProps?: { size?: "sm" | "md" };
  className?: string;
  chain?: Chain;
}) {
  const profile = useProfile(address);
  const formattedAddress = short ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;

  const renderValue =
    profile?.platform === "farcaster"
      ? profile.identity || profile.displayName || formattedAddress
      : profile?.displayName || profile?.identity || formattedAddress;

  const avatarSize = avatarProps?.size ?? "md";
  const avatarDimensions = avatarSize === "md" ? 36 : 24;

  useEffect(() => {
    const init = async () => {
      if (sdk?.actions) {
        await sdk.actions.ready();
      }
    };
    init();
  }, []);

  const src = profile?.avatar?.startsWith("http")
    ? profile.avatar
    : ensAvatarUrlForAddress(address, { size: avatarDimensions });

  // Social avatars are user-controlled. Fetch them directly in the browser
  // instead of exposing the server-side Next image optimizer as an open proxy.
  const avatarElement = (
    <img
      src={src}
      alt={profile?.identity ?? address}
      className={twMerge(
        "inline-block rounded-full",
        avatarSize === "md" ? "w-9 h-9" : "w-6 h-6",
        withAvatar && !profile?.social?.uid ? "mr-2" : "",
      )}
      width={avatarDimensions}
      height={avatarDimensions}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );

  return (
    <div className={twMerge("inline-flex items-center", className)}>
      {withAvatar && profile?.platform === "farcaster" && profile.social?.uid ? (
        <button
          onClick={() => sdk.actions.viewProfile({ fid: Number(profile.social!.uid!) })} // Updated onClick
          className="mr-2"
        >
          {avatarElement}
        </button>
      ) : withAvatar ? (
        avatarElement
      ) : null}
      <EtherscanLink value={address} chain={chain}>
        {renderValue}
      </EtherscanLink>
    </div>
  );
}
