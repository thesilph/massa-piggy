import { getWallets } from "@massalabs/wallet-provider";

export async function walletExample() {
  // Get list of available wallets
  const wallets = await getWallets();

  if (wallets.length === 0) {
    console.log("No wallets found");
    return;
  }
  console.log("Available wallets:", wallets.map(wallet => wallet.name));
  // Use the first available wallet
  const wallet = wallets[0];

  // Connect to the wallet
  const connected = await wallet.connect();
  if (!connected) {
    console.log("Failed to connect to wallet");
    return;
  }

  // Get accounts
  const accounts = await wallet.accounts();
  console.log("Accounts:", accounts);

  // Listen for account changes
  wallet.listenAccountChanges((address) => {
    console.log("Account changed:", address);
  });

  // Get network info
  const networkInfo = await wallet.networkInfos();
  console.log("Network info:", networkInfo);

  // Disconnect when done
  await wallet.disconnect();
}