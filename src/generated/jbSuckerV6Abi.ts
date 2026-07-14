/**
 * Minimal v6 JBSucker ABI. v6 identifies remote beneficiaries as bytes32 (for cross-VM
 * compatibility) and adds an opaque `metadata` attribution payload to prepared leaves.
 */
export const jbSuckerV6Abi = [
  {
    type: "function",
    name: "prepare",
    inputs: [
      { name: "projectTokenCount", type: "uint256", internalType: "uint256" },
      { name: "beneficiary", type: "bytes32", internalType: "bytes32" },
      { name: "minTokensReclaimed", type: "uint256", internalType: "uint256" },
      { name: "token", type: "address", internalType: "address" },
      { name: "metadata", type: "bytes32", internalType: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "toRemote",
    inputs: [{ name: "token", type: "address", internalType: "address" }],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "claim",
    inputs: [
      {
        name: "claimData",
        type: "tuple",
        internalType: "struct JBClaim",
        components: [
          { name: "token", type: "address", internalType: "address" },
          {
            name: "leaf",
            type: "tuple",
            internalType: "struct JBLeaf",
            components: [
              { name: "index", type: "uint256", internalType: "uint256" },
              { name: "beneficiary", type: "bytes32", internalType: "bytes32" },
              { name: "projectTokenCount", type: "uint256", internalType: "uint256" },
              { name: "terminalTokenAmount", type: "uint256", internalType: "uint256" },
              { name: "metadata", type: "bytes32", internalType: "bytes32" },
            ],
          },
          { name: "proof", type: "bytes32[32]", internalType: "bytes32[32]" },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;
