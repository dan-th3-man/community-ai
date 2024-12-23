import {
    composeContext,
    generateObjectDeprecated,
    HandlerCallback,
    ModelClass,
    type IAgentRuntime,
    type Memory,
    type State,
    Evaluator,
} from "@ai16z/eliza";
import { RewardAction } from "../actions/rewardPoints";
import { socialToWalletProvider } from "../providers/socialToWallet";

const contributionTemplate = `TASK: Analyze Message Contribution
Review the following conversation and determine if the message contains a meaningful contribution.

Recent Messages:
{{recentMessages}}

Consider the following contribution types:

High-Value Contributions (150-500 points):
- Solving complex problems for other users
- Creating comprehensive tutorials or guides
- Providing detailed technical explanations
- Leading productive brainstorming sessions

Medium-Value Contributions (50-150 points):
- Sharing relevant resources or documentation
- Answering questions with detailed explanations
- Contributing substantial ideas to discussions
- Helping debug simple problems

Low-Value Contributions (10-50 points):
- Basic helpful responses
- Sharing simple tips
- Participating constructively in discussions
- Validating others' solutions

Minimal Engagement (1-10 points):
- Asking well-formed questions
- Introducing themselves meaningfully
- Following up on discussions constructively
- First-time participation in topics

Not Considered Contributions (0 points):
- Generic greetings (gm, hello, etc.)
- Single word/emoji responses
- Off-topic messages
- Spam or low-effort posts

Consider these factors when evaluating:

Message Quality:
- Level of detail and effort
- Technical accuracy or helpfulness
- Relevance to the discussion
- Originality of contribution

Community Response:
- Substantive follow-up messages
- Specific thank you messages
- Multiple positive reactions
- Evidence of actual help provided

Context Evaluation:
- Previous discussion history
- Time since last similar contribution
- Overall discussion relevance
- Community need for the contribution

Respond in JSON format with:
{
    "isContribution": boolean,
    "contributionType": string | null,
    "significance": "minimal" | "low" | "medium" | "high" | null,
    "suggestedPoints": number | null,
    "reasoning": string
}

Points guide:
- High significance: 150-500 points (exceptional contributions with clear impact)
- Medium significance: 50-150 points (substantial helpful contributions)
- Low significance: 10-50 points (basic helpful contributions)
- Minimal engagement: 1-10 points (honest community participation)
- No points: Generic messages, greetings, or low-effort posts`;

async function analyzeContribution(
    state: State,
    runtime: IAgentRuntime
): Promise<{
    isContribution: boolean;
    contributionType: string | null;
    significance: "low" | "medium" | "high" | null;
    suggestedPoints: number | null;
    reasoning: string;
}> {
    const context = composeContext({
        state,
        template: contributionTemplate,
    });

    return await generateObjectDeprecated({
        runtime,
        context,
        modelClass: ModelClass.SMALL,
    });
}

async function handler(
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options: any = {},
    callback?: HandlerCallback
): Promise<boolean> {
    try {
        console.log("Processing contribution evaluator...");

        // Skip non-user messages (like system messages or bot responses)
        if (message.userId === runtime.agentId) {
            return false;
        }

        // Analyze the contribution
        const contribution = await analyzeContribution(state, runtime);
        console.log("Contribution analysis:", contribution);

        if (!contribution.isContribution || !contribution.suggestedPoints) {
            return false;
        }

        // Get user's wallet address
        const walletProvider = socialToWalletProvider.get;
        const providerResponse = await walletProvider(runtime, message, state);

        if (!providerResponse) {
            console.log("No wallet found for user");
            return false;
        }

        const match = providerResponse.match(/Connected Wallet Address: (0x[a-fA-F0-9]{40})/);
        const walletAddress = match?.[1];

        if (!walletAddress) {
            console.log("Could not extract wallet address");
            return false;
        }

        // Initialize reward action
        const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
        const action = new RewardAction(privateKey);

        // Execute reward
        console.log(`Rewarding ${contribution.suggestedPoints} points for ${contribution.contributionType}`);
        const result = await action.reward(walletAddress, contribution.suggestedPoints);

        if (callback) {
            const account = await runtime.databaseAdapter.getAccountById(message.userId);
            const username = account?.username || "User";

            let responseText = `🌟 ${username} earned ${contribution.suggestedPoints} points for their ${contribution.significance} contribution!\n`;
            responseText += `Type: ${contribution.contributionType}\n`;

            if (contribution.significance === "high") {
                responseText += "Exceptional work! Your contribution is highly valuable to the community. 🏆\n";
            } else if (contribution.significance === "medium") {
                responseText += "Great work! Keep those helpful contributions coming! 🌟\n";
            } else {
                responseText += "Thanks for contributing to the community! 👍\n";
            }

            responseText += `\nView transaction: ${result.blockExplorerUrl}`;

            callback({
                text: responseText,
                content: {
                    success: true,
                    hash: result.hash,
                    blockExplorerUrl: result.blockExplorerUrl,
                    amount: contribution.suggestedPoints,
                    type: contribution.contributionType,
                    significance: contribution.significance,
                    recipient: walletAddress,
                },
            });
        }

        return true;

    } catch (error) {
        console.error("Error in contribution evaluator:", error);
        return false;
    }
}

