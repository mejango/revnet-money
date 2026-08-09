import { AuditPromptLink } from "@/components/AuditPromptLink";

export function Footer() {
  return (
    <footer className="text-zinc-900">
      <div className="container pr-[1.5rem] pl-[1.5rem] sm:pr-[2rem] sm:pl-[2rem] sm:px-8 border-x-zinc-500 py-10">
        <div>
          <div className="text-md text-zinc-700 text-center">
            <p>
              Revnets are open source, and enforced by the Revnet, Juicebox, and Uniswap protocols
              on the Ethereum network.
            </p>
            <p className="mt-4 sm:mt-0">
              Thanks to the ETH, JBX, REV, and UNI communities for crafting the infrastructure that
              makes revnets possible.
            </p>
          </div>
          <div className="mt-8 border-t border-zinc-200 pt-6 text-center text-sm text-zinc-600">
            <p>
              Review the{" "}
              <a
                href="https://github.com/Bananapus/version-6"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-zinc-900"
              >
                protocol code
              </a>{" "}
              and the{" "}
              <a
                href="https://github.com/mejango/revnet-money"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-zinc-900"
              >
                website code
              </a>
              .
            </p>
            <AuditPromptLink className="mt-1" />
            <p className="mt-1">
              <a
                href="https://docs.juicebox.money/tos"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-zinc-900"
              >
                Terms of Service
              </a>
              : Risks are borne entirely by the users of the open source code.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
