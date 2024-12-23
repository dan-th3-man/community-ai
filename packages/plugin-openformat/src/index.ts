import { Plugin } from "@ai16z/eliza";
import { rewardAction } from "./actions/rewardPoints";
import { badgeRewardAction } from "./actions/rewardBadges";
//import { emojiRewardAction } from "./actions/emojiRewards";
import { userProfileProvider } from "./providers/userProfile";
import { evmWalletProvider } from "./providers/wallet";
import { tierEvaluator } from "./evaluators/tiers";
//import { contributionEvaluator } from "./evaluators/contributions";

// Export individual modules
export * from "./actions";
export * from "./providers";
export * from "./evaluators";
export * from "./types";

// Export the plugin configuration
export const openformatPlugin: Plugin = {
    name: "openformat",
    description: "Openformat plugin",
    providers: [userProfileProvider, evmWalletProvider],
    actions: [rewardAction, badgeRewardAction],
    evaluators: [tierEvaluator],
};

export default openformatPlugin;
