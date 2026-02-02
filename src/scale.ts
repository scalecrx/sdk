import {
  AnchorProvider,
  Idl,
  Program,
  Wallet,
} from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

import { ScaleAmm } from "./scaleAmm";
import { ScaleVmm } from "./scaleVmm";
import ammIdl from "./idl/scale_amm.json";
import vmmIdl from "./idl/scale_vmm.json";
import { AMM_ADDRESS, CLUSTER_RPC_URLS, ScaleCluster, VMM_ADDRESS } from "./constants";

export type ScaleOptions = {
  ammProgramId?: PublicKey;
  vmmProgramId?: PublicKey;
  ammIdl?: Idl;
  vmmIdl?: Idl;
  programId?: PublicKey;
  idl?: Idl;
  providerOptions?: ConstructorParameters<typeof AnchorProvider>[2];
};

class ReadonlyWallet implements Wallet {
  readonly publicKey: PublicKey;
  readonly payer: Keypair;

  constructor(publicKey: PublicKey = Keypair.generate().publicKey) {
    this.publicKey = publicKey;
    this.payer = Keypair.generate();
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    _tx: T
  ): Promise<T> {
    throw new Error(
      "No wallet was provided. Use a constructor overload with wallet for direct execution."
    );
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    _txs: T[]
  ): Promise<T[]> {
    throw new Error(
      "No wallet was provided. Use a constructor overload with wallet for direct execution."
    );
  }
}

export class Scale {
  readonly connection: Connection;
  readonly wallet: Wallet;
  readonly hasWallet: boolean;
  readonly provider: AnchorProvider;
  readonly ammIdl: Idl;
  readonly vmmIdl: Idl;
  readonly ammProgramId: PublicKey;
  readonly vmmProgramId: PublicKey;
  readonly amm: ScaleAmm;
  readonly vmm: ScaleVmm;

  constructor(connection: Connection, wallet: Wallet, options?: ScaleOptions);
  constructor(rpcUrl: string, wallet?: Wallet, options?: ScaleOptions);
  constructor(cluster: ScaleCluster, wallet?: Wallet, options?: ScaleOptions);
  constructor(
    connectionOrRpcOrCluster: Connection | string,
    wallet?: Wallet,
    options: ScaleOptions = {}
  ) {
    const connection =
      connectionOrRpcOrCluster instanceof Connection
        ? connectionOrRpcOrCluster
        : new Connection(
            connectionOrRpcOrCluster === "mainnet" ||
              connectionOrRpcOrCluster === "devnet"
              ? CLUSTER_RPC_URLS[connectionOrRpcOrCluster]
              : connectionOrRpcOrCluster,
            options.providerOptions?.commitment ?? "confirmed"
          );

    const resolvedWallet = wallet ?? new ReadonlyWallet();

    this.connection = connection;
    this.wallet = resolvedWallet;
    this.hasWallet = Boolean(wallet);
    this.provider = new AnchorProvider(
      connection,
      resolvedWallet,
      options.providerOptions
    );
    this.ammIdl = options.ammIdl ?? options.idl ?? (ammIdl as unknown as Idl);
    this.vmmIdl = options.vmmIdl ?? (vmmIdl as unknown as Idl);
    this.ammProgramId =
      options.ammProgramId ??
      options.programId ??
      AMM_ADDRESS;
    this.vmmProgramId =
      options.vmmProgramId ??
      VMM_ADDRESS;
    this.amm = new ScaleAmm(
      this.provider,
      this.ammProgramId,
      this.ammIdl,
      this.hasWallet
    );
    this.vmm = new ScaleVmm(
      this.provider,
      this.vmmProgramId,
      this.vmmIdl,
      this.ammProgramId,
      this.hasWallet
    );
  }

  loadAmm(programId: PublicKey = this.ammProgramId, idlOverride?: Idl) {
    const resolvedIdl = idlOverride ?? this.ammIdl;
    return new ScaleAmm(this.provider, programId, resolvedIdl, this.hasWallet);
  }

  loadVmm(programId: PublicKey = this.vmmProgramId, idlOverride?: Idl) {
    const resolvedIdl = idlOverride ?? this.vmmIdl;
    return new ScaleVmm(
      this.provider,
      programId,
      resolvedIdl,
      this.ammProgramId,
      this.hasWallet
    );
  }

  load(programId: PublicKey = this.ammProgramId, idlOverride?: Idl) {
    return this.loadAmm(programId, idlOverride);
  }
}

export const createAmmProgram = (
  provider: AnchorProvider,
  programId: PublicKey,
  idlOverride?: Idl
) => {
  const resolvedIdl = idlOverride ?? (ammIdl as unknown as Idl);
  const idlWithAddress = {
    ...resolvedIdl,
    address: programId.toBase58(),
  } as Idl;
  return new Program(idlWithAddress, provider);
};

export const createVmmProgram = (
  provider: AnchorProvider,
  programId: PublicKey,
  idlOverride?: Idl
) => {
  const resolvedIdl = idlOverride ?? (vmmIdl as unknown as Idl);
  const idlWithAddress = {
    ...resolvedIdl,
    address: programId.toBase58(),
  } as Idl;
  return new Program(idlWithAddress, provider);
};

export const createScaleProgram = createAmmProgram;
