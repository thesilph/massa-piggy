/* eslint-disable */

import { Storage, Context, generateEvent, Address, transferCoins, asyncCall, deferredCallCancel, Slot } from "@massalabs/massa-as-sdk";
import { Args } from "@massalabs/as-types"; // For serializing complex data
import { DONATION_ADDRESS, PROTOCOL_PROFIT_ADDRESS } from "./config";

// Constants
const GRACE_PERIOD_SECONDS: u64 = 24 * 3600; // 24 hours
const REQUIRED_CHECKINS: u64 = 100; // 100 days (or 100 check-ins)

const MIN_DEPOSIT_AMOUNT: u64 = 5_000_000_000; // 5 MAS (5 * 10^9 smallest units)
                                             // Make sure this is sufficient to cover ASC_FEE and contribute to contract balance.
              

const PROTOCOL_FEE_PER_DEPOSIT: u64 = 100_000_000; // Example: 0.1 MAS (100 million smallest units)
                                                // This is deducted from the MIN_DEPOSIT_AMOUNT


// Define Massa's slot duration (0.5 seconds per slot)
const MASSA_SLOT_DURATION_SECONDS: u64 = 1; // It's 0.5s for thread, but Context.blockTimestamp() advances by ~1s for each block, so using 1 for easier calculation with seconds.
const ASC_MAX_GAS: u64 = 5_000_000; // A reasonably generous max gas for the ASC execution. Adjust based on testing.
const ASC_FEE: u64 = 500_000; // 0.0005 MAS, a reasonable fee to ensure execution priority for this critical ASC. Adjust based on testing.


// Data structure for each user's deposit
class UserDeposit {
  amount: u64; // Total MAS deposited
  last_checkin_timestamp: u64;
  checkin_count: u64;
  is_active: bool; // True if not perished

  constructor(
    amount: u64 = 0,
    last_checkin_timestamp: u64 = 0,
    checkin_count: u64 = 0,
    is_active: bool = true
  ) {
    this.amount = amount;
    this.last_checkin_timestamp = last_checkin_timestamp;
    this.checkin_count = checkin_count;
    this.is_active = is_active;
  }

  // Serialization/Deserialization for storage (Massa AS-SDK provides helpers for Args)
  // You'll need to implement toBytes and fromBytes or use Args directly
  toByte(): StaticArray<u8> {
    return new Args()
      .add(this.amount)
      .add(this.last_checkin_timestamp)
      .add(this.checkin_count)
      .add(this.is_active)
      .serialize();
  }

  static fromByte(data: StaticArray<u8>): UserDeposit {
    const args = new Args(data);
    return new UserDeposit(
      args.nextU64().unwrap(),
      args.nextU64().unwrap(),
      args.nextU64().unwrap(),
      args.nextBool().unwrap()
    );
  }
}

// Helper to get user data from storage
function getUserDeposit(userAddress: Address): UserDeposit {
  const key = userAddress.serialize();
  if (Storage.has(key)) {
    return UserDeposit.fromByte(Storage.get(key));
  }
  return new UserDeposit(); // Default if no record
}

// Helper to set user data to storage
function setUserDeposit(userAddress: Address, data: UserDeposit): void {
  const key = userAddress.serialize();
  Storage.set(key, data.toByte());
}


export function deposit(): void {
    const caller = Context.caller();
    const amount = Context.transferredCoins(); // Total MAS sent for deposit

    // Assert that the minimum deposit amount is met for any interaction
    assert(amount >= MIN_DEPOSIT_AMOUNT, `Deposit amount must be at least ${MIN_DEPOSIT_AMOUNT} MAS units to act as a check-in.`);

    let userData = getUserDeposit(caller);
    let netDepositAmount = amount; // The entire amount sent by the user adds to their balance

    // Transfer the protocol fee FIRST
    transferCoins(PROTOCOL_PROFIT_ADDRESS, PROTOCOL_FEE_PER_DEPOSIT);
    netDepositAmount -= PROTOCOL_FEE_PER_DEPOSIT; // Deduct the profit fee from the amount that goes to the user's balance
    generateEvent(`Protocol Fee Collected: ${PROTOCOL_FEE_PER_DEPOSIT} MAS sent to ${PROTOCOL_PROFIT_ADDRESS.toString()}`);


    if (userData.amount == 0 && !userData.is_active) {
        // This means it's a completely new commitment. Initialize state.
        userData.checkin_count = 0;
        userData.is_active = true;
    } else {
        assert(userData.is_active, "Cannot deposit to a perished account.");
    }

    userData.amount += netDepositAmount; // Add the *entire* net deposit to the user's balance
    userData.last_checkin_timestamp = Context.timestamp(); // This is the "check-in" action!
    userData.checkin_count += 1; // Increment check-in count with every deposit

    setUserDeposit(caller, userData);

    generateEvent(`Deposit/CheckIn: ${caller.toString()} deposited ${netDepositAmount} MAS. Total: ${userData.amount}. Check-ins: ${userData.checkin_count}.`);
}

