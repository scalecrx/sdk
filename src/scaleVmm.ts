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
  CreatePairInstructionResult,
  CreatePairOptions,
  CreatePairParamsInput,
  CurveTypeInput,
  CreatePairWithDevBuyInstructionResult,
  EstimateResult,
  PairAddress,
  PairRef,
  SwapInstructionResult,
  SwapParamsInput,
  VmmSwapOptions,
} from "./types";
import {
  getConfigAddress,
  getPairAddress,
  getPoolAddress,
  getTokenProgramForMint,
  getVaultAddress,
  maybeCreateAtaInstruction,
  toBN,
  transferSolInstruction,
} from "./utils";
import { ScaleSdkError, toSdkError } from "./errors";
import idl from "./idl/scale_vmm.json";

export type PairAccount = {
  enabled: boolean;
  graduated: boolean;
  mintA: PublicKey;
  mintB: PublicKey;
  tokenAReserves: BN;
  tokenBReserves: BN;
  shift: BN;
  curve: CurveTypeInput;
  bump: number;
  feeBeneficiaryCount: number;
  feeBeneficiaries: Array<{ wallet: PublicKey; shareBps: number }>;
  ammPool: PublicKey;
};

export class ScaleVmm {
  readonly provider: AnchorProvider;
  readonly programId: PublicKey;
  readonly program: Program;
  readonly idl: Idl;
  readonly idlErrors: Map<number, string>;
  readonly ammProgramId?: PublicKey;
  readonly hasWallet: boolean;

  constructor(
    provider: AnchorProvider,
    programId: PublicKey,
    idlOverride?: Idl,
    ammProgramId?: PublicKey,
    hasWallet = true
  ) {
    this.provider = provider;
    this.programId = programId;
    const resolvedIdl = idlOverride ?? (idl as unknown as Idl);
    this.idl = { ...resolvedIdl, address: programId.toBase58() } as Idl;
    this.program = new Program(this.idl, provider);
    this.idlErrors = parseIdlErrors(this.idl);
    this.ammProgramId = ammProgramId;
    this.hasWallet = hasWallet;
  }

  getConfigAddress() {
    return getConfigAddress(this.programId);
  }

  getPairAddress(mintA: PublicKey, mintB: PublicKey) {
    return getPairAddress(this.programId, mintA, mintB);
  }

  getVaultAddress(pair: PublicKey, mint: PublicKey) {
    return getVaultAddress(this.programId, pair, mint);
  }

  getAmmPoolAddress(pair: PublicKey, mintA: PublicKey, mintB: PublicKey) {
    const programId = this.resolveAmmProgramId();
    return getPoolAddress(programId, pair, mintA, mintB);
  }

  getAmmVaultAddress(pool: PublicKey, mint: PublicKey) {
    const programId = this.resolveAmmProgramId();
    return getVaultAddress(programId, pool, mint);
  }

  async getPlatformConfig() {
    const config = this.getConfigAddress();
    try {
      return await (this.program.account as any).platformConfig.fetch(config);
    } catch (err) {
      return null;
    }
  }

  async getPlatformConfigView() {
    const config = this.getConfigAddress();
    try {
      return await (this.program.methods as any)
        .getPlatformConfig()
        .accounts({ config })
        .view();
    } catch (err) {
      return null;
    }
  }

  async getPlatformBaseToken() {
    const config = await this.getPlatformConfig();
    return config ? (config as any).baseToken as PublicKey : null;
  }

  async getGraduationThreshold() {
    const config = await this.getPlatformConfig();
    return config ? (config as any).graduationThreshold as BN : null;
  }

  async setGraduationThreshold(threshold: BN | number) {
    try {
      const instruction = await this.setGraduationThresholdInstruction(threshold);
      const tx = new Transaction().add(instruction);
      return await this.sendTransaction(tx, [], "confirmed");
    } catch (err) {
      throw toSdkError("setGraduationThreshold failed", err, this.idlErrors);
    }
  }

