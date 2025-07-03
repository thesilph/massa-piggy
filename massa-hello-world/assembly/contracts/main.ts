import { generateEvent, Storage, Context } from "@massalabs/massa-as-sdk";

const GREETING_KEY = "greeting_key";

/**
 * This function is meant to be called only one time: when the contract is deployed.
 */
export function constructor(_: StaticArray<u8>): void {
  // This line is important. It ensures that this function can't be called in the future.
  // If you remove this check, someone could call your constructor function and reset your smart contract.
  assert(Context.isDeployingContract());

  // Set the greeting message in the contract storage
  Storage.set(GREETING_KEY, "Hello, World!");

  // Emit an event to notify that the greeting message has been set
  generateEvent(`Greeting has been set`);
}