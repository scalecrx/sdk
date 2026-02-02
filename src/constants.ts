import { PublicKey } from "@solana/web3.js";

export const AMM_ADDRESS = new PublicKey(
  "SCALEwAvEK5gtkdHiFzXfPgtk2YwJxPDzaV3aDmR7tA"
);
export const VMM_ADDRESS = new PublicKey(
  "SCALEWoRSpVZpMRqHEcDfNvBh3nUSe34jDr9r689gLa"
);

export const CLUSTER_RPC_URLS = {
  devnet: "https://api.devnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
} as const;

export type ScaleCluster = keyof typeof CLUSTER_RPC_URLS;
