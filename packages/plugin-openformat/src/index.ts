import { Plugin } from "@ai16z/eliza";
import { rewardAction } from "./actions/rewardPoints";
import { emojiRewardAction } from "./actions/emojiRewards";
import { socialToWalletProvider } from "./providers/socialToWallet";
import { userProfileProvider } from "./providers/userProfile";
import { tierEvaluator } from "./evaluators/tiers";
import { contributionEvaluator } from "./evaluators/contributions";

// Export individual modules
export * from "./actions";
export * from "./providers";
export * from "./evaluators";

// Export the plugin configuration
export const openformatPlugin: Plugin = {
    name: "openformat",
    description: "Openformat plugin",
    providers: [
        socialToWalletProvider,
        userProfileProvider
    ],
    actions: [
        rewardAction,
        emojiRewardAction
    ],
    evaluators: [
        tierEvaluator,
        contributionEvaluator
    ],
};

export default openformatPlugin;
