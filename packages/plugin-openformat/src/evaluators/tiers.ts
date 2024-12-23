import { IAgentRuntime, Memory, State, Evaluator } from "@ai16z/eliza";
import { userProfileProvider } from "../providers/userProfile";
import { BadgeRewardAction } from "../actions/rewardBadges";

interface Tier {
    name: string;
    points_required: number;
}

// TODO: When user reaches a tier, we should send a message to them congratulating them

const tiers: Tier[] = [
    { name: "Bronze", points_required: 500 },
    { name: "Silver", points_required: 1000 },
    { name: "Gold", points_required: 2000 },
    { name: "Platinum", points_required: 5000 },
    { name: "Diamond", points_required: 10000 },
];

async function handler(
    runtime: IAgentRuntime,
    message: Memory,
    state?: State
): Promise<{ text: string; content: any } | void> {
    console.log("Starting tier evaluator handler");
    try {
        const profileProvider = userProfileProvider.get;
        const profileData = await profileProvider(runtime, message, state);

        if (!profileData) {
            console.log("No profile data available");
            return;
        }

        console.log("Profile data:", profileData);

        // Update regex to match the markdown format
        const pointsMatch = profileData.match(/has earned (\d+) XP points/);
        if (!pointsMatch) {
            console.log("Could not find points in profile data");
            return;
        }

        const currentPoints = parseInt(pointsMatch[1]);
        console.log("Current points:", currentPoints);

        // Get platform from message source
        const platform = message.content?.source || "discord";
        console.log("Platform detection:", {
            messageSource: message.content?.source,
            defaultedTo: platform
        });

        // Update regex to handle the new markdown format with badges section
        const badgesMatch = profileData.match(
            /## Badges\n.*?collected \d+ badges: (\[.*?\])/s
        );
        const currentBadges = badgesMatch ? JSON.parse(badgesMatch[1]) : [];
        console.log("Current badges:", currentBadges);

        // Find highest eligible tier that hasn't been awarded yet
        const eligibleTier = [...tiers]
            .reverse()
            .find(
                (tier) =>
                    currentPoints >= tier.points_required &&
                    !currentBadges.some((badge) =>
                        badge.name
                            .toLowerCase()
                            .includes(tier.name.toLowerCase())
                    )
            );

        if (!eligibleTier) {
            console.log("No new tier badges to award");
            return;
        }

        console.log("Awarding badge for tier:", eligibleTier.name);

        // Initialize badge reward action
        const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
        const badgeAction = new BadgeRewardAction(privateKey);

        // Get available badges
        const dAppId = runtime.getSetting("OPENFORMAT_DAPP_ID");
        const availableBadges = await badgeAction.fetchAvailableBadges(dAppId);
        console.log("Available badges:", availableBadges);

        // Find matching tier badge
        const tierBadge = availableBadges.find((badge) =>
            badge.name.toLowerCase().includes(eligibleTier.name.toLowerCase())
        );

        if (!tierBadge) {
            console.log("Could not find badge for tier:", eligibleTier.name);
            return;
        }

        // Get wallet address from provider
        const providerResponse = await userProfileProvider.get(
            runtime,
            message,
            state
        );
        const addressMatch = providerResponse?.match(
            /Connected Wallet Address: (0x[a-fA-F0-9]{40})/
        );
        const walletAddress = addressMatch?.[1];

        if (!walletAddress) {
            console.log("Could not find wallet address");
            return {
                text: `Please connect your ${platform} account to receive tier badges. You can do it here: https://ai-agent-privy.vercel.app/`,
                content: {
                    success: false,
                    error: "No wallet connected",
                    platform: platform
                }
            };
        }

        // Award the badge
        const apiKey = runtime.getSetting("OPENFORMAT_API_KEY");
        const result = await badgeAction.rewardBadge(
            walletAddress,
            tierBadge.id,
            dAppId,
            apiKey
        );

        console.log("Badge awarded successfully:", {
            tier: eligibleTier.name,
            badge: tierBadge.name,
            transaction: result.hash,
            platform: platform
        });

        // Create response message
        const response = {
            text: `🎉 Congratulations! You've reached the ${eligibleTier.name} tier on ${platform}! You have been awarded the ${eligibleTier.name} badge.\n\nThis badge represents your achievement of earning ${eligibleTier.points_required} XP points. Keep engaging to reach the next tier!\n\nView your badge transaction: ${result.blockExplorerUrl}`,
            content: {
                success: true,
                tier: eligibleTier.name,
                points_required: eligibleTier.points_required,
                transaction: result.hash,
                blockExplorerUrl: result.blockExplorerUrl,
                platform: platform
            },
        };

        // Ensure we're returning the response
        console.log("Sending response:", response);
        return response;
    } catch (error) {
        console.error("Error in tier evaluator:", error);
        // Return error message if something goes wrong
        return {
            text: "Sorry, there was an error processing your tier badge.",
            content: {
                success: false,
                error: error.message,
            },
        };
    }
}

