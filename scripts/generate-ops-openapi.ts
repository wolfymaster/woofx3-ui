import { buildOpsOpenApi } from "../convex/lib/ops/contract";
import { OPS_OPENAPI_PATH, opsOpenApiText } from "../convex/lib/ops/openapi";

await Bun.write(OPS_OPENAPI_PATH, opsOpenApiText(buildOpsOpenApi()));
