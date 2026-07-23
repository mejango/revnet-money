import { useJBChainId } from "@/lib/nana/project";
import { JB_CHAINS, JBChainId } from "@bananapus/nana-sdk-core";
import React from "react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { WalletConnectButton } from "./WalletButton";
import { Button, ButtonProps } from "./ui/button";

const ButtonWithWallet = React.forwardRef<
  HTMLButtonElement,
  {
    connectWalletText?: string;
    targetChainId?: JBChainId;
    children: React.ReactNode;
    forceChildren?: boolean;
  } & ButtonProps
>(({ children, connectWalletText, targetChainId, forceChildren, ...props }, ref) => {
  const jbChainId = useJBChainId();
  const userChainId = useChainId();
  const { isConnected } = useAccount();
  const { switchChainAsync, isPending } = useSwitchChain();

  const _targetChainId = targetChainId || jbChainId;

  if (!isConnected) {
    return (
      <WalletConnectButton
        {...props}
        onClick={undefined}
        label={connectWalletText ?? "Connect Wallet"}
      />
    );
  }

  if (typeof _targetChainId !== "undefined" && userChainId !== _targetChainId) {
    return (
      <Button
        {...props}
        onClick={async (e) => {
          e.preventDefault();
          await switchChainAsync({ chainId: _targetChainId });
          props.onClick?.(e);
        }}
        loading={isPending}
      >
        {forceChildren ? children : `Switch to ${JB_CHAINS[_targetChainId].name}`}
      </Button>
    );
  }

  return (
    <Button ref={ref} {...props}>
      {children}
    </Button>
  );
});

ButtonWithWallet.displayName = "ButtonWithWallet";

export { ButtonWithWallet };