export const tierEvaluator: Evaluator = {
    name: "CHECK_USER_TIER",
    description: "Checks user's points and awards tier badges when thresholds are reached",
    similes: ["CHECK_TIER", "EVALUATE_TIER", "CHECK_RANK", "TIER_CHECK", "GET_TIER", "SHOW_TIER", "CHECK_LEVEL", "SHOW_RANK"],

    validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
        // Add debug logging to understand what's being checked
        console.log("Tier evaluator validation details:", {
            messageText: message.content?.text?.substring(0, 100),
            hasRequiredSettings: !!(
                runtime.getSetting("EVM_PRIVATE_KEY") &&
                runtime.getSetting("OPENFORMAT_DAPP_ID") &&
                runtime.getSetting("OPENFORMAT_API_KEY")
            ),
            messageType: message.userId,
            messageSource: message.content?.source,
            isPointsUpdate: message.content?.text?.includes("reward_interaction"),
            isProfileInfo: message.content?.text?.includes("# Additional Information about"),
            isTierQuery: message.content?.text?.toLowerCase().match(/tier|rank|level|badge/),
        });

        // Check various trigger conditions
        const isProfileInfo = message.content?.text?.includes("# Additional Information about");
        const isTierQuery = message.content?.text?.toLowerCase().match(/tier|rank|level|badge/);
        const isPointsUpdate = message.content?.text?.includes("reward_interaction");
        const isContributionReward = message.content?.text?.includes("earned") && message.content?.text?.includes("points");

        // Check if we have all required settings
        const hasRequiredSettings = !!(
            runtime.getSetting("EVM_PRIVATE_KEY") &&
            runtime.getSetting("OPENFORMAT_DAPP_ID") &&
            runtime.getSetting("OPENFORMAT_API_KEY")
        );

        // Log the final validation result
        const shouldRun = (isProfileInfo || isTierQuery || isPointsUpdate || isContributionReward) && hasRequiredSettings;
        console.log("Tier evaluator should run:", shouldRun, {
            isProfileInfo,
            isTierQuery,
            isPointsUpdate,
            isContributionReward,
            hasRequiredSettings,
            messageText: message.content?.text
        });

        return shouldRun;
    },

    handler,

    // Consider setting this to true since we want to catch all point updates
    alwaysRun: true,

    examples: [
        {
            context: "New user with 561 XP points and no tier badges",
            messages: [
                {
                    user: "system",
                    content: {
                        text: '# Additional Information about dan_openformat\n\n## Points\ndan_openformat has earned 561 XP points total.\n\n## Badges\nThey have collected 1 badges: [{"name":"Early Adopter","description":"First to join"}].',
                    },
                },
            ],
            outcome: "Award Bronze tier badge",
        },
        {
            context: "User with Bronze badge reaches Silver tier",
            messages: [
                {
                    user: "system",
                    content: {
                        text: '# Additional Information about dan_openformat\n\n## Points\ndan_openformat has earned 1061 XP points total.\n\n## Badges\nThey have collected 2 badges: [{"name":"Bronze","description":"Bronze tier"}, {"name":"Early Adopter","description":"First to join"}].',
                    },
                },
            ],
            outcome: "Award Silver tier badge",
        },
        {
            context: "User with Silver badge reaches Gold tier",
            messages: [
                {
                    user: "system",
                    content: {
                        text: '# Additional Information about dan_openformat\n\n## Points\ndan_openformat has earned 2500 XP points total.\n\n## Badges\nThey have collected 3 badges: [{"name":"Silver","description":"Silver tier"}, {"name":"Bronze","description":"Bronze tier"}, {"name":"Early Adopter","description":"First to join"}].',
                    },
                },
            ],
            outcome: "Award Gold tier badge",
        },
        {
            context: "User has enough points but already has the tier badge",
            messages: [
                {
                    user: "system",
                    content: {
                        text: '# Additional Information about dan_openformat\n\n## Points\ndan_openformat has earned 1500 XP points total.\n\n## Badges\nThey have collected 3 badges: [{"name":"Silver","description":"Silver tier"}, {"name":"Bronze","description":"Bronze tier"}, {"name":"Early Adopter","description":"First to join"}].',
                    },
                },
            ],
            outcome: "No new tier badges to award",
        },
        {
            context: "User doesn't have enough points for next tier",
            messages: [
                {
                    user: "system",
                    content: {
                        text: '# Additional Information about dan_openformat\n\n## Points\ndan_openformat has earned 750 XP points total.\n\n## Badges\nThey have collected 2 badges: [{"name":"Bronze","description":"Bronze tier"}, {"name":"Early Adopter","description":"First to join"}].',
                    },
                },
            ],
            outcome: "No new tier badges to award",
        },
    ]
};
