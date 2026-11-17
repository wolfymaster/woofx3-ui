import { generateBillingTypes } from "./billing/generate";

await Bun.write("convex/lib/billing/schema.generated.ts", await generateBillingTypes());
