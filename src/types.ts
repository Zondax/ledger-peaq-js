import type { ContextModule } from "@ledgerhq/context-module";
import type { DeviceManagementKit, DeviceSessionId } from "@ledgerhq/device-management-kit";
import { INSGeneric } from "@zondax/ledger-js";

export interface PeaqIns extends INSGeneric {
  GET_VERSION: 0x00;
  GET_ADDR: 0x01;
  SIGN: 0x02;
}

export interface ResponseAddress {
  pubkey: Buffer;
  address: string;
}

export interface ResponseSign {
  signature: Buffer;
}

/**
 * What the EVM methods need on top of the transport.
 *
 * `signEVMTransaction`, `getETHAddress` and `signPersonalMessage` go through the Device
 * Management Kit's Ethereum signer, which drives the device from a DMK session rather than
 * through `send`. Pass the same `dmk` and `sessionId` that back the `DMKTransport` given to
 * the constructor.
 *
 * Every peaq method is an EVM method, so this is required — there is nothing the app can do
 * without it. The SDKs that also expose a native chain take it as optional instead.
 */
export interface EvmSignerOptions {
  dmk: DeviceManagementKit;
  sessionId: DeviceSessionId;
  /** Identifies the integrator to Ledger's clear-signing metadata services. */
  originToken?: string;
  /** Replaces the signer's default clear-signing context module, e.g. to sign offline. */
  contextModule?: ContextModule;
}
