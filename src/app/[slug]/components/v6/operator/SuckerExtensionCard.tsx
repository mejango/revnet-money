"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { ChainLogo } from "@/components/ChainLogo";
import { ProjectIdInput } from "@/components/ProjectIdInput";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { isSafeProposalPendingError, useWriteContract } from "@/hooks/useReviewedWriteContract";
import { clearExtensionSalt, saltForExtension } from "@/lib/suckerExtensionSalt";
import { formatWalletError } from "@/lib/utils";
import {
  JBChainId,
  JBCoreContracts,
  jbMultiTerminalAbi,
  revDeployerAbi,
  RevnetCoreContracts,
} from "@bananapus/nana-sdk-core";
import { useState } from "react";
import { useAccount } from "wagmi";
import {
  chainName,
  ChainProjectRow,
  publicClientFor,
  runSequentialWrites,
  v6ContractAddress,
} from "./operatorLib";
import { OperatorSection } from "./OperatorSection";
import {
  assetsFromAccountingContexts,
  buildSuckerExtensionWrites,
  extensionCandidateChains,
} from "./suckerExtensionLib";

const ZERO_HASH = `0x${"0".repeat(64)}`;

/**
 * Extend a revnet's sucker group to another chain, the way REVDeployer
 * dictates it: the OPERATOR calls `deploySuckersFor` on the new chain (one
 * sucker per existing peer) and on every existing chain (one sucker toward
 * the new chain), all with the same user salt. The contract requires a revnet
 * already deployed on the target chain whose `hashedEncodedConfigurationOf`
 * matches — the salt each sucker deploys under folds in that hash, the user
 * salt, and the caller, and cross-chain suckers only pair when both ends land
 * at the same address. This client verifies the hash match before sending;
 * the operator and allow-deploy-suckers ruleset gates are enforced on-chain
 * and caught by the simulate-first pipeline.
 */
