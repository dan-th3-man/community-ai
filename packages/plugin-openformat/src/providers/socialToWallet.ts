import { type Memory, type Provider, type State, type IAgentRuntime } from "@ai16z/eliza";
import { PrivyClient } from "@privy-io/server-auth";
import { type Account as BaseAccount } from "@ai16z/eliza";

interface ExtendedAccount extends BaseAccount {
    platform: "telegram" | "discord";
}

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
            const account = await runtime.databaseAdapter.getAccountById(message.userId);
            if (!account?.username) {
                return "No username found for this user.";
            }

            // Get platform from message source
            const isTelegram = message.content?.source === "telegram";
            let user;

            console.log("SocialToWallet - Platform detection:", {
                messageSource: message.content?.source,
                username: account.username,
                isTelegram
            });

            if (isTelegram) {
                // Search for user by Telegram username
                user = await privyClient.getUserByTelegramUsername(account.username);
            } else {
                // Default to Discord search
                user = await privyClient.getUserByDiscordUsername(account.username);
            }

            if (!user) {
                return `No Privy account found for ${isTelegram ? "Telegram" : "Discord"} user ${account.username}. You can create one at https://ai-agent-privy.vercel.app/`;
            }

            // Check if they have a linked wallet
            const walletAccount = user.linkedAccounts.find(account => account.type === "wallet");

            if (!walletAccount?.address) {
                return `User ${account.username} has not connected a wallet to their Privy account. You can connect one at https://ai-agent-privy.vercel.app/`;
            }

            return `User: ${account.username}\nPlatform: ${isTelegram ? "Telegram" : "Discord"}\nConnected Wallet Address: ${walletAccount.address}`;
        } catch (error) {
            console.error("Error in socialToWallet provider:", error);
            return `Error getting wallet info: ${error.message}`;
        }
    }
};