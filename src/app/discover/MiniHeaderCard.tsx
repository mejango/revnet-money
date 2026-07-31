"use client";

import { IpfsImage } from "@/components/IpfsImage";

export type MiniHeaderCardProps = {
  logoUri?: string | null;
  name?: string | null;
  infoUri?: string;
  projectId: string | number;
  handle?: string | null;
};

export default function MiniHeaderCard({
  logoUri,
  name,
  infoUri,
  projectId,
  handle,
}: MiniHeaderCardProps) {
  return (
    <div className="flex items-center gap-4 mb-2">
      <IpfsImage
        src={logoUri}
        alt={`${handle || "Project"} logo`}
        width={48}
        height={48}
        className="size-12 rounded-full object-cover"
        fallback={<div className="size-12 rounded-full bg-zinc-100" />}
      />
      <div>
        <h3 className="text-lg font-bold">{name || handle || `Project ${projectId}`}</h3>
        <p className="text-sm text-zinc-500">{infoUri || "revnet.eth"}</p>
      </div>
    </div>
  );
}
