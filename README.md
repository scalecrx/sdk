# Scale SDK

TypeScript SDK for Scale AMM and Scale VMM.

## Install

```bash
npm install @scalecrx/sdk @coral-xyz/anchor @solana/web3.js
```

## Constants

```ts
import { AMM_ADDRESS, VMM_ADDRESS, CLUSTER_RPC_URLS } from "@scalecrx/sdk";
```

- `AMM_ADDRESS` => `SCALEwAvEK5gtkdHiFzXfPgtk2YwJxPDzaV3aDmR7tA`
- `VMM_ADDRESS` => `SCALEWoRSpVZpMRqHEcDfNvBh3nUSe34jDr9r689gLa`

## Constructors

### 1) RPC URL overload

```ts
import { Scale } from "@scalecrx/sdk";

const sdk = new Scale("https://my-rpc.example.com", walletOptional);
```

### 2) Cluster overload (`"devnet" | "mainnet"`)

```ts
import { Scale } from "@scalecrx/sdk";

const sdkDevnet = new Scale("devnet", walletOptional); // uses https://api.devnet.solana.com
const sdkMainnet = new Scale("mainnet", walletOptional); // uses https://api.mainnet-beta.solana.com
```

If wallet is omitted, read-only and instruction-building flows still work, but direct execution methods throw.

## Execution vs Instruction Builders

Every write flow has two styles:

1. **Execute now** (requires wallet):

```ts
await sdk.amm.buy(poolAddress, { amount: 1_000, limit: 1 }, opts);
```

2. **Return instructions only** (no send):

```ts
const bundle = await sdk.amm.buyInstructions(poolAddress, { amount: 1_000, limit: 1 }, opts);
// bundle.instructions -> add to Transaction yourself
```

Same pattern exists for AMM and VMM (`buy/sell/create*`, plus config instruction builders).

## Supported Curves (on-chain)

Pool/pair creation supports exactly two curve configs:

- `constantProduct`: standard x*y=k style curve.
- `exponential`: steeper curve profile than constant product for the same inputs.

Use one of:

```ts
{ constantProduct: {} }
// or
{ exponential: {} }
```

## Parameter Reference

### Common numeric types

- Most numeric args are `number | BN`.
- On-chain values are integer base units (raw token units), not UI decimals.

### Creation params (`CreatePoolParamsInput` / `CreatePairParamsInput`)

- `shift`: virtual token A liquidity shift used by curve math.
- `initialTokenBReserves`: initial token B reserves deposited for create.
- `curve`: `{ constantProduct: {} } | { exponential: {} }`.
- `feeBeneficiaries`: array of `{ wallet: PublicKey, shareBps: number }`.

### Create options (AMM: `CreatePoolOptions`, VMM: `CreatePairOptions`)

- `payer?`: transaction payer (defaults to SDK wallet public key).
- `owner?` (AMM only): pool owner PDA seed input (defaults to SDK wallet).
- `tokenWalletB?`: token B source account for create.
- `tokenWalletAuthority?`: authority for `tokenWalletB` transfers.
- `signers?`: extra signers appended to returned bundle/send.

### Swap params (`SwapParamsInput`)

- `amount`: input amount in raw units.
- `limit`: slippage guard / minimum-out style bound enforced by program.

### Swap options (`SwapOptions`)

- `userTokenAccountA?`, `userTokenAccountB?`: user token accounts override.
- `platformFeeTokenAccount?`: explicit platform fee token A account.
- `beneficiaryTokenAccounts?`: explicit creator fee accounts (order-sensitive).
- `wrapSol?`: wrap SOL into WSOL before swap when mint A is native.
- `unwrapSol?`: unwrap WSOL after swap when mint A is native.
- `autoCreateAta?`: auto-create missing ATAs (default true).

### VMM swap extension (`VmmSwapOptions`)

In addition to `SwapOptions`, VMM accepts AMM-routing overrides used for graduation-aware paths:

- `ammProgramId?`, `ammPool?`, `ammVaultA?`, `ammVaultB?`
- `ammConfig?`, `ammTokenProgramA?`, `ammTokenProgramB?`

### SDK constructor options (`ScaleOptions`)

- `ammProgramId?`, `vmmProgramId?`: override default vanity program IDs.
- `ammIdl?`, `vmmIdl?`: IDL overrides.
- `programId?`, `idl?`: legacy AMM alias fallback.
- `providerOptions?`: Anchor provider confirmation/preflight options.

