import { BN } from "@coral-xyz/anchor";
import { PublicKey, Signer, TransactionInstruction } from "@solana/web3.js";

export type FeeBeneficiaryInput = {
  wallet: PublicKey;
  shareBps: number;
};

export type CurveTypeInput = { constantProduct: {} } | { exponential: {} };

export type CreatePoolParamsInput = {
  shift: BN | number;
  initialTokenBReserves: BN | number;
  curve: CurveTypeInput;
  feeBeneficiaries: FeeBeneficiaryInput[];
};

export type CreatePairParamsInput = {
  shift: BN | number;
  initialTokenBReserves: BN | number;
  curve: CurveTypeInput;
  feeBeneficiaries: FeeBeneficiaryInput[];
};

export type SwapParamsInput = {
  amount: BN | number;
  limit: BN | number;
};

export type PoolAddress = PublicKey;

export type PoolRef = {
  address: PublicKey;
  owner: PublicKey;
  mintA: PublicKey;
  mintB: PublicKey;
};

export type PairAddress = PublicKey;

export type PairRef = {
  address: PublicKey;
  mintA: PublicKey;
  mintB: PublicKey;
};

export type LaunchParams = {
  baseToken: PublicKey;
  programId?: PublicKey;
};

export type CreatePoolOptions = {
  payer?: PublicKey;
  owner?: PublicKey;
  tokenWalletB?: PublicKey;
  tokenWalletAuthority?: PublicKey;
  signers?: Signer[];
};

export type CreatePairOptions = {
  payer?: PublicKey;
  tokenWalletB?: PublicKey;
  tokenWalletAuthority?: PublicKey;
  signers?: Signer[];
};

export type SwapOptions = {
  userTokenAccountA?: PublicKey;
  userTokenAccountB?: PublicKey;
  platformFeeTokenAccount?: PublicKey;
  beneficiaryTokenAccounts?: PublicKey[];
  wrapSol?: boolean;
  unwrapSol?: boolean;
  autoCreateAta?: boolean;
};

export type VmmSwapOptions = SwapOptions & {
  ammProgramId?: PublicKey;
  ammPool?: PublicKey;
  ammVaultA?: PublicKey;
  ammVaultB?: PublicKey;
  ammConfig?: PublicKey;
  ammTokenProgramA?: PublicKey;
  ammTokenProgramB?: PublicKey;
};

export type InstructionBundle = {
  instructions: TransactionInstruction[];
  signers?: Signer[];
};

export type CreatePoolInstructionResult = InstructionBundle & {
  pool: PublicKey;
  vaultA: PublicKey;
  vaultB: PublicKey;
};

export type CreatePairInstructionResult = InstructionBundle & {
  pair: PublicKey;
  vaultA: PublicKey;
  vaultB: PublicKey;
};

export type SwapInstructionResult = InstructionBundle & {
  userTokenAccountA: PublicKey;
  userTokenAccountB: PublicKey;
};

export type CreatePoolWithDevBuyInstructionResult = InstructionBundle & {
  pool: PublicKey;
  vaultA: PublicKey;
  vaultB: PublicKey;
  userTokenAccountA: PublicKey;
  userTokenAccountB: PublicKey;
};

export type CreatePairWithDevBuyInstructionResult = InstructionBundle & {
  pair: PublicKey;
  vaultA: PublicKey;
  vaultB: PublicKey;
  userTokenAccountA: PublicKey;
  userTokenAccountB: PublicKey;
};

export type EstimateResult = {
  newReservesA: BN;
  newReservesB: BN;
  amountA: BN;
  amountB: BN;
  feeA: BN;
};