  async setGraduationThresholdInstruction(threshold: BN | number) {
    const config = this.getConfigAddress();

    try {
      return await this.program.methods
        .setGraduationThreshold(toBN(threshold))
        .accounts({
          authority: this.provider.wallet.publicKey,
          config,
        })
        .instruction();
    } catch (err) {
      throw toSdkError(
        "setGraduationThresholdInstruction failed",
        err,
        this.idlErrors
      );
    }
  }

  async getFeeBeneficiaries(pairInput: PairAddress | PairRef) {
    const pair = await this.resolvePair(pairInput);
    return pair.data.feeBeneficiaries.slice(0, pair.data.feeBeneficiaryCount);
  }

  async getFeeShare(pairInput: PairAddress | PairRef, wallet: PublicKey) {
    const beneficiaries = await this.getFeeBeneficiaries(pairInput);
    const entry = beneficiaries.find((beneficiary) =>
      beneficiary.wallet.equals(wallet)
    );
    return entry ? entry.shareBps : 0;
  }

  async getTotalCreatorFeeBps(pairInput: PairAddress | PairRef) {
    const beneficiaries = await this.getFeeBeneficiaries(pairInput);
    return beneficiaries.reduce((acc, beneficiary) => acc + beneficiary.shareBps, 0);
  }

  async getPair(pairOrAddress: PairAddress | PairRef) {
    const resolved = await this.resolvePair(pairOrAddress);
    return resolved;
  }

  async getPairByAddress(pair: PublicKey): Promise<PairRef & { data: PairAccount }> {
    try {
      const data = (await (this.program.account as any).pairState.fetch(
        pair
      )) as PairAccount;
      return {
        address: pair,
        mintA: data.mintA,
        mintB: data.mintB,
        data,
      };
    } catch (err) {
      throw toSdkError("getPairByAddress failed", err, this.idlErrors);
    }
  }

  async getPairByMints(
    mintA: PublicKey,
    mintB: PublicKey
  ): Promise<PairRef & { data: PairAccount }> {
    const pair = this.getPairAddress(mintA, mintB);
    return this.getPairByAddress(pair);
  }

  async createPair(
    params: CreatePairParamsInput,
    mintA: PublicKey,
    mintB: PublicKey,
    options: CreatePairOptions = {}
  ) {
    try {
      const { instructions, pair, vaultA, vaultB, signers } =
        await this.createPairInstructions(params, mintA, mintB, options);
      const tx = new Transaction();
      instructions.forEach((instruction) => tx.add(instruction));
      const signature = await this.sendTransaction(tx, signers ?? [], "confirmed");
      return { pair, vaultA, vaultB, signature };
    } catch (err) {
      throw toSdkError("createPair failed", err, this.idlErrors);
    }
  }

