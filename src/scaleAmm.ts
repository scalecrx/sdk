import {
  AnchorProvider,
  BN,
  Idl,
  Program,
  parseIdlErrors,
} from "@coral-xyz/anchor";
import {
  Commitment,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  NATIVE_MINT,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
} from "@solana/spl-token";

import {
  CreatePoolOptions,
  CreatePoolParamsInput,
  CreatePoolInstructionResult,
  CurveTypeInput,
  CreatePoolWithDevBuyInstructionResult,
  EstimateResult,
  PoolAddress,
  PoolRef,
  SwapInstructionResult,
  SwapOptions,
  SwapParamsInput,
} from "./types";
import {
  getConfigAddress,
  getPoolAddress,
  getProgramDataAddress,
  getTokenProgramForMint,
  getVaultAddress,
  maybeCreateAtaInstruction,
  toBN,
  transferSolInstruction,
} from "./utils";
import { ScaleSdkError, toSdkError } from "./errors";
import idl from "./idl/scale_amm.json";

export type PoolAccount = {
  enabled: boolean;
  owner: PublicKey;
  mintA: PublicKey;
  mintB: PublicKey;
  tokenAReserves: BN;
  tokenBReserves: BN;
  shift: BN;
  curve: CurveTypeInput;
  bump: number;
  feeBeneficiaryCount: number;
  feeBeneficiaries: Array<{ wallet: PublicKey; shareBps: number }>;
};

export class ScaleAmm {
  readonly provider: AnchorProvider;
  readonly programId: PublicKey;
  readonly program: Program;
  readonly idl: Idl;
  readonly idlErrors: Map<number, string>;
  readonly hasWallet: boolean;

  constructor(
    provider: AnchorProvider,
    programId: PublicKey,
    idlOverride?: Idl,
    hasWallet = true
  ) {
    this.provider = provider;
    this.programId = programId;
    const resolvedIdl = idlOverride ?? (idl as unknown as Idl);
    this.idl = { ...resolvedIdl, address: programId.toBase58() } as Idl;
    this.program = new Program(this.idl, provider);
    this.idlErrors = parseIdlErrors(this.idl);
    this.hasWallet = hasWallet;
  }

  getConfigAddress() {
    return getConfigAddress(this.programId);
  }

  getPoolAddress(owner: PublicKey, mintA: PublicKey, mintB: PublicKey) {
    return getPoolAddress(this.programId, owner, mintA, mintB);
  }

  getVaultAddress(pool: PublicKey, mint: PublicKey) {
    return getVaultAddress(this.programId, pool, mint);
  }

  async getPlatformConfig() {
    const config = this.getConfigAddress();
    try {
      return await (this.program.account as any).platformConfig.fetch(config);
    } catch (err) {
      return null;
    }
  }

  async getPlatformBaseToken() {
    const config = await this.getPlatformConfig();
    return config ? (config as any).baseToken as PublicKey : null;
  }

  async setPlatformBaseToken(baseToken: PublicKey) {
    try {
      const instruction = await this.setPlatformBaseTokenInstruction(baseToken);
      const tx = new Transaction().add(instruction);
      return await this.sendTransaction(tx, [], "confirmed");
    } catch (err) {
      throw toSdkError("setPlatformBaseToken failed", err, this.idlErrors);
    }
  }

  async setPlatformBaseTokenInstruction(baseToken: PublicKey) {
    const config = this.getConfigAddress();
    const programData = getProgramDataAddress(this.programId);

    try {
      return await this.program.methods
        .setPlatformBaseToken(baseToken)
        .accounts({
          authority: this.provider.wallet.publicKey,
          config,
          systemProgram: SystemProgram.programId,
          programData,
        })
        .instruction();
    } catch (err) {
      throw toSdkError(
        "setPlatformBaseTokenInstruction failed",
        err,
        this.idlErrors
      );
    }
  }

  async setPlatformFee(feeBps: number) {
    try {
      const instruction = await this.setPlatformFeeInstruction(feeBps);
      const tx = new Transaction().add(instruction);
      return await this.sendTransaction(tx, [], "confirmed");
    } catch (err) {
      throw toSdkError("setPlatformFee failed", err, this.idlErrors);
    }
  }

