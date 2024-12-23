import {
    composeContext,
    generateObjectDeprecated,
    HandlerCallback,
    ModelClass,
    type IAgentRuntime,
    type Memory,
    type State,
} from "@ai16z/eliza";
import { ethers } from "ethers";
import { socialToWalletProvider } from "../providers/socialToWallet";

interface Badge {
    name: string;
    id: string;
    metadataURI: string;
    totalAwarded: number;
}

// Exported badge reward class
export class BadgeRewardAction {
    constructor(private privateKey: string) {}

    async fetchAvailableBadges(dAppId: string): Promise<Badge[]> {
        console.log("Fetching available badges for dApp:", dAppId);
        const query = `
            query checkbadges {
                badges(where: {app: "${dAppId}"}) {
                    name
                    id
                    metadataURI
                    totalAwarded
                }
            }
        `;

        const response = await fetch("https://subgraph.satsuma-prod.com/7238a0e24f3c/openformat--330570/open-format-arbitrum-sepolia/api", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query })
        });

        if (!response.ok) {
            throw new Error(`Subgraph query failed: ${response.statusText}`);
        }

        const data = await response.json();
        return data.data.badges;
    }

    async rewardBadge(walletAddress: string, badgeId: string, dAppId: string, apiKey: string): Promise<any> {
        console.log("Starting badge reward process:", { walletAddress, badgeId });
        try {
            const wallet = new ethers.Wallet(this.privateKey);
            console.log("Wallet initialized");

            // Create reward transaction
            console.log("Making API request to OpenFormat...");
            const res = await fetch(
                "https://api.openformat.tech/v1/reward/badge",
                {
                    method: "POST",
                    headers: {
                        "X-API-KEY": apiKey,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        app_id: dAppId,
                        badge_id: badgeId,
                        receiver: walletAddress,
                        amount: 1,
                        chain: "arbitrum-sepolia",
                        base_uri: "ipfs://",
                        action_id: "badge_reward"
                    }),
                }
            );

            console.log("API Response status:", res.status);
            const responseText = await res.text();
            console.log("API Response body:", responseText);

            if (!res.ok) {
                throw new Error(`OpenFormat API error: ${res.statusText}\nResponse: ${responseText}`);
            }

            const data = JSON.parse(responseText);
            console.log("Parsed API response:", data);

            console.log("Signing transaction...");
            const signedTransaction = await wallet.signTransaction(data.unsignedTransaction);
            console.log("Transaction signed");

            // Broadcast transaction
            console.log("Broadcasting transaction...");
            const broadcast = await fetch(
                "https://api.openformat.tech/v1/transactions/execute-and-wait",
                {
                    method: "POST",
                    headers: {
                        "X-API-KEY": apiKey,
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
                throw new Error(`Transaction broadcast failed: ${broadcast.statusText}\nResponse: ${broadcastText}`);
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
            console.error("Error in badge reward:", error);
            throw error;
        }
    }
}

export const badgeRewardTemplate = `Based on the following conversation:

{{recentMessages}}

The following badges are available:
{{availableBadges}}

Determine if the user is requesting a specific badge by name.
If they are, identify which badge they want.

Respond in JSON format with:
{
    "shouldReward": boolean,
    "badgeId": string | null,
    "badgeName": string | null
}`;

const buildBadgeRewardDetails = async (
    state: State,
    runtime: IAgentRuntime,
    badges: Badge[]
): Promise<{ shouldReward: boolean; badgeId: string | null; badgeName: string | null }> => {
    const context = composeContext({
        state,
        template: badgeRewardTemplate.replace(
            "{{availableBadges}}",
            badges.map(b => `${b.name} (ID: ${b.id})`).join("\n")
        ),
    });

    return await generateObjectDeprecated({
        runtime,
        context,
        modelClass: ModelClass.SMALL,
    }) as { shouldReward: boolean; badgeId: string | null; badgeName: string | null };
};

export const badgeRewardAction = {
    name: "reward_badge",
    description: "Rewards badges to users through OpenFormat",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: any,
        callback?: HandlerCallback
    ) => {
        try {
            console.log("Processing badge reward action...");

            const dAppId = runtime.getSetting("OPENFORMAT_DAPP_ID");
            const apiKey = runtime.getSetting("OPENFORMAT_API_KEY");
            const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");

            // Initialize action and fetch available badges
            const action = new BadgeRewardAction(privateKey);
            const availableBadges = await action.fetchAvailableBadges(dAppId);

            // Get badge reward details from context
            const rewardDetails = await buildBadgeRewardDetails(state, runtime, availableBadges);
            console.log("Badge reward details:", rewardDetails);

            if (!rewardDetails.shouldReward || !rewardDetails.badgeId) {
                return false;
            }

            // Get platform from message source
            const platform = message.content?.source || "discord";
            console.log("Platform detection:", {
                messageSource: message.content?.source,
                defaultedTo: platform
            });

            // Get wallet address using the provider
            const walletProvider = socialToWalletProvider.get;
            const providerResponse = await walletProvider(runtime, message, state);
            console.log("Provider response:", providerResponse);

            // Extract wallet address from provider response
            const match = providerResponse?.match(/Connected Wallet Address: (0x[a-fA-F0-9]{40})/);
            const walletAddress = match?.[1];
            console.log("Extracted wallet address:", walletAddress);

            if (!walletAddress) {
                if (callback) {
                    const connectUrl = "https://ai-agent-privy.vercel.app/";
                    callback({
                        text: `Please connect your ${platform} to earn badges. You can do it here: ${connectUrl}`,
                    });
                }
                return false;
            }

            // Execute badge reward
            const result = await action.rewardBadge(walletAddress, rewardDetails.badgeId, dAppId, apiKey);

            if (callback) {
                callback({
                    text: `Successfully awarded the ${rewardDetails.badgeName} badge on ${platform}! View transaction: ${result.blockExplorerUrl}`,
                    content: {
                        success: true,
                        hash: result.hash,
                        blockExplorerUrl: result.blockExplorerUrl,
                        badge: rewardDetails.badgeName,
                        recipient: walletAddress,
                        platform: platform
                    },
                });
            }

            return true;

        } catch (error) {
            console.error("Error in badge reward action:", error);
            if (callback) {
                callback({
                    text: `Failed to award badge: ${error.message}`,
                    content: { error: error.message },
                });
            }
            return false;
        }
    },

    template: badgeRewardTemplate,

    validate: async (runtime: IAgentRuntime) => {
        const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
        const dAppId = runtime.getSetting("OPENFORMAT_DAPP_ID");
        const apiKey = runtime.getSetting("OPENFORMAT_API_KEY");
        return !!(privateKey && dAppId && apiKey && privateKey.startsWith("0x"));
    },

    examples: [
        [
            {
                user: "user1",
                content: {
                    text: "Can I get the Early Adopter badge?",
                },
            },
            {
                user: "assistant",
                content: {
                    text: "I'll award you the Early Adopter badge!",
                    action: "reward_badge",
                },
            },
        ],
    ],

    similes: ["AWARD_BADGE", "GIVE_BADGE", "EARN_BADGE"],
};