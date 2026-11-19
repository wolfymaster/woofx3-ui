import type { ModuleFileList } from "@woofx3/api/api";

/**
 * A module's file list. `notInstalled` marks a marketplace listing the account
 * has not installed: its files are only readable once the module is on the
 * engine, so the browser asks the streamer to install it first.
 */
export type ModuleFileListing = ModuleFileList & { notInstalled?: true };

export const NOT_INSTALLED_FILE_LIST: ModuleFileListing = { available: false, files: [], notInstalled: true };

export const INSTALL_TO_BROWSE_MESSAGE = "Install this module to browse its files.";