  async setPlatformFeeInstruction(feeBps: number) {
    const config = this.getConfigAddress();

    try {
      return await this.program.methods
        .setPlatformFee(feeBps)
        .accounts({
          authority: this.provider.wallet.publicKey,
          config,
        })
        .instruction();
    } catch (err) {
      throw toSdkError(
        "setPlatformFeeInstruction failed",
        err,
        this.idlErrors
      );
    }
  }

  async setFeeBeneficiary(beneficiary: PublicKey) {
    try {
      const instruction = await this.setFeeBeneficiaryInstruction(beneficiary);
      const tx = new Transaction().add(instruction);
      return await this.sendTransaction(tx, [], "confirmed");
    } catch (err) {
      throw toSdkError("setFeeBeneficiary failed", err, this.idlErrors);
    }
  }

  async setFeeBeneficiaryInstruction(beneficiary: PublicKey) {
    const config = this.getConfigAddress();

    try {
      return await this.program.methods
        .setFeeBeneficiary(beneficiary)
        .accounts({
          authority: this.provider.wallet.publicKey,
          config,
        })
        .instruction();
    } catch (err) {
      throw toSdkError(
        "setFeeBeneficiaryInstruction failed",
        err,
        this.idlErrors
      );
    }
  }

  async transferAuthority(newAuthority: PublicKey) {
    try {
      const instruction = await this.transferAuthorityInstruction(newAuthority);
      const tx = new Transaction().add(instruction);
      return await this.sendTransaction(tx, [], "confirmed");
    } catch (err) {
      throw toSdkError("transferAuthority failed", err, this.idlErrors);
    }
  }

  async transferAuthorityInstruction(newAuthority: PublicKey) {
    const config = this.getConfigAddress();

    try {
      return await this.program.methods
        .transferAuthority(newAuthority)
        .accounts({
          authority: this.provider.wallet.publicKey,
          config,
        })
        .instruction();
    } catch (err) {
      throw toSdkError(
        "transferAuthorityInstruction failed",
        err,
        this.idlErrors
      );
    }
  }

  async getFeeBeneficiaries(poolInput: PoolAddress | PoolRef) {
    const pool = await this.resolvePool(poolInput);
    return pool.data.feeBeneficiaries.slice(0, pool.data.feeBeneficiaryCount);
  }

  async getFeeShare(poolInput: PoolAddress | PoolRef, wallet: PublicKey) {
    const beneficiaries = await this.getFeeBeneficiaries(poolInput);
    const entry = beneficiaries.find((beneficiary) => beneficiary.wallet.equals(wallet));
    return entry ? entry.shareBps : 0;
  }

  async getTotalCreatorFeeBps(poolInput: PoolAddress | PoolRef) {
    const beneficiaries = await this.getFeeBeneficiaries(poolInput);
    return beneficiaries.reduce((acc, beneficiary) => acc + beneficiary.shareBps, 0);
  }

  async getPool(poolOrAddress: PoolAddress | PoolRef) {
    const resolved = await this.resolvePool(poolOrAddress);
    return resolved;
  }

  async getPoolByAddress(pool: PublicKey): Promise<PoolRef & { data: PoolAccount }> {
    try {
      const data = (await (this.program.account as any).pool.fetch(
        pool
      )) as PoolAccount;
      return {
        address: pool,
        owner: data.owner,
        mintA: data.mintA,
        mintB: data.mintB,
        data,
      };
    } catch (err) {
      throw toSdkError("getPoolByAddress failed", err, this.idlErrors);
    }
  }

  async getPoolByMints(
    owner: PublicKey,
    mintA: PublicKey,
    mintB: PublicKey
  ): Promise<PoolRef & { data: PoolAccount }> {
    const pool = this.getPoolAddress(owner, mintA, mintB);
    return this.getPoolByAddress(pool);
  }

  async createPool(
    params: CreatePoolParamsInput,
    mintA: PublicKey,
    mintB: PublicKey,
    options: CreatePoolOptions = {}
  ) {
    const payer = options.payer ?? this.provider.wallet.publicKey;
    const owner = options.owner ?? this.provider.wallet.publicKey;
    const tokenWalletAuthority =
      options.tokenWalletAuthority ?? this.provider.wallet.publicKey;

    try {
      const { instructions, pool, vaultA, vaultB, signers } =
        await this.createPoolInstructions(params, mintA, mintB, options);
      const tx = new Transaction();
      instructions.forEach((instruction) => tx.add(instruction));
      const signature = await this.sendTransaction(tx, signers ?? [], "confirmed");
      return { pool, vaultA, vaultB, signature };
    } catch (err) {
      throw toSdkError("createPool failed", err, this.idlErrors);
    }
  }

