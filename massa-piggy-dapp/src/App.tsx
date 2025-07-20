import { bytesToStr, JsonRPCClient } from "@massalabs/massa-web3";
import { useEffect, useState } from "react";
import { MassaLogo } from "@massalabs/react-ui-kit";
import './App.css';

const sc_addr = import.meta.env.VITE_contract; 

/**
 * The key used to store the greeting in the smart contract
 */
const GREETING_KEY = "greeting_key";

/**
 * App component that handles interactions with a Massa smart contract
 * @returns The rendered component
 */
function App() {

  const [greeting, setGreeting] = useState<string | null>(null);

  /**
 * Initialize the web3 client
 */
  const client = JsonRPCClient.buildnet()

  /**
   * Fetch the greeting when the web3 client is initialized
   */
  useEffect(() => {
    getGreeting();
  });

  /**
   * Function to get the current greeting from the smart contract
   */
  async function getGreeting() {
    if (client) {
      const dataStoreVal = await client.getDatastoreEntry(GREETING_KEY, sc_addr, false)
      const greetingDecoded = dataStoreVal ? bytesToStr(dataStoreVal) : null;
      setGreeting(greetingDecoded);
    }
  }

  return (
    <>
      <div>
        <MassaLogo className="logo" size={100} />
        <h2>Greeting message:</h2>
        <h1>{greeting}</h1>
      </div>
    </>
  );
}

export default App;



