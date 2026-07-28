import type { RelayrPostBundleResponse } from "@/lib/nana/types";
import Image from "next/image";
import { useTestData } from "../helpers/useTestData";
import { ChainSelect } from "./ChainSelect";
import { DeploySection } from "./DeploySection";
import { Divider } from "./Divider";
import { ProjectDetails } from "./ProjectDetails";
import { QuoteResponse } from "./QuoteResponse";
import { AssetsSection } from "./ReservedAssets";
import { Stages } from "./Stages";

export function DeployRevnetForm({
  relayrResponse,
  resetRelayrResponse,
}: {
  relayrResponse?: RelayrPostBundleResponse;
  resetRelayrResponse: () => void;
}) {
  // type `testdata` into console to fill form with TEST_FORM_DATA
  // can remove on mainnet deploy
  useTestData();

  const validBundle = !!relayrResponse?.bundle_uuid;
  const disabled = validBundle;

  return (
    <div className="mx-auto my-20 max-w-6xl gap-x-6 gap-y-6 px-4 sm:px-8 md:grid md:grid-cols-3 xl:gap-y-0 xl:px-0">
      {/* <div className="col-span-full flex justify-center mb-6">
        <div className="bg-red-100 px-4 py-2.5 rounded-xl max-w-screen-md text-red-950 text-sm">
          <strong className="font-semibold">Important</strong>
          <span className="font-normal"> &bull; </span> Revnet creation is temporarily paused and
          will resume soon.
        </div>
      </div> */}
      <Image
        src="/assets/img/create-cutout.webp"
        width={1120}
        height={747}
        sizes="(min-width: 640px) 560px, calc(100vw - 2rem)"
        className="mx-auto mb-10 h-auto w-full max-w-[560px] md:col-span-3"
        alt="A figure holding a lightning bolt above the clouds"
      />
      <h1 className="mb-16 text-2xl md:col-span-3 font-semibold">Create a revnet</h1>
      {/* Chains come first: every chain-dependent input below specializes per
          selected chain at the point of input. */}
      <ChainSelect disabled={disabled} />
      <Divider />
      <ProjectDetails disabled={disabled} />
      <Divider />
      <AssetsSection disabled={disabled} />
      <Divider />
      <Stages disabled={disabled} />
      <Divider />
      <DeploySection validBundle={validBundle} disabled={disabled} />
      {relayrResponse && (
        <QuoteResponse relayrResponse={relayrResponse} reset={resetRelayrResponse} />
      )}
    </div>
  );
}
