import {
    type Memory,
    type Provider,
    type State,
    type IAgentRuntime,
    type Account,
} from "@ai16z/eliza";
import { PrivyClient } from "@privy-io/server-auth";


interface ProfileResponse {
    status: number;
    data: {
        user_id: string;
        xp_balance: string;
        collected_badges: {
            id: string;
            name: string;
            metadataURI: string;
            metadata: {
                name: string;
                description: string;
                type: string;
                image: string;
            };
        }[];
        completed_actions: {
            name: string;
            createdAt: string;
            xp_rewarded: string;
        }[];
        credit_balances: any[];
    };
}

if (!process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET) {
    throw new Error("Privy app ID or secret is not set");
}

const privyClient = new PrivyClient(
    process.env.PRIVY_APP_ID,
    process.env.PRIVY_APP_SECRET
);

function formatTimestamp(timestamp: string): string {
    const actionTime = parseInt(timestamp) * 1000;
    const now = Date.now();
    const diffSeconds = Math.floor((now - actionTime) / 1000);

    if (diffSeconds < 60) return "just now";
    if (diffSeconds < 3600)
        return `${Math.floor(diffSeconds / 60)} minute(s) ago`;
    if (diffSeconds < 86400)
        return `${Math.floor(diffSeconds / 3600)} hour(s) ago`;
    return `${Math.floor(diffSeconds / 86400)} day(s) ago`;
}

function formatProfileResponse(
    data: ProfileResponse,
    username: string,
    platform: string
): string {
    const parts = [];

    // Add header with platform info
    parts.push(`# Additional Information about ${username} (${platform})`);
    parts.push(""); // Add empty line for better formatting

    // Add wallet info
    parts.push("## Wallet");
    parts.push(`${username}'s Connected Wallet Address: {{wallet_address}}`);
    parts.push("");

    // Add XP/Points info
    parts.push("## Points");
    parts.push(
        `${username} has earned ${data.data.xp_balance} XP points total.`
    );
    parts.push("");

    // Add Badges info
    parts.push("## Badges");
    const badgeCount = data.data.collected_badges.length;
    const formattedBadges = data.data.collected_badges.map((badge) => ({
        name: badge.name,
        description: badge.metadata.description,
    }));

    parts.push(
        badgeCount > 0
            ? `They have collected ${badgeCount} badges: ${JSON.stringify(formattedBadges)}.`
            : `${username} hasn't collected any badges yet.`
    );
    parts.push("");

    // Add Recent Actions info
    parts.push("## Recent Actions");
    if (data.data.completed_actions.length > 0) {
        const sortedActions = data.data.completed_actions
            .sort((a, b) => parseInt(b.createdAt) - parseInt(a.createdAt))
            .slice(0, 10)
            .map(
                (action) =>
                    `${action.name} (${action.xp_rewarded} XP, ${formatTimestamp(action.createdAt)})`
            );

        parts.push(`Their recent actions include: ${sortedActions.join(", ")}`);
    } else {
        parts.push(`${username} hasn't completed any actions yet.`);
    }

    return parts.join("\n");
}

export const userProfileProvider: Provider = {
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

            console.log("Platform detection:", {
                messageSource: message.content?.source,
                username: account.username,
                isTelegram
            });

            // Remove @ symbol if present in Telegram usernames
            const cleanUsername = isTelegram
                ? account.username.replace("@", "")
                : account.username;

            if (isTelegram) {
                user = await privyClient.getUserByTelegramUsername(cleanUsername);
                console.log("Telegram user lookup result:", user ? "found" : "not found");
            } else {
                user = await privyClient.getUserByDiscordUsername(cleanUsername);
                console.log("Discord user lookup result:", user ? "found" : "not found");
            }

            if (!user) {
                return `No Privy account found for ${isTelegram ? "Telegram" : "Discord"} user ${cleanUsername}. You can create one at https://ai-agent-privy.vercel.app/`;
            }

            const walletAccount = user.linkedAccounts.find(
                (account) => account.type === "wallet"
            );
            if (!walletAccount?.address) {
                return `User ${account.username} has not connected a wallet to their Privy account. You can connect one at https://ai-agent-privy.vercel.app/`;
            }

            // Get user profile from OpenFormat
            const dAppId = runtime.getSetting("OPENFORMAT_DAPP_ID");
            const apiKey = runtime.getSetting("OPENFORMAT_API_KEY");

            const queryParams = new URLSearchParams({
                app_id: dAppId.toLowerCase(),
                user_id: walletAccount.address.toLowerCase(),
                chain: "arbitrum-sepolia",
            });

            const response = await fetch(
                `https://api.openformat.tech/v1/profile?${queryParams}`,
                {
                    method: "GET",
                    headers: {
                        "X-API-KEY": apiKey,
                        "Content-Type": "application/json",
                    },
                }
            );

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            const profileData = { status: response.status, data };

            // Return both wallet and profile information with platform context
            return formatProfileResponse(
                profileData,
                account.username,
                isTelegram ? "telegram" : "discord"
            ).replace("{{wallet_address}}", walletAccount.address);
        } catch (error) {
            console.error("Error in user provider:", error);
            return "Error accessing user information.";
        }
    },
};