export function SuckerExtensionCard({ rows }: { rows: ChainProjectRow[] }) {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [targetChainId, setTargetChainId] = useState<string>("");
  const [targetProjectId, setTargetProjectId] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const candidates = extensionCandidateChains(rows);

  const submit = async () => {
    if (busy || !address) return;
    const target = Number(targetChainId) as JBChainId;
    const projectId = Number(targetProjectId.trim());
    if (!target) {
      setError("Pick the chain to extend to.");
      return;
    }
    if (!Number.isInteger(projectId) || projectId <= 0) {
      setError("Enter this revnet's project ID on the target chain.");
      return;
    }
    if (!ack) return;
    setBusy(true);
    setError(null);
    try {
      // 1. The contract pairs suckers by CREATE2 address, and the address
      // folds in hashedEncodedConfigurationOf — verify the target chain holds
      // a revnet with the byte-identical configuration before anything sends.
      setStatus("Verifying the revnet's configuration on both chains…");
      const home = rows[0];
      const deployer = v6ContractAddress(RevnetCoreContracts.REVDeployer, home.chainId);
      const targetDeployer = v6ContractAddress(RevnetCoreContracts.REVDeployer, target);
      if (!deployer || !targetDeployer) {
        throw new Error("REVDeployer isn't deployed on one of the chains.");
      }
      const [homeHash, targetHash] = await Promise.all([
        publicClientFor(home.chainId).readContract({
          address: deployer,
          abi: revDeployerAbi,
          functionName: "hashedEncodedConfigurationOf",
          args: [BigInt(home.projectId)],
        }),
        publicClientFor(target).readContract({
          address: targetDeployer,
          abi: revDeployerAbi,
          functionName: "hashedEncodedConfigurationOf",
          args: [BigInt(projectId)],
        }),
      ]);
      if (targetHash === ZERO_HASH) {
        throw new Error(
          `No revnet configuration found for project #${projectId} on ${chainName(target)}. ` +
            "The revnet must be deployed there first — through REVDeployer, with the " +
            "byte-identical original configuration (only its hash is stored on-chain, so " +
            "this client cannot reconstruct it; use the original deploy config).",
        );
      }
      if (homeHash !== targetHash) {
        throw new Error(
          `Project #${projectId} on ${chainName(target)} was deployed with a DIFFERENT ` +
            "configuration, so its suckers can never pair with this revnet's. Deploy the " +
            "revnet there with the byte-identical original configuration first.",
        );
      }

      // 2. Bridge mappings come from the revnet's own accounting contexts.
      const terminal = v6ContractAddress(JBCoreContracts.JBMultiTerminal, home.chainId);
      if (!terminal) throw new Error("JBMultiTerminal isn't deployed on the home chain.");
      const contexts = await publicClientFor(home.chainId).readContract({
        address: terminal,
        abi: jbMultiTerminalAbi,
        functionName: "accountingContextsOf",
        args: [BigInt(home.projectId)],
      });
      const assets = assetsFromAccountingContexts(contexts, home.chainId);

      // 3. One shared salt: the peer suckers of each edge only pair when the same operator
      // sends the same salt on both chains (JBSuckerRegistry.sol:1043 derives the address
      // from keccak256(sender, salt)). This writes to several chains in sequence and stops
      // at the first failure — always, on the Safe path — so the salt is persisted and
      // reused on retry. A fresh one would strand the already-deployed peers.
      const salt = saltForExtension(address, projectId, target);
      const writes = buildSuckerExtensionWrites({
        groupRows: rows,
        targetChainId: target,
        targetProjectId: projectId,
        assets,
        salt,
      });

      const done = await runSequentialWrites({
        writes,
        account: address,
        writeContractAsync,
        onProgress: setStatus,
      });
      // Every chain landed, so the next extension should start from a new salt.
      clearExtensionSalt(address, projectId, target);
      setStatus(`Suckers deployed on ${done} chain${done === 1 ? "" : "s"}.`);
      toast({ title: `Extended to ${chainName(target)}` });
      setOpen(false);
    } catch (e) {
      const message = formatWalletError(e) || "Could not extend the revnet.";
      setError(message);
      toast(
        isSafeProposalPendingError(e)
          ? { title: "Safe proposal submitted", description: message }
          : { variant: "destructive", title: "Error", description: message },
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <OperatorSection title="Chains">
      <div>
        <p className="text-sm text-zinc-500">
          This revnet runs on {rows.length} chain{rows.length === 1 ? "" : "s"}
          {rows.length > 0 ? ": " : ""}
          {rows.map((row) => chainName(row.chainId)).join(", ")}. Suckers bridge its token between
          them.
        </p>
        {candidates.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">
            It's already connected on every supported chain.
          </p>
        ) : !open ? (
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => {
              setOpen(true);
              setStatus(null);
              setError(null);
            }}
          >
            Extend to another chain
          </Button>
        ) : (
          <div className="mt-3 bg-melon-100 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Extend to another chain</p>
              <button
                type="button"
                className="text-xs text-zinc-500 hover:text-zinc-800"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              Only the revnet's operator can extend it, its rules must allow deploying new suckers,
              and the revnet must already be deployed on the target chain with the byte-identical
              original configuration (its on-chain configuration hash is checked before anything
              sends). One transaction runs on the target chain and one on each existing chain, all
              from this wallet — the same operator address and salt on every chain are what make the
              new suckers pair up.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Select value={targetChainId} onValueChange={(v) => setTargetChainId(v)}>
                <SelectTrigger aria-label="Target chain">
                  <SelectValue placeholder="Target chain" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((chainId) => (
                    <SelectItem value={String(chainId)} key={chainId}>
                      <div className="flex items-center gap-2">
                        <ChainLogo chainId={chainId} />
                        {chainName(chainId)}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ProjectIdInput
                value={targetProjectId}
                onChange={(value) => {
                  setTargetProjectId(value);
                  setError(null);
                }}
                chainId={Number(targetChainId) || undefined}
                disabled={busy}
                placeholder="Project ID on that chain"
                ariaLabel="Project ID on the target chain"
              />
            </div>
            <label className="mt-3 flex items-start gap-2 border border-amber-300 bg-amber-50 rounded p-3">
              <input
                type="checkbox"
                checked={ack}
                disabled={busy}
                onChange={(e) => setAck(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-xs text-amber-800">
                I am the revnet's operator on every chain, and I verified the target project ID
                belongs to this revnet. Every transaction is simulated before it sends.
              </span>
            </label>
            <ButtonWithWallet
              targetChainId={(Number(targetChainId) || rows[0]?.chainId) as JBChainId}
              connectWalletText="Connect wallet to extend"
              size="sm"
              className="mt-3"
              loading={busy}
              disabled={busy || !ack || !targetChainId || !targetProjectId.trim()}
              onClick={submit}
            >
              Deploy suckers
            </ButtonWithWallet>
            {status ? <p className="text-xs text-zinc-500 mt-2">{status}</p> : null}
            {error ? <p className="text-xs text-red-600 mt-2">{error}</p> : null}
          </div>
        )}
      </div>
    </OperatorSection>
  );
}
