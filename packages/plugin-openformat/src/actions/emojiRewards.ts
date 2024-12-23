import {
    HandlerCallback,
    type IAgentRuntime,
    type Memory,
    type State,
} from "@ai16z/eliza";
import { ethers } from "ethers";
import { socialToWalletProvider } from "../providers";

// TODO Get this to work since it currently doesnt
class RewardAction {
    constructor(private privateKey: string) {}

    async reward(walletAddress: string, amount: number): Promise<any> {
        console.log("Starting reward process:", { walletAddress, amount });
        try {
            const wallet = new ethers.Wallet(this.privateKey);
            console.log("Wallet initialized");

            // Create reward transaction
            console.log("Making API request to OpenFormat...");
            const res = await fetch(
                "https://api.openformat.tech/v1/reward/XP",
                {
                    method: "POST",
                    headers: {
                        "X-API-KEY": process.env.OPENFORMAT_API_KEY!,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        app_id: process.env.OPENFORMAT_DAPP_ID,
                        action_id: "reward_interaction",
                        receiver: walletAddress,
                        amount: amount,
                        chain: "arbitrum-sepolia",
                    }),
                }
            );

            console.log("API Response status:", res.status);
            const responseText = await res.text();
            console.log("API Response body:", responseText);

            if (!res.ok) {
                console.error("OpenFormat API error details:", {
                    status: res.status,
                    statusText: res.statusText,
                    body: responseText,
                    headers: formatHeaders(res.headers),
                    requestBody: {
                        app_id: process.env.OPENFORMAT_DAPP_ID,
                        action_id: "reward_interaction",
                        receiver: walletAddress,
                        amount: amount,
                        chain: "arbitrum-sepolia",
                    },
                });
                throw new Error(
                    `OpenFormat API error: ${res.statusText}\nResponse: ${responseText}`
                );
            }

            const data = JSON.parse(responseText);
            console.log("Parsed API response:", data);

            console.log("Signing transaction...");
            const signedTransaction = await wallet.signTransaction(
                data.unsignedTransaction
            );
            console.log("Transaction signed");

            // Broadcast transaction
            console.log("Broadcasting transaction...");
            const broadcast = await fetch(
                "https://api.openformat.tech/v1/transactions/execute-and-wait",
                {
                    method: "POST",
                    headers: {
                        "X-API-KEY": process.env.OPENFORMAT_API_KEY!,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        signed_transaction: signedTransaction,
                        chain: "arbitrum-sepolia",
                    }),
                }
            );

            console.log("Broadcast response status:", broadcast.status);
            const broadcastText = await broadcast.text();
            console.log("Broadcast response body:", broadcastText);

            if (!broadcast.ok) {
                console.error("Transaction broadcast error details:", {
                    status: broadcast.status,
                    statusText: broadcast.statusText,
                    body: broadcastText,
                    headers: formatHeaders(broadcast.headers),
                });
                throw new Error(
                    `Transaction broadcast failed: ${broadcast.statusText}\nResponse: ${broadcastText}`
                );
            }

            const broadcastData = JSON.parse(broadcastText);
            console.log("Parsed broadcast response:", broadcastData);

            return {
                hash: broadcastData.transactionHash,
                blockExplorerUrl: broadcastData.blockExplorerUrl,
                status: broadcastData.status,
                receipt: broadcastData.receipt
            };
        } catch (error) {
            console.error("Detailed error in reward action:", {
                error,
                stack: error.stack,
                privateKeyLength: this.privateKey?.length,
                envVars: {
                    hasApiKey: !!process.env.OPENFORMAT_API_KEY,
                    hasDappId: !!process.env.OPENFORMAT_DAPP_ID,
                },
            });
            throw error;
        }
    }
}

function formatHeaders(headers: Headers): string {
    const headerObj: Record<string, string> = {};
    headers.forEach((value, key) => {
        headerObj[key] = value;
    });
    return JSON.stringify(headerObj, null, 2);
}

export const emojiRewardAction = {
    name: "emoji_reaction_reward",
    description: "Rewards points when a fire emoji reaction is added to a message",
    similes: ["reward points for fire reactions", "give points for fire emoji"],
    examples: [
        [
            {
                user: "assistant",
                content: {
                    text: "I'll reward 10 points for that fire reaction! 🔥",
                    action: "emoji_reaction_reward"
                }
            },
            {
                user: "user",
                content: {
                    text: "🔥",
                    reaction: "🔥",
                    action: "emoji_reaction_reward"
                }
            }
        ]
    ],
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: any,
        callback?: HandlerCallback
    ) => {
        try {
            console.log("Processing emoji reward action...");
            console.log("Message content:", message.content); // Debug log

            // Check if this is an emoji reaction and it's the fire emoji
            if (!message.content.reaction || message.content.reaction !== "🔥") {
                console.log("No fire emoji reaction found"); // Debug log
                return false;
            }

            // Get wallet address using the provider
            const walletProvider = socialToWalletProvider.get;
            if (!walletProvider) {
                console.log("No wallet provider found");
                return false;
            }

            const providerResponse = await walletProvider(runtime, message, state);
            console.log("Provider response:", providerResponse);

            // Extract wallet address from provider response
            const match = providerResponse?.match(/Connected Wallet Address: (0x[a-fA-F0-9]{40})/);
            const walletAddress = match?.[1];
            console.log("Extracted wallet address:", walletAddress);

            if (!walletAddress) {
                console.log("No wallet address found");
                return false;
            }

            const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
            if (!privateKey) {
                console.log("No private key found in settings");
                return false;
            }

            const action = new RewardAction(privateKey);
            const rewardAmount = 10; // Fixed amount for emoji reactions

            // Execute reward
            const result = await action.reward(walletAddress, rewardAmount);
            console.log("Reward result:", result);

            if (callback) {
                const account = await runtime.databaseAdapter.getAccountById(message.userId);
                const username = account?.username || "User";
                callback({
                    text: `${username} received ${rewardAmount} points for their fire message! 🔥\nView transaction: ${result.blockExplorerUrl}`,
                    content: {
                        success: true,
                        hash: result.hash,
                        blockExplorerUrl: result.blockExplorerUrl,
                        amount: rewardAmount,
                        recipient: walletAddress,
                    },
                });
            }

            return true;
        } catch (error) {
            console.error("Error in emoji reward action:", error);
            return false;
        }
    },

    validate: async (runtime: IAgentRuntime) => {
        const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
        const dAppId = runtime.getSetting("OPENFORMAT_DAPP_ID");
        const apiKey = runtime.getSetting("OPENFORMAT_API_KEY");
        return !!(privateKey && dAppId && apiKey && privateKey.startsWith("0x"));
    },
};