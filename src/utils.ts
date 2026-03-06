import { BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TokenOwnerOffCurveError,
} from "@solana/spl-token";

export const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

export const getProgramDataAddress = (programId: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID
  )[0];

export const getPoolAddress = (
  programId: PublicKey,
  owner: PublicKey,
  mintA: PublicKey,
  mintB: PublicKey
) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), owner.toBuffer(), mintA.toBuffer(), mintB.toBuffer()],
    programId
  )[0];

export const getVaultAddress = (
  programId: PublicKey,
  pool: PublicKey,
  mint: PublicKey
) =>
  PublicKey.findProgramAddressSync([pool.toBuffer(), mint.toBuffer()], programId)[0];

export const getPairAddress = (
  programId: PublicKey,
  mintA: PublicKey,
  mintB: PublicKey
) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("state"), mintA.toBuffer(), mintB.toBuffer()],
    programId
  )[0];

export const getConfigAddress = (programId: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];

export const toBN = (value: BN | number) => (BN.isBN(value) ? value : new BN(value));

export const getTokenProgramForMint = async (
  connection: { getAccountInfo: (pubkey: PublicKey) => Promise<any> },
  mint: PublicKey
) => {
  const mintInfo = await connection.getAccountInfo(mint);
  if (!mintInfo) {
    throw new Error(`Mint account not found: ${mint.toBase58()}`);
  }

  if (mintInfo.owner.equals(TOKEN_PROGRAM_ID)) {
    return TOKEN_PROGRAM_ID;
  }

  if (mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return TOKEN_2022_PROGRAM_ID;
  }

  throw new Error(`Unknown token program for mint: ${mint.toBase58()}`);
};

export const getAta = (
  mint: PublicKey,
  owner: PublicKey,
  tokenProgramId: PublicKey,
  allowOffCurve = false
) => getAssociatedTokenAddressSync(mint, owner, allowOffCurve, tokenProgramId);

export const maybeCreateAtaInstruction = async (
  connection: { getAccountInfo: (pubkey: PublicKey) => Promise<any> },
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgramId: PublicKey,
  allowOffCurve = false
): Promise<{ ata: PublicKey; instruction?: TransactionInstruction }> => {
  let ata: PublicKey;
  try {
    ata = getAta(mint, owner, tokenProgramId, allowOffCurve);
  } catch (err) {
    if (!allowOffCurve && err instanceof TokenOwnerOffCurveError) {
      ata = getAta(mint, owner, tokenProgramId, true);
    } else {
      throw err;
    }
  }
  const info = await connection.getAccountInfo(ata);
  if (info) {
    return { ata };
  }

  return {
    ata,
    instruction: createAssociatedTokenAccountInstruction(
      payer,
      ata,
      owner,
      mint,
      tokenProgramId
    ),
  };
};

export const transferSolInstruction = (
  from: PublicKey,
  to: PublicKey,
  lamports: number | BN
) => {
  const amount = BN.isBN(lamports) ? lamports.toNumber() : lamports;
  return SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: amount });
};