  async createPoolInstructions(
    params: CreatePoolParamsInput,
    mintA: PublicKey,
    mintB: PublicKey,
    options: CreatePoolOptions = {}
  ): Promise<CreatePoolInstructionResult> {
    const payer = options.payer ?? this.provider.wallet.publicKey;
    const owner = options.owner ?? this.provider.wallet.publicKey;
    const tokenWalletAuthority =
      options.tokenWalletAuthority ?? this.provider.wallet.publicKey;

    try {
      const tokenProgramA = await getTokenProgramForMint(
        this.provider.connection,
        mintA
      );
      const tokenProgramB = await getTokenProgramForMint(
        this.provider.connection,
        mintB
      );

      const pool = this.getPoolAddress(owner, mintA, mintB);
      const vaultA = this.getVaultAddress(pool, mintA);
      const vaultB = this.getVaultAddress(pool, mintB);
      const config = this.getConfigAddress();

      let tokenWalletB = options.tokenWalletB;
      const instructions: TransactionInstruction[] = [];

      if (!tokenWalletB) {
        const ataResult = await maybeCreateAtaInstruction(
          this.provider.connection,
          payer,
          tokenWalletAuthority,
          mintB,
          tokenProgramB
        );
        tokenWalletB = ataResult.ata;
        if (ataResult.instruction) {
          instructions.push(ataResult.instruction);
        }
      }

      const createParams = {
        shift: toBN(params.shift),
        initialTokenBReserves: toBN(params.initialTokenBReserves),
        curve: params.curve,
        feeBeneficiaries: params.feeBeneficiaries ?? [],
      };

      const ix = await this.program.methods
        .create(createParams)
        .accounts({
          payer,
          owner,
          tokenWalletAuthority,
          mintA,
          mintB,
          tokenWalletB,
          pool,
          vaultA,
          vaultB,
          tokenProgramA,
          tokenProgramB,
          systemProgram: SystemProgram.programId,
          config,
        })
        .instruction();
      instructions.push(ix);

      return { instructions, pool, vaultA, vaultB, signers: options.signers };
    } catch (err) {
      throw toSdkError("createPoolInstructions failed", err, this.idlErrors);
    }
  }