export const contributionEvaluator: Evaluator = {
    name: "EVALUATE_CONTRIBUTION",
    description: "Evaluates and rewards meaningful community contributions",

    // Add similes for the evaluator
    similes: [
        "EVALUATE_CONTRIBUTION",
        "CHECK_CONTRIBUTION",
        "ASSESS_CONTRIBUTION",
        "REVIEW_MESSAGE",
        "CHECK_MESSAGE_VALUE",
        "EVALUATE_MESSAGE"
    ],

    validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
        // Add debug logging
        console.log("Validating contribution for message:", {
            userId: message.userId,
            content: message.content?.text?.substring(0, 100),
            hasRequiredSettings: !!(
                runtime.getSetting("EVM_PRIVATE_KEY") &&
                runtime.getSetting("OPENFORMAT_DAPP_ID") &&
                runtime.getSetting("OPENFORMAT_API_KEY")
            )
        });

        // Only run for user messages (not system or bot) and ensure required settings exist
        // Check if it's a user message by verifying it's not from the agent
        return message.userId !== runtime.agentId &&
               message.content?.text != null &&  // Make sure there's actual message content
               !!(
                    runtime.getSetting("EVM_PRIVATE_KEY") &&
                    runtime.getSetting("OPENFORMAT_DAPP_ID") &&
                    runtime.getSetting("OPENFORMAT_API_KEY")
                );
    },

    handler,

    alwaysRun: true,

    examples: [
        {
            context: "User provides comprehensive solution with custom tutorial",
            messages: [
                {
                    user: "user1",
                    content: {
                        text: "I'm stuck trying to integrate the wallet connection. Been trying for hours.",
                    },
                },
                {
                    user: "user2",
                    content: {
                        text: "I actually just wrote a detailed guide for this after helping several people. Here's a step-by-step tutorial with code examples and common pitfalls: [link]. The main issues usually are: 1) incorrect network configuration [details], 2) missing error handling [code example], 3) state management issues [explanation]. Let me know if you need any clarification!",
                    },
                },
                {
                    user: "user3",
                    content: {
                        text: "This is exactly what I needed too! The error handling section is brilliant 🙏",
                    },
                },
                {
                    user: "user1",
                    content: {
                        text: "Thank you so much! I implemented your solution and it works perfectly. Especially appreciate the error handling patterns!",
                    },
                },
            ],
            outcome: "High significance contribution - 300 points awarded. Created valuable resource, solved immediate problem, and helped multiple users.",
        },
        {
            context: "User helps debug a problem with good explanation",
            messages: [
                {
                    user: "user1",
                    content: {
                        text: "Getting Error XYZ when trying to mint. Anyone know what's wrong?",
                    },
                },
                {
                    user: "user2",
                    content: {
                        text: "This usually means your gas settings aren't optimal for the current network conditions. Check your gas settings and adjust them using [specific instructions]. You can monitor current gas prices at [resource link]. Also make sure you have enough native tokens to cover the transaction.",
                    },
                },
                {
                    user: "user1",
                    content: {
                        text: "That worked! Thanks for explaining why it was happening too.",
                    },
                },
            ],
            outcome: "Medium significance contribution - 100 points awarded. Provided solution with explanation and context.",
        },
        {
            context: "User provides basic helpful response",
            messages: [
                {
                    user: "user1",
                    content: {
                        text: "Which network should I use for testing?",
                    },
                },
                {
                    user: "user2",
                    content: {
                        text: "Sepolia is a good choice for testing. It's stable and you can get test ETH from the faucet.",
                    },
                },
            ],
            outcome: "Low significance contribution - 25 points awarded. Basic but helpful information.",
        },
        {
            context: "User makes first-time meaningful engagement",
            messages: [
                {
                    user: "user1",
                    content: {
                        text: "Hi everyone! I'm new here and learning about web3 development. I've been studying Solidity for a few weeks and really interested in building DeFi applications. What resources would you recommend for someone starting out?",
                    },
                },
            ],
            outcome: "Minimal engagement contribution - 5 points awarded. Well-formed introduction and genuine engagement.",
        },
        {
            context: "User sends generic greeting",
            messages: [
                {
                    user: "user1",
                    content: {
                        text: "gm frens 👋",
                    },
                },
            ],
            outcome: "No points awarded. Generic greeting without meaningful contribution.",
        },
    ]
};