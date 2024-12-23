import { type Memory, type Provider, type State, type IAgentRuntime } from "@ai16z/eliza";
import { PrivyClient } from "@privy-io/server-auth";

if (!process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET) {
    throw new Error("Privy app ID or secret is not set");
}

const privyClient = new PrivyClient(
    process.env.PRIVY_APP_ID,
    process.env.PRIVY_APP_SECRET
);

export const socialToWalletProvider: Provider = {
    async get(
        runtime: IAgentRuntime,
        message: Memory,
        state?: State
    ): Promise<string | null> {
        try {
            // Get the account info from state which should contain user details
            const account = await runtime.databaseAdapter.getAccountById(message.userId);

            if (!account?.username) {
                return "No username found for this user.";
            }

            // Search for the user by their discord handle
            const user = await privyClient.getUserByDiscordUsername(account.username);

            if (!user) {
                return `No Privy account found for user ${account.username}. You can create one at https://ai-agent-privy.vercel.app/`;
            }

            // Check if they have a linked wallet
            const walletAccount = user.linkedAccounts.find(account => account.type === "wallet");

            if (!walletAccount?.address) {
                return `User ${account.username} has not connected a wallet to their Privy account. You can connect one at https://ai-agent-privy.vercel.app/`;
            }

            return `User: ${account.username}\nConnected Wallet Address: ${walletAccount.address}`;

        } catch (error) {
            console.error("Error in Privy wallet provider:", error);
            return "Error accessing wallet information.";
        }
    },
};