import { generateMarketplaceTypes } from "./marketplace/generate";

await Bun.write("convex/lib/marketplace/schema.generated.ts", await generateMarketplaceTypes());