  async createPairInstructions(
    params: CreatePairParamsInput,
    mintA: PublicKey,
    mintB: PublicKey,
    options: CreatePairOptions = {}
  ): Promise<CreatePairInstructionResult> {
    const payer = options.payer ?? this.provider.wallet.publicKey;
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

      const pair = this.getPairAddress(mintA, mintB);
      const vaultA = this.getVaultAddress(pair, mintA);
      const vaultB = this.getVaultAddress(pair, mintB);
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
          tokenWalletAuthority,
          mintA,
          mintB,
          tokenWalletB,
          pair,
          vaultA,
          vaultB,
          tokenProgramA,
          tokenProgramB,
          systemProgram: SystemProgram.programId,
          config,
        })
        .instruction();
      instructions.push(ix);

      return { instructions, pair, vaultA, vaultB, signers: options.signers };
    } catch (err) {
      throw toSdkError("createPairInstructions failed", err, this.idlErrors);
    }
  }

  async createWithDevBuyInstructions(
    params: CreatePairParamsInput,
    mintA: PublicKey,
    mintB: PublicKey,
    buyParams: SwapParamsInput,
    options: (CreatePairOptions & VmmSwapOptions) = {}
  ): Promise<CreatePairWithDevBuyInstructionResult> {
    try {
      const { instructions: createInstructions, pair, vaultA, vaultB, signers } =
        await this.createPairInstructions(params, mintA, mintB, options);

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
          tokenProgramB,
          true
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

      const ammProgramId = options.ammProgramId ?? this.ammProgramId;
      if (!ammProgramId) {
        throw new Error("ammProgramId is required for VMM swaps");
      }

      const ammPool =
        options.ammPool ?? getPoolAddress(ammProgramId, pair, mintA, mintB);
      const ammVaultA =
        options.ammVaultA ?? getVaultAddress(ammProgramId, ammPool, mintA);
      const ammVaultB =
        options.ammVaultB ?? getVaultAddress(ammProgramId, ammPool, mintB);
      const ammConfig = options.ammConfig ?? getConfigAddress(ammProgramId);
      const ix = await (this.program.methods as any).buy(swapParams)
        .accounts({
          pair,
          user,
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
          ammProgram: ammProgramId,
          ammPool,
          ammVaultA,
          ammVaultB,
          ammConfig,
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
        pair,
        vaultA,
        vaultB,
        userTokenAccountA: userTaA!,
        userTokenAccountB: userTaB!,
      };
    } catch (err) {
      console.error(err);
      throw toSdkError("createWithDevBuyInstructions failed", err, this.idlErrors);
    }
  }

  async buy(
    pairInput: PairAddress | PairRef,
    params: SwapParamsInput,
    options: VmmSwapOptions = {}
  ) {
    try {
      const { instructions, signers } = await this.buyInstructions(
        pairInput,
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
    pairInput: PairAddress | PairRef,
    params: SwapParamsInput,
    options: VmmSwapOptions = {}
  ) {
    try {
      const { instructions, signers } = await this.sellInstructions(
        pairInput,
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
    pairInput: PairAddress | PairRef,
    params: SwapParamsInput,
    options: VmmSwapOptions = {}
  ): Promise<SwapInstructionResult> {
    try {
      const pair = await this.resolvePair(pairInput);
      return await this.swapInstructions("buy", pair, params, options);
    } catch (err) {
      throw toSdkError("buyInstructions failed", err, this.idlErrors);
    }
  }

  async sellInstructions(
    pairInput: PairAddress | PairRef,
    params: SwapParamsInput,
    options: VmmSwapOptions = {}
  ): Promise<SwapInstructionResult> {
    try {
      const pair = await this.resolvePair(pairInput);
      return await this.swapInstructions("sell", pair, params, options);
    } catch (err) {
      throw toSdkError("sellInstructions failed", err, this.idlErrors);
    }
  }

  async estimateBuy(pairInput: PairAddress | PairRef, params: SwapParamsInput) {
    return this.estimate("quoteBuy", pairInput, params);
  }

  async estimateSell(pairInput: PairAddress | PairRef, params: SwapParamsInput) {
    return this.estimate("quoteSell", pairInput, params);
  }

  private async estimate(
    method: "quoteBuy" | "quoteSell",
    pairInput: PairAddress | PairRef,
    params: SwapParamsInput
  ): Promise<EstimateResult> {
    try {
      const pair = await this.resolvePair(pairInput);
      const swapParams = { amount: toBN(params.amount), limit: toBN(params.limit) };
      const config = this.getConfigAddress();

      const result = await (this.program.methods as any)
        [method](swapParams)
        .accounts({
          pair: pair.address,
          mintA: pair.mintA,
          mintB: pair.mintB,
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

  private async resolvePair(pairInput: PairAddress | PairRef) {
    if (pairInput instanceof PublicKey) {
      return this.getPairByAddress(pairInput);
    }

    return this.getPairByAddress(pairInput.address);
  }

  private async swapInstructions(
    action: "buy" | "sell",
    pair: PairRef & { data: PairAccount },
    params: SwapParamsInput,
    options: VmmSwapOptions
  ): Promise<SwapInstructionResult> {
    const swapParams = { amount: toBN(params.amount), limit: toBN(params.limit) };
    const user = this.provider.wallet.publicKey;
    const autoCreateAta = options.autoCreateAta ?? true;
    const wrapSol = options.wrapSol ?? action === "buy";
    const unwrapSol = options.unwrapSol ?? action === "sell";

    const tokenProgramA = await getTokenProgramForMint(
      this.provider.connection,
      pair.mintA
    );
    const tokenProgramB = await getTokenProgramForMint(
      this.provider.connection,
      pair.mintB
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
        pair.mintA,
        tokenProgramA
      );
      userTaA = ataResult.ata;
      if (ataResult.instruction && !autoCreateAta) {
        throw new Error(`Missing ATA for mintA: ${pair.mintA.toBase58()}`);
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
        pair.mintB,
        tokenProgramB
      );
      userTaB = ataResult.ata;
      if (ataResult.instruction && !autoCreateAta) {
        throw new Error(`Missing ATA for mintB: ${pair.mintB.toBase58()}`);
      }
      if (ataResult.instruction) {
        preInstructions.push(ataResult.instruction);
      }
    }

    const isNativeA = pair.mintA.equals(NATIVE_MINT);
    if (isNativeA && wrapSol) {
      preInstructions.push(transferSolInstruction(user, userTaA!, swapParams.amount));
      preInstructions.push(createSyncNativeInstruction(userTaA!));
    }

    if (isNativeA && unwrapSol && createdAtaA) {
      postInstructions.push(
        createCloseAccountInstruction(userTaA!, user, user)
      );
    }

    const vaultA = this.getVaultAddress(pair.address, pair.mintA);
    const vaultB = this.getVaultAddress(pair.address, pair.mintB);
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
          pair.mintA,
          tokenProgramA,
          true
        );
      platformFeeTaA = ataResult.ata;
      if (ataResult.instruction && !autoCreateAta) {
        throw new Error(
          `Missing platform fee ATA for mintA: ${pair.mintA.toBase58()}`
        );
      }
      if (ataResult.instruction) {
        preInstructions.push(ataResult.instruction);
      }
    }

    const beneficiaries = pair.data.feeBeneficiaries.slice(
      0,
      pair.data.feeBeneficiaryCount
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
            pair.mintA,
            tokenProgramA,
            true
          );
          if (ataResult.instruction && !autoCreateAta) {
            throw new Error(
              `Missing beneficiary ATA for mintA: ${pair.mintA.toBase58()}`
            );
          }
          if (ataResult.instruction) {
            preInstructions.push(ataResult.instruction);
          }
          return ataResult.ata;
        })
      ));

    const ammProgramId = options.ammProgramId ?? this.ammProgramId;
    if (!ammProgramId) {
      throw new Error("ammProgramId is required for VMM swaps");
    }

    const ammPool =
      options.ammPool ?? getPoolAddress(ammProgramId, pair.address, pair.mintA, pair.mintB);
    const ammVaultA =
      options.ammVaultA ?? getVaultAddress(ammProgramId, ammPool, pair.mintA);
    const ammVaultB =
      options.ammVaultB ?? getVaultAddress(ammProgramId, ammPool, pair.mintB);
    const ammConfig = options.ammConfig ?? getConfigAddress(ammProgramId);
    const ix = await (this.program.methods as any)[action](swapParams)
      .accounts({
        pair: pair.address,
        user,
        mintA: pair.mintA,
        mintB: pair.mintB,
        userTaA,
        userTaB,
        vaultA,
        vaultB,
        platformFeeTaA,
        tokenProgramA,
        tokenProgramB,
        systemProgram: SystemProgram.programId,
        config,
        ammProgram: ammProgramId,
        ammPool,
        ammVaultA,
        ammVaultB,
        ammConfig,
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

  private resolveAmmProgramId() {
    if (!this.ammProgramId) {
      throw new Error("ammProgramId is required for AMM derivations");
    }
    return this.ammProgramId;
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
      return await this.provider.sendAndConfirm(tx, signers, { commitment });
    } catch (err) {
      throw toSdkError("transaction failed", err, this.idlErrors);
    }
  }
}

export { ScaleSdkError };