  async createWithDevBuyInstructions(
    params: CreatePoolParamsInput,
    mintA: PublicKey,
    mintB: PublicKey,
    buyParams: SwapParamsInput,
    options: (CreatePoolOptions & SwapOptions) = {}
  ): Promise<CreatePoolWithDevBuyInstructionResult> {
    try {
      const owner = options.owner ?? this.provider.wallet.publicKey;
      const { instructions: createInstructions, pool, vaultA, vaultB, signers } =
        await this.createPoolInstructions(params, mintA, mintB, options);

      const swapParams = { amount: toBN(buyParams.amount), limit: toBN(buyParams.limit) };
      const user = this.provider.wallet.publicKey;
      const autoCreateAta = options.autoCreateAta ?? true;
      const wrapSol = options.wrapSol ?? true;
      const unwrapSol = options.unwrapSol ?? false;

      const tokenProgramA = await getTokenProgramForMint(
        this.provider.connection,
        mintA
      );
      const tokenProgramB = await getTokenProgramForMint(
        this.provider.connection,
        mintB
      );

      const preInstructions: TransactionInstruction[] = [];
      const postInstructions: TransactionInstruction[] = [];

      let userTaA = options.userTokenAccountA;
      let userTaB = options.userTokenAccountB;
      let createdAtaA = false;

      if (!userTaA) {
        const ataResult = await maybeCreateAtaInstruction(
          this.provider.connection,
          user,
          user,
          mintA,
          tokenProgramA
        );
        userTaA = ataResult.ata;
        if (ataResult.instruction && !autoCreateAta) {
          throw new Error(`Missing ATA for mintA: ${mintA.toBase58()}`);
        }
        if (ataResult.instruction) {
          createdAtaA = true;
          preInstructions.push(ataResult.instruction);
        }
      }

      if (!userTaB) {
        const ataResult = await maybeCreateAtaInstruction(
          this.provider.connection,
          user,
          user,
          mintB,
          tokenProgramB
        );
        userTaB = ataResult.ata;
        if (ataResult.instruction && !autoCreateAta) {
          throw new Error(`Missing ATA for mintB: ${mintB.toBase58()}`);
        }
        if (ataResult.instruction) {
          preInstructions.push(ataResult.instruction);
        }
      }

      const isNativeA = mintA.equals(NATIVE_MINT);
      if (isNativeA && wrapSol) {
        preInstructions.push(transferSolInstruction(user, userTaA!, swapParams.amount));
        preInstructions.push(createSyncNativeInstruction(userTaA!));
      }

      if (isNativeA && unwrapSol && createdAtaA) {
        postInstructions.push(
          createCloseAccountInstruction(userTaA!, user, user)
        );
      }

      const config = this.getConfigAddress();
      const configState = (await (this.program.account as any).platformConfig.fetch(
        config
      )) as any;
      const feeBeneficiary = configState.feeBeneficiary as PublicKey;

      let platformFeeTaA = options.platformFeeTokenAccount;
      if (!platformFeeTaA) {
        const ataResult = await maybeCreateAtaInstruction(
          this.provider.connection,
          user,
          feeBeneficiary,
          mintA,
          tokenProgramA,
          true
        );
        platformFeeTaA = ataResult.ata;
        if (ataResult.instruction && !autoCreateAta) {
          throw new Error(
            `Missing platform fee ATA for mintA: ${mintA.toBase58()}`
          );
        }
        if (ataResult.instruction) {
          preInstructions.push(ataResult.instruction);
        }
      }

      const beneficiaries = params.feeBeneficiaries ?? [];
      if (
        options.beneficiaryTokenAccounts &&
        options.beneficiaryTokenAccounts.length !== beneficiaries.length
      ) {
        throw new Error("beneficiaryTokenAccounts length mismatch");
      }
      const remainingAccounts =
        options.beneficiaryTokenAccounts ??
        (await Promise.all(
          beneficiaries.map(async (beneficiary) => {
          const ataResult = await maybeCreateAtaInstruction(
            this.provider.connection,
            user,
            beneficiary.wallet,
            mintA,
            tokenProgramA,
            true
          );
            if (ataResult.instruction && !autoCreateAta) {
              throw new Error(
                `Missing beneficiary ATA for mintA: ${mintA.toBase58()}`
              );
            }
            if (ataResult.instruction) {
              preInstructions.push(ataResult.instruction);
            }
            return ataResult.ata;
          })
        ));

      const ix = await (this.program.methods as any).buy(swapParams)
        .accounts({
          pool,
          user,
          owner,
          mintA,
          mintB,
          userTaA,
          userTaB,
          vaultA,
          vaultB,
          platformFeeTaA,
          tokenProgramA,
          tokenProgramB,
          systemProgram: SystemProgram.programId,
          config,
        })
        .remainingAccounts(
          remainingAccounts.map((pubkey) => ({
            pubkey,
            isWritable: true,
            isSigner: false,
          }))
        )
        .instruction();

      return {
        instructions: [...createInstructions, ...preInstructions, ix, ...postInstructions],
        signers,
        pool,
        vaultA,
        vaultB,
        userTokenAccountA: userTaA!,
        userTokenAccountB: userTaB!,
      };
    } catch (err) {
      throw toSdkError("createWithDevBuyInstructions failed", err, this.idlErrors);
    }
  }

  async buy(
    poolInput: PoolAddress | PoolRef,
    params: SwapParamsInput,
    options: SwapOptions = {}
  ) {
    try {
      const { instructions, signers } = await this.buyInstructions(
        poolInput,
        params,
        options
      );
      const tx = new Transaction();
      instructions.forEach((instruction) => tx.add(instruction));
      return await this.sendTransaction(tx, signers ?? [], "confirmed");
    } catch (err) {
      throw toSdkError("buy failed", err, this.idlErrors);
    }
  }

  async sell(
    poolInput: PoolAddress | PoolRef,
    params: SwapParamsInput,
    options: SwapOptions = {}
  ) {
    try {
      const { instructions, signers } = await this.sellInstructions(
        poolInput,
        params,
        options
      );
      const tx = new Transaction();
      instructions.forEach((instruction) => tx.add(instruction));
      return await this.sendTransaction(tx, signers ?? [], "confirmed");
    } catch (err) {
      throw toSdkError("sell failed", err, this.idlErrors);
    }
  }

