# Scale SDK

TypeScript SDK for Scale AMM and Scale VMM.

## Install

```bash
npm install @scale-protocol/sdk @coral-xyz/anchor @solana/web3.js
```

## Constants

```ts
import { AMM_ADDRESS, VMM_ADDRESS, CLUSTER_RPC_URLS } from "@scale-protocol/sdk";
```

- `AMM_ADDRESS` => `SCALEwAvEK5gtkdHiFzXfPgtk2YwJxPDzaV3aDmR7tA`
- `VMM_ADDRESS` => `SCALEWoRSpVZpMRqHEcDfNvBh3nUSe34jDr9r689gLa`

## Constructors

### 1) RPC URL overload

```ts
import { Scale } from "@scale-protocol/sdk";

const sdk = new Scale("https://my-rpc.example.com", walletOptional);
```

### 2) Cluster overload (`"devnet" | "mainnet"`)

```ts
import { Scale } from "@scale-protocol/sdk";

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

## AMM quick usage

```ts
const config = await sdk.amm.getPlatformConfig();
const pool = await sdk.amm.getPoolByMints(owner, mintA, mintB);
const quote = await sdk.amm.estimateBuy(pool.address, { amount: 10_000, limit: 1 });
```

```ts
await sdk.amm.setPlatformBaseToken(baseMint);
await sdk.amm.setPlatformFee(100);
await sdk.amm.setFeeBeneficiary(beneficiary);
await sdk.amm.transferAuthority(newAuthority);
```

```ts
const createBundle = await sdk.amm.createPoolInstructions(params, mintA, mintB, options);
const swapBundle = await sdk.amm.buyInstructions(poolAddress, { amount: 10_000, limit: 1 }, options);
```

## VMM quick usage

```ts
const config = await sdk.vmm.getPlatformConfig();
const pair = await sdk.vmm.getPairByMints(mintA, mintB);
const quote = await sdk.vmm.estimateSell(pair.address, { amount: 10_000, limit: 1 });
```

```ts
await sdk.vmm.setPlatformBaseToken(baseMint);
await sdk.vmm.setPlatformFee(100);
await sdk.vmm.setFeeBeneficiary(beneficiary);
await sdk.vmm.setGraduationThreshold(1_000_000);
await sdk.vmm.transferAuthority(newAuthority);
```

```ts
const createBundle = await sdk.vmm.createPairInstructions(params, mintA, mintB, options);
const swapBundle = await sdk.vmm.sellInstructions(pairAddress, { amount: 10_000, limit: 1 }, options);
```

## Public API map

### `Scale`
- `new Scale(connection, wallet, options)`
- `new Scale(rpcUrl, wallet?, options?)`
- `new Scale("devnet" | "mainnet", wallet?, options?)`
- `amm`, `vmm`, `loadAmm`, `loadVmm`, `launch`, `launchInstructions`

### `ScaleAmm`
- Read-only: `getConfigAddress`, `getPoolAddress`, `getVaultAddress`, `getPlatformConfig`, `getPlatformBaseToken`, `getPool*`, `getFee*`, `estimateBuy`, `estimateSell`
- Execute: `setPlatformBaseToken`, `setPlatformFee`, `setFeeBeneficiary`, `transferAuthority`, `createPool`, `buy`, `sell`
- Instruction builders: `setPlatformBaseTokenInstruction`, `setPlatformFeeInstruction`, `setFeeBeneficiaryInstruction`, `transferAuthorityInstruction`, `createPoolInstructions`, `createWithDevBuyInstructions`, `buyInstructions`, `sellInstructions`

### `ScaleVmm`
- Read-only: `getConfigAddress`, `getPairAddress`, `getVaultAddress`, `getAmmPoolAddress`, `getAmmVaultAddress`, `getPlatformConfig`, `getPlatformConfigView`, `getPlatformBaseToken`, `getGraduationThreshold`, `getPair*`, `getFee*`, `estimateBuy`, `estimateSell`
- Execute: `setPlatformBaseToken`, `setPlatformFee`, `setFeeBeneficiary`, `setGraduationThreshold`, `transferAuthority`, `createPair`, `buy`, `sell`
- Instruction builders: `setPlatformBaseTokenInstruction`, `setPlatformFeeInstruction`, `setFeeBeneficiaryInstruction`, `setGraduationThresholdInstruction`, `transferAuthorityInstruction`, `createPairInstructions`, `createWithDevBuyInstructions`, `buyInstructions`, `sellInstructions`
