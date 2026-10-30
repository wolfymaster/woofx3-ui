import type { PublicPageWidget } from "@shared/user-pages";

export type WidgetOf<Type extends PublicPageWidget["type"]> = Extract<PublicPageWidget, { type: Type }>;