  async buyInstructions(
    poolInput: PoolAddress | PoolRef,
    params: SwapParamsInput,
    options: SwapOptions = {}
  ): Promise<SwapInstructionResult> {
    try {
      const pool = await this.resolvePool(poolInput);
      return await this.swapInstructions("buy", pool, params, options);
    } catch (err) {
      throw toSdkError("buyInstructions failed", err, this.idlErrors);
    }
  }

  async sellInstructions(
    poolInput: PoolAddress | PoolRef,
    params: SwapParamsInput,
    options: SwapOptions = {}
  ): Promise<SwapInstructionResult> {
    try {
      const pool = await this.resolvePool(poolInput);
      return await this.swapInstructions("sell", pool, params, options);
    } catch (err) {
      throw toSdkError("sellInstructions failed", err, this.idlErrors);
    }
  }

  async estimateBuy(poolInput: PoolAddress | PoolRef, params: SwapParamsInput) {
    return this.estimate("quoteBuy", poolInput, params);
  }

  async estimateSell(poolInput: PoolAddress | PoolRef, params: SwapParamsInput) {
    return this.estimate("quoteSell", poolInput, params);
  }

  private async estimate(
    method: "quoteBuy" | "quoteSell",
    poolInput: PoolAddress | PoolRef,
    params: SwapParamsInput
  ): Promise<EstimateResult> {
    try {
      const pool = await this.resolvePool(poolInput);
      const swapParams = { amount: toBN(params.amount), limit: toBN(params.limit) };
      const config = this.getConfigAddress();

      const result = await (this.program.methods as any)
        [method](swapParams)
        .accounts({
          pool: pool.address,
          owner: pool.owner,
          mintA: pool.mintA,
          mintB: pool.mintB,
          config,
        })
        .view();

      return {
        newReservesA: result.newReservesA,
        newReservesB: result.newReservesB,
        amountA: result.amountA,
        amountB: result.amountB,
        feeA: result.feeA,
      };
    } catch (err) {
      throw toSdkError(`${method} failed`, err, this.idlErrors);
    }
  }

  private async resolvePool(poolInput: PoolAddress | PoolRef) {
    if (poolInput instanceof PublicKey) {
      return this.getPoolByAddress(poolInput);
    }

    return this.getPoolByAddress(poolInput.address);
  }

  private async swapInstructions(
    action: "buy" | "sell",
    pool: PoolRef & { data: PoolAccount },
    params: SwapParamsInput,
    options: SwapOptions
  ): Promise<SwapInstructionResult> {
    const swapParams = { amount: toBN(params.amount), limit: toBN(params.limit) };
    const user = this.provider.wallet.publicKey;
    const autoCreateAta = options.autoCreateAta ?? true;
    const wrapSol = options.wrapSol ?? action === "buy";
    const unwrapSol = options.unwrapSol ?? action === "sell";

    const tokenProgramA = await getTokenProgramForMint(
      this.provider.connection,
      pool.mintA
    );
    const tokenProgramB = await getTokenProgramForMint(
      this.provider.connection,
      pool.mintB
    );

    const preInstructions: TransactionInstruction[] = [];
    const postInstructions: TransactionInstruction[] = [];

    let userTaA = options.userTokenAccountA;
    let userTaB = options.userTokenAccountB;
    let createdAtaA = false;

    if (!userTaA) {
      const ataResult = await maybeCreateAtaInstruction(
        this.provider.connection,
        user,
        user,
        pool.mintA,
        tokenProgramA
      );
      userTaA = ataResult.ata;
      if (ataResult.instruction && !autoCreateAta) {
        throw new Error(`Missing ATA for mintA: ${pool.mintA.toBase58()}`);
      }
      if (ataResult.instruction) {
        createdAtaA = true;
        preInstructions.push(ataResult.instruction);
      }
    }

    if (!userTaB) {
      const ataResult = await maybeCreateAtaInstruction(
        this.provider.connection,
        user,
        user,
        pool.mintB,
        tokenProgramB
      );
      userTaB = ataResult.ata;
      if (ataResult.instruction && !autoCreateAta) {
        throw new Error(`Missing ATA for mintB: ${pool.mintB.toBase58()}`);
      }
      if (ataResult.instruction) {
        preInstructions.push(ataResult.instruction);
      }
    }

    const isNativeA = pool.mintA.equals(NATIVE_MINT);
    if (isNativeA && wrapSol) {
      preInstructions.push(transferSolInstruction(user, userTaA!, swapParams.amount));
      preInstructions.push(createSyncNativeInstruction(userTaA!));
    }

    if (isNativeA && unwrapSol && createdAtaA) {
      postInstructions.push(
        createCloseAccountInstruction(userTaA!, user, user)
      );
    }

    const vaultA = this.getVaultAddress(pool.address, pool.mintA);
    const vaultB = this.getVaultAddress(pool.address, pool.mintB);
    const config = this.getConfigAddress();
    const configState = (await (this.program.account as any).platformConfig.fetch(
      config
    )) as any;
    const feeBeneficiary = configState.feeBeneficiary as PublicKey;

      let platformFeeTaA = options.platformFeeTokenAccount;
      if (!platformFeeTaA) {
        const ataResult = await maybeCreateAtaInstruction(
          this.provider.connection,
          user,
          feeBeneficiary,
          pool.mintA,
          tokenProgramA,
          true
        );
      platformFeeTaA = ataResult.ata;
      if (ataResult.instruction && !autoCreateAta) {
        throw new Error(
          `Missing platform fee ATA for mintA: ${pool.mintA.toBase58()}`
        );
      }
      if (ataResult.instruction) {
        preInstructions.push(ataResult.instruction);
      }
    }

    const beneficiaries = pool.data.feeBeneficiaries.slice(
      0,
      pool.data.feeBeneficiaryCount
    );
    if (
      options.beneficiaryTokenAccounts &&
      options.beneficiaryTokenAccounts.length !== beneficiaries.length
    ) {
      throw new Error("beneficiaryTokenAccounts length mismatch");
    }
    const remainingAccounts =
      options.beneficiaryTokenAccounts ??
      (await Promise.all(
        beneficiaries.map(async (beneficiary) => {
          const ataResult = await maybeCreateAtaInstruction(
            this.provider.connection,
            user,
            beneficiary.wallet,
            pool.mintA,
            tokenProgramA,
            true
          );
          if (ataResult.instruction && !autoCreateAta) {
            throw new Error(
              `Missing beneficiary ATA for mintA: ${pool.mintA.toBase58()}`
            );
          }
          if (ataResult.instruction) {
            preInstructions.push(ataResult.instruction);
          }
          return ataResult.ata;
        })
      ));

    const ix = await (this.program.methods as any)[action](swapParams)
      .accounts({
        pool: pool.address,
        user,
        owner: pool.owner,
        mintA: pool.mintA,
        mintB: pool.mintB,
        userTaA,
        userTaB,
        vaultA,
        vaultB,
        platformFeeTaA,
        tokenProgramA,
        tokenProgramB,
        systemProgram: SystemProgram.programId,
        config,
      })
      .remainingAccounts(
        remainingAccounts.map((pubkey) => ({
          pubkey,
          isWritable: true,
          isSigner: false,
        }))
      )
      .instruction();

    const instructions = [...preInstructions, ix, ...postInstructions];
    return {
      instructions,
      userTokenAccountA: userTaA!,
      userTokenAccountB: userTaB!,
    };
  }

  private async sendTransaction(
    tx: Transaction,
    signers: any[] = [],
    commitment?: Commitment
  ) {
    try {
      if (!this.hasWallet) {
        throw new ScaleSdkError(
          "No wallet provided. Direct execution requires an Anchor wallet.",
          "transaction failed",
          null
        );
      }
      if (!tx.feePayer) {
        tx.feePayer = this.provider.wallet.publicKey;
      }
      const { blockhash, lastValidBlockHeight } =
        await this.provider.connection.getLatestBlockhash(
          commitment ?? "confirmed"
        );
      tx.recentBlockhash = blockhash;
      if (signers.length) {
        tx.partialSign(...signers);
      }
      const signedTx = await this.provider.wallet.signTransaction(tx);
      const signature = await this.provider.connection.sendRawTransaction(
        signedTx.serialize(),
        { preflightCommitment: commitment }
      );
      await this.provider.connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        commitment
      );
      return signature;
    } catch (err) {
      throw toSdkError("transaction failed", err, this.idlErrors);
    }
  }
}

export { ScaleSdkError };
