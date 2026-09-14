/** ******************************************************************************
 *  (c) 2019-2024 Zondax AG
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 ******************************************************************************* */
import { SignerEthBuilder, type SignerEth } from "@ledgerhq/device-signer-kit-ethereum";
import BaseApp, { INSGeneric, type LedgerTransport } from "@zondax/ledger-js";

import { EvmSignerOptions } from "./types";
import {
  evmDerivationPath,
  hexToBytes,
  runDeviceAction,
  toEvmMessageSignature,
  toEvmTransactionSignature,
} from "./evm";

export * from "./types";
export { DeviceActionError } from "./evm";

export class PeaqApp extends BaseApp {
  private readonly evm: EvmSignerOptions;
  private signer: SignerEth | undefined;

  static _INS = {
    GET_VERSION: 0x00 as number,
    GET_ADDR: 0x01 as number,
    SIGN: 0x02 as number,
  };

  static _params = {
    cla: 0x80,
    ins: { ...PeaqApp._INS } as INSGeneric,
    p1Values: { ONLY_RETRIEVE: 0x00 as 0, SHOW_ADDRESS_IN_DEVICE: 0x01 as 1 },
    chunkSize: 250,
    requiredPathLengths: [5],
  };

  /**
   * Every peaq-specific method is an EVM method, so the DMK session is required — unlike the
   * apps that also expose a native chain, where it is optional.
   *
   * @param transport - anything that can send an APDU (`DMKTransport`, or a legacy hw-transport)
   * @param evm - the DMK session behind that transport
   */
  constructor(transport: LedgerTransport, evm: EvmSignerOptions) {
    super(transport, PeaqApp._params);
    if (!this.transport) {
      throw new Error("Transport has not been defined");
    }
    // Required in the type, but checked here so JavaScript callers fail on construction
    // rather than on their first signing attempt.
    if (evm?.dmk == null || evm.sessionId == null) {
      throw new Error("EVM signing needs a Device Management Kit session: pass { dmk, sessionId }");
    }
    this.evm = evm;
  }

  // ---------------------------------------------------------------------------
  // EVM
  //
  // Signing goes through the Device Management Kit's Ethereum signer, which replaces
  // `@ledgerhq/hw-app-eth` (deprecated, removed September 2026).
  // ---------------------------------------------------------------------------

  /** The Ethereum signer, built on first use and reused for the life of the app. */
  private get ethSigner(): SignerEth {
    if (this.signer === undefined) {
      const { dmk, sessionId, originToken, contextModule } = this.evm;
      const builder = new SignerEthBuilder({
        dmk,
        sessionId,
        ...(originToken !== undefined ? { originToken } : {}),
      });
      if (contextModule !== undefined) {
        builder.withContextModule(contextModule);
      }
      this.signer = builder.build();
    }
    return this.signer;
  }

  /**
   * Signs a serialized EVM transaction. Clear-signing context is resolved by the signer's
   * context module, so there is no `resolution` argument any more.
   *
   * @param path - BIP-32 path, e.g. `m/44'/60'/0'/0/0`
   * @param rawTxHex - the RLP-encoded transaction as hex (`0x` prefix optional)
   * @returns `r`, `s` and `v` as hex strings, as `hw-app-eth` returned them
   */
  async signEVMTransaction(path: string, rawTxHex: string): Promise<{ s: string; v: string; r: string }> {
    const signature = await runDeviceAction(
      this.ethSigner.signTransaction(evmDerivationPath(path), hexToBytes(rawTxHex), { skipOpenApp: true }),
    );
    return toEvmTransactionSignature(signature);
  }

  async getETHAddress(
    path: string,
    boolDisplay = false,
    boolChaincode = false,
  ): Promise<{ publicKey: string; address: string; chainCode?: string }> {
    const { publicKey, address, chainCode } = await runDeviceAction(
      this.ethSigner.getAddress(evmDerivationPath(path), {
        checkOnDevice: boolDisplay,
        returnChainCode: boolChaincode,
        skipOpenApp: true,
      }),
    );
    return chainCode === undefined ? { publicKey, address } : { publicKey, address, chainCode };
  }

  /**
   * Signs an EIP-191 personal message.
   *
   * @param path - BIP-32 path
   * @param messageHex - the message bytes as hex, as `hw-app-eth` took them
   */
  async signPersonalMessage(path: string, messageHex: string): Promise<{ v: number; s: string; r: string }> {
    const signature = await runDeviceAction(
      this.ethSigner.signMessage(evmDerivationPath(path), hexToBytes(messageHex), { skipOpenApp: true }),
    );
    return toEvmMessageSignature(signature);
  }
}
