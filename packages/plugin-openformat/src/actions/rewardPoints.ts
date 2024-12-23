import {
    composeContext,
    generateObjectDeprecated,
    HandlerCallback,
    ModelClass,
    type IAgentRuntime,
    type Memory as BaseMemory,
    type State,
} from "@ai16z/eliza";
import { ethers } from "ethers";
import { socialToWalletProvider } from "../providers/socialToWallet";

// Export the class from a separate file
export class RewardAction {
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

export const rewardTemplate = `Based on the following conversation:

{{recentMessages}}

Determine if there is a request for points and how many points should be awarded.
If there is a specific amount requested, use that amount, otherwise use 10 points.

Respond in JSON format with:
{
    "shouldReward": boolean,
    "amount": number
}`;

const buildRewardDetails = async (
    state: State,
    runtime: IAgentRuntime
): Promise<{ shouldReward: boolean; amount: number }> => {
    const context = composeContext({
        state,
        template: rewardTemplate,
    });

    return (await generateObjectDeprecated({
        runtime,
        context,
        modelClass: ModelClass.SMALL,
    })) as { shouldReward: boolean; amount: number };
};

function formatHeaders(headers: Headers): string {
    const headerObj: Record<string, string> = {};
    headers.forEach((value, key) => {
        headerObj[key] = value;
    });
    return JSON.stringify(headerObj, null, 2);
}

/** @internal */
export const rewardAction = {
    name: "reward_points",
    description: "Rewards points to users through OpenFormat",
    handler: async (
        runtime: IAgentRuntime,
        message: BaseMemory,
        state: State,
        _options: any,
        callback?: HandlerCallback
    ) => {
        try {
            console.log("Processing reward action...");

            // Get reward details from context
            const rewardDetails = await buildRewardDetails(state, runtime);
            console.log("Reward details:", rewardDetails);

            if (!rewardDetails.shouldReward) {
                return false;
            }

            // Get platform from message source
            const platform = message.content?.source || "discord";
            console.log("Platform detection:", {
                messageSource: message.content?.source,
                defaultedTo: platform
            });

            // Get wallet address using the provider directly
            const walletProvider = socialToWalletProvider.get;
            const providerResponse = await walletProvider(
                runtime,
                message,
                state
            );
            console.log("Provider response:", providerResponse);

            // Extract wallet address from provider response
            const match = providerResponse?.match(
                /Connected Wallet Address: (0x[a-fA-F0-9]{40})/
            );
            const walletAddress = match?.[1];
            console.log("Extracted wallet address:", walletAddress);

            if (!walletAddress) {
                if (callback) {
                    const connectUrl = "https://ai-agent-privy.vercel.app/";
                    callback({
                        text: `Please connect your ${platform} to earn points. You can do it here: ${connectUrl}`,
                    });
                }
                return false;
            }

            const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
            const action = new RewardAction(privateKey);

            // Execute reward
            const result = await action.reward(
                walletAddress,
                rewardDetails.amount
            );

            if (callback) {
                callback({
                    text: `Successfully rewarded ${rewardDetails.amount} points on ${platform}! View transaction: ${result.blockExplorerUrl}`,
                    content: {
                        success: true,
                        hash: result.hash,
                        blockExplorerUrl: result.blockExplorerUrl,
                        amount: rewardDetails.amount,
                        recipient: walletAddress,
                        platform: platform
                    },
                });
            }

            return true;
        } catch (error) {
            console.error("Error in reward action:", error);
            if (callback) {
                callback({
                    text: `Failed to reward points: ${error.message}`,
                    content: { error: error.message },
                });
            }
            return false;
        }
    },

    template: rewardTemplate,

    validate: async (runtime: IAgentRuntime) => {
        const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
        const dAppId = runtime.getSetting("OPENFORMAT_DAPP_ID");
        const apiKey = runtime.getSetting("OPENFORMAT_API_KEY");
        return !!(
            privateKey &&
            dAppId &&
            apiKey &&
            privateKey.startsWith("0x")
        );
    },

    examples: [
        [
            {
                user: "user1",
                content: {
                    text: "Can I get some reward points?",
                },
            },
            {
                user: "assistant",
                content: {
                    text: "I'll reward you 10 points!",
                    action: "reward_points",
                },
            },
        ],
        [
            {
                user: "user1",
                content: {
                    text: "reward me 50 points please",
                },
            },
            {
                user: "assistant",
                content: {
                    text: "I'll reward you 50 points!",
                    action: "reward_points",
                },
            },
        ],
    ],

    similes: ["REWARD", "GIVE_POINTS", "REWARD_XP"],
};
