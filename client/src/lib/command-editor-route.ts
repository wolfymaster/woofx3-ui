import { NEW_COMMAND_KEY } from "@/lib/command-drafts";

/**
 * Every screen in the chat commands area is its own route, so each one has a back button
 * that means something and a link that can be shared — nothing here opens in a dialog.
 *
 * They all nest under the Commands list, which is what keeps the Commands menu entry
 * marked active throughout (see isNavItemActive, which matches on the path prefix).
 *
 *   /stream/commands                              the commands list
 *   /stream/commands/new                          create a command
 *   /stream/commands/:engineCommandId             edit a command
 *   /stream/commands/groups                       the groups list
 *   /stream/commands/groups/new                   create a group
 *   /stream/commands/groups/:engineGroupId        edit a group and its members
 *
 * Order matters when these are registered: the fixed segments (`new`, `groups`) must be
 * matched before `:engineCommandId`, or a literal path is read as a command id. Engine
 * ids are uuids and never collide with them, but the router decides by order regardless.
 */
export const COMMAND_LIST_PATH = "/stream/commands";
export const COMMAND_NEW_ROUTE = `${COMMAND_LIST_PATH}/${NEW_COMMAND_KEY}`;
export const COMMAND_EDITOR_ROUTE = `${COMMAND_LIST_PATH}/:engineCommandId`;

export const COMMAND_GROUPS_PATH = `${COMMAND_LIST_PATH}/groups`;
export const COMMAND_GROUP_NEW_ROUTE = `${COMMAND_GROUPS_PATH}/new`;
export const COMMAND_GROUP_EDITOR_ROUTE = `${COMMAND_GROUPS_PATH}/:engineGroupId`;

export function commandEditorPath(engineCommandId: string): string {
  return `${COMMAND_LIST_PATH}/${encodeURIComponent(engineCommandId)}`;
}

export function commandGroupEditorPath(engineGroupId: string): string {
  return `${COMMAND_GROUPS_PATH}/${encodeURIComponent(engineGroupId)}`;
}
