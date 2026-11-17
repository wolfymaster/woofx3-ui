import { generateBillingTypes } from "../convex/lib/billing/generate";

await Bun.write("convex/lib/billing/schema.generated.ts", await generateBillingTypes());
