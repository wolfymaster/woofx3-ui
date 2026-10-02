import { internalMutation } from "../_generated/server";
import { seedDefaultSetupPlatforms } from "../setupPlatforms";

/**
 * Seeds a pull request's preview deployment with the product data the app
 * cannot run without. A preview deployment starts with empty tables, and
 * production's rows were added by hand with `bunx convex run`, so without this
 * a preview cannot get through onboarding.
 *
 * `.github/workflows/preview.yml` runs it after every preview deploy through
 * `bunx convex deploy --preview-run seeds/preview:default`. Every seed called
 * here must therefore be idempotent and must leave rows it did not create
 * alone. Add a seed here whenever a feature depends on a table that only
 * operators fill.
 *
 * Only data that is safe to hold in the repository belongs here. Secrets, such
 * as the OAuth apps in `integrationCredentials`, are not seeded.
 */
export default internalMutation({
  args: {},
  handler: async (ctx): Promise<{ setupPlatforms: string[] }> => {
    const setupPlatforms = await seedDefaultSetupPlatforms(ctx);
    console.log(`Preview seed: setupPlatforms inserted [${setupPlatforms.join(", ")}]`);
    return { setupPlatforms };
  },
});