## AMM quick usage

```ts
const config = await sdk.amm.getPlatformConfig();
const pool = await sdk.amm.getPoolByMints(owner, mintA, mintB);
const quote = await sdk.amm.estimateBuy(pool.address, { amount: 10_000, limit: 1 });
```

```ts
const createBundle = await sdk.amm.createPoolInstructions(
  {
    shift: 1_000_000,
    initialTokenBReserves: 100_000,
    curve: { constantProduct: {} },
    feeBeneficiaries: [],
  },
  mintA,
  mintB,
  {
    payer,
    owner,
    tokenWalletB,
    tokenWalletAuthority,
  }
);

const swapBundle = await sdk.amm.buyInstructions(
  poolAddress,
  { amount: 10_000, limit: 1 },
  {
    userTokenAccountA,
    userTokenAccountB,
    platformFeeTokenAccount,
    beneficiaryTokenAccounts,
    wrapSol: true,
    unwrapSol: false,
    autoCreateAta: true,
  }
);
```

## VMM quick usage

```ts
const config = await sdk.vmm.getPlatformConfig();
const pair = await sdk.vmm.getPairByMints(mintA, mintB);
const quote = await sdk.vmm.estimateSell(pair.address, { amount: 10_000, limit: 1 });
```

```ts
const createBundle = await sdk.vmm.createPairInstructions(
  {
    shift: 1_000_000,
    initialTokenBReserves: 100_000,
    curve: { exponential: {} },
    feeBeneficiaries: [],
  },
  mintA,
  mintB,
  {
    payer,
    tokenWalletB,
    tokenWalletAuthority,
  }
);

const swapBundle = await sdk.vmm.sellInstructions(
  pairAddress,
  { amount: 10_000, limit: 1 },
  {
    userTokenAccountA,
    userTokenAccountB,
    platformFeeTokenAccount,
    beneficiaryTokenAccounts,
    autoCreateAta: true,
  }
);
```

## Public API map

### `Scale`
- `new Scale(connection, wallet, options)`
- `new Scale(rpcUrl, wallet?, options?)`
- `new Scale("devnet" | "mainnet", wallet?, options?)`
- `amm`, `vmm`, `loadAmm`, `loadVmm`
  - `loadAmm(programId?, idlOverride?)`
  - `loadVmm(programId?, idlOverride?)`

### `ScaleAmm`
- Read-only: `getConfigAddress`, `getPoolAddress`, `getVaultAddress`, `getPlatformConfig`, `getPlatformBaseToken`, `getPool*`, `getFee*`, `estimateBuy`, `estimateSell`
- Execute: `createPool`, `buy`, `sell`
- Instruction builders: `createPoolInstructions`, `createWithDevBuyInstructions`, `buyInstructions`, `sellInstructions`
  - `createPool(params, mintA, mintB, options?)`
  - `createPoolInstructions(params, mintA, mintB, options?)`
  - `createWithDevBuyInstructions(params, mintA, mintB, buyParams, options?)`
  - `buy(poolInput, params, options?)`
  - `sell(poolInput, params, options?)`
  - `buyInstructions(poolInput, params, options?)`
  - `sellInstructions(poolInput, params, options?)`

### `ScaleVmm`
- Read-only: `getConfigAddress`, `getPairAddress`, `getVaultAddress`, `getAmmPoolAddress`, `getAmmVaultAddress`, `getPlatformConfig`, `getPlatformConfigView`, `getPlatformBaseToken`, `getGraduationThreshold`, `getPair*`, `getFee*`, `estimateBuy`, `estimateSell`
- Execute: `setGraduationThreshold`, `createPair`, `buy`, `sell`
- Instruction builders: `setGraduationThresholdInstruction`, `createPairInstructions`, `createWithDevBuyInstructions`, `buyInstructions`, `sellInstructions`
  - `setGraduationThreshold(threshold)`
  - `setGraduationThresholdInstruction(threshold)`
  - `createPair(params, mintA, mintB, options?)`
  - `createPairInstructions(params, mintA, mintB, options?)`
  - `createWithDevBuyInstructions(params, mintA, mintB, buyParams, options?)`
  - `buy(pairInput, params, options?)`
  - `sell(pairInput, params, options?)`
  - `buyInstructions(pairInput, params, options?)`
  - `sellInstructions(pairInput, params, options?)`
