// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { createLogger } from '../logging/log.std.ts';
import { getLibsignalNet } from '../textsecure/preconnect.preload.ts';
import { itemStorage } from '../textsecure/Storage.preload.ts';
import { reconnect } from '../textsecure/WebAPI.preload.ts';

const log = createLogger('censorshipCircumvention');

export function isCensorshipCircumventionEnabled(): boolean {
  return itemStorage.get('censorship-circumvention', false);
}

function setOnLibsignalNet(enabled: boolean): void {
  log.info(`setting ${enabled ? 'enabled' : 'disabled'}`);
  getLibsignalNet().setCensorshipCircumventionEnabled(enabled);
}

// libsignal applies the setting to new connections only, so this has to run before the
// first chat or provisioning connection is made.
export function applyCensorshipCircumventionSetting(): void {
  setOnLibsignalNet(isCensorshipCircumventionEnabled());
}

// For the settings switch. Its value may not be in storage yet when this runs.
export async function onCensorshipCircumventionSettingChanged(
  enabled: boolean
): Promise<void> {
  setOnLibsignalNet(enabled);
  // Existing connections keep the routes they were made with.
  await reconnect();
}

// For the install screen, where there is no settings switch yet.
export async function enableCensorshipCircumvention(): Promise<void> {
  await itemStorage.put('censorship-circumvention', true);
  setOnLibsignalNet(true);
}