// Helper function to schedule/reschedule the ASC
function scheduleCheckinASC(): void {

    // Calculate target slot for execution
    const currentSlot = Context.currentPeriod();
    const currentThread = Context.currentThread();
    const startPeriod = currentSlot + 86400;
    const endPeriod = startPeriod + 300; // 300 seconds execution window 

    const validityStartSlot = new Slot(startPeriod, currentThread);
    const validityEndSlot = new Slot(endPeriod, currentThread); // Use the same thread as current for simplicity


    // Schedule the ASC to call checkAndPerish function on THIS contract
    asyncCall(
        Context.callee(), // Target contract (this contract)
        "checkAndPerishAll", // Target function name
        validityStartSlot, // Earliest slot for execution
        validityEndSlot, // Latest slot for execution
        ASC_MAX_GAS, // Max gas for the checkAndPerishAll execution
        ASC_FEE, // Fee to be burned for this async message
        undefined, // Function parameters
        0 // coins: No MAS transferred with the async message itself
        // filterAddress and filterKey are optional, not needed here
    );
}

export function checkAndPerishAll(): void {
    // IMPORTANT: This function should only be callable by the scheduled ASC itself.
    assert(Context.caller() == Context.callee(), "This function can only be called by a scheduled ASC from this contract.");
    
    let userIds = Storage.getKeys();
    userIds.forEach((userAddressNumber, i)=> {

      let userAddress = new Address(userAddressNumber.toString());

      let userData = getUserDeposit(userAddress);

      // Only process if the account is still active and has funds
      if (!userData.is_active || userData.amount == 0) {
          // Pet already perished or no funds, nothing to do.
          generateEvent(`Check and Perish: No action for ${userAddress.toString()}.`);
          return;
      }

      // Check if the grace period has truly passed
      if (Context.timestamp() > userData.last_checkin_timestamp + GRACE_PERIOD_SECONDS) {
          // Pet has perished!
          userData.is_active = false;
          setUserDeposit(userAddress, userData);

          // Donate the funds
          transferCoins(DONATION_ADDRESS, userData.amount);
          generateEvent(`PERISHED: ${userAddress.toString()}'s funds (${userData.amount} MAS) donated to charity.`);

          // Reset balance in contract's internal record (coins were transferred)
          userData.amount = 0;
          setUserDeposit(userAddress, userData);


      } else {
          // Pet is still active, just resubmit the check. This might happen if
          generateEvent(`Check and Perish: ${userAddress.toString()} is still alive.`);
      }
    })
}

export function withdraw(amount: u64): void {
    const caller = Context.caller();
    let userData = getUserDeposit(caller);

    assert(userData.is_active, "Cannot withdraw from a perished account.");
    assert(userData.amount >= amount, "Insufficient funds to withdraw.");
    assert(amount > 0, "Withdrawal amount must be greater than 0.");

    if (userData.checkin_count >= REQUIRED_CHECKINS) {
        // User completed commitment, withdraw full amount
        transferCoins(caller, userData.amount);
        generateEvent(`Withdraw: ${caller.toString()} withdrew full amount (${userData.amount} MAS) after ${userData.checkin_count} days!`);
        // Clear user's record completely
        userData = new UserDeposit(); // Reset all to default

        Storage.del(caller.serialize()); // Clean up storage
    } else {
        // Partial withdrawal before completion
        transferCoins(caller, amount);
        userData.amount -= amount;
        generateEvent(`Withdraw: ${caller.toString()} withdrew ${amount} MAS. Remaining: ${userData.amount}`);

        // If amount becomes zero, consider it an "end" of commitment and clean up
        if (userData.amount == 0) {
            userData = new UserDeposit();
            Storage.del(caller.serialize()); // Clean up storage
            generateEvent(`Account cleared for ${caller.toString()} after full withdrawal.`);
        } else {
            setUserDeposit(caller, userData);
        }
    }
}

// You might also want a `view` function for users to check their current status:
export function getMyStatus(userAddress: Address): StaticArray<u8> {
    let userData = getUserDeposit(userAddress);
    return new Args()
        .add(userData.amount)
        .add(userData.last_checkin_timestamp)
        .add(userData.checkin_count)
        .add(userData.is_active)
        .serialize();
}
