import { Plugin } from "@ai16z/eliza";

import { socialToWalletProvider } from "./providers/socialToWallet.ts";

export const openformatPlugin: Plugin = {
    name: "openformat",
    description: "Openformat plugin",
    providers: [socialToWalletProvider],
    actions: [],
    evaluators: [],
};

export default openformatPlugin;
