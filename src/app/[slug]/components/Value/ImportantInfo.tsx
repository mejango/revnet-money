export function ImportantInfo({
  collateralAmount,
  tokenSymbol,
}: {
  collateralAmount: string;
  tokenSymbol: string;
}) {
  return (
    <div className="mt-2 text-sm text-gray-700 space-y-1">
      <p>
        Your {collateralAmount || "0"} {tokenSymbol} tokens are removed from supply (burned) to back
        the loan.
      </p>
      <p>
        A unique token called an NFT records the loan and the right to recover its tokens. Its owner
        can repay to create those tokens again.
      </p>
      <p>After 10 years, the right to recover any remaining tokens ends.</p>
    </div>
  );
}
