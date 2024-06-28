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
import type Transport from "@ledgerhq/hw-transport";
import Eth from "@ledgerhq/hw-app-eth";
import BaseApp, { BIP32Path, INSGeneric, processErrorResponse, processResponse } from "@zondax/ledger-js";
import { LedgerEthTransactionResolution, LoadConfig } from "@ledgerhq/hw-app-eth/lib/services/types";

import { GenericResponseSign, GenericeResponseAddress } from "./types";
import { P1_VALUES } from "./consts";

export class PeaqApp extends BaseApp {
  private eth;

  static _INS = {
    GET_VERSION: 0x00 as number,
    GET_ADDR: 0x01 as number,
    SIGN: 0x02 as number,
  };

  static _params = {
    cla: 0x61,
    ins: { ...PeaqApp._INS } as INSGeneric,
    p1Values: { ONLY_RETRIEVE: 0x00 as 0, SHOW_ADDRESS_IN_DEVICE: 0x01 as 1 },
    chunkSize: 250,
    requiredPathLengths: [5],
  };

  constructor(transport: Transport, ethScrambleKey = "w0w", ethLoadConfig: LoadConfig = {}) {
    super(transport, PeaqApp._params);
    if (!this.transport) {
      throw new Error("Transport has not been defined");
    }

    this.eth = new Eth(transport, ethScrambleKey, ethLoadConfig);
  }

  async getAddress(
    path: BIP32Path,
    showAddrInDevice = false,
    boolChaincode?: boolean,
  ): Promise<GenericeResponseAddress> {
    const bip44PathBuffer = this.serializePath(path);

    const p1 = showAddrInDevice ? P1_VALUES.SHOW_ADDRESS_IN_DEVICE : P1_VALUES.ONLY_RETRIEVE;

    try {
      const responseBuffer = await this.transport.send(
        this.CLA,
        this.INS.GET_ADDR,
        p1,
        boolChaincode ? 0x01 : 0x00,
        bip44PathBuffer,
      );

      const response = processResponse(responseBuffer);

      const pubKey = response.readBytes(65).toString("hex");
      const address = response.readBytes(response.length()).toString("ascii");

      return {
        pubKey,
        address,
        return_code: 0x9000,
        error_message: "No errors",
      } as GenericeResponseAddress;
    } catch (e) {
      throw processErrorResponse(e);
    }
  }

  private splitBufferToChunks(message: Buffer, chunkSize: number) {
    const chunks = [];
    const buffer = Buffer.from(message);

    for (let i = 0; i < buffer.length; i += chunkSize) {
      let end = i + chunkSize;
      if (i > buffer.length) {
        end = buffer.length;
      }
      chunks.push(buffer.subarray(i, end));
    }

    return chunks;
  }

  private getSignReqChunks(path: BIP32Path, message: Buffer) {
    const chunks: Buffer[] = [];
    const bip44Path = this.serializePath(path);

    const blobLen = Buffer.alloc(2);
    blobLen.writeUInt16LE(message.length);

    chunks.push(Buffer.concat([bip44Path, blobLen]));
    chunks.push(...this.splitBufferToChunks(message, this.CHUNK_SIZE));

    return chunks;
  }

  async sign(path: BIP32Path, message: Buffer): Promise<GenericResponseSign> {
    const chunks = this.getSignReqChunks(path, message);
    try {
      let result = await this.signSendChunk(PeaqApp._INS.SIGN, 1, chunks.length, chunks[0]);
      for (let i = 1; i < chunks.length; i += 1) {
        result = await this.signSendChunk(PeaqApp._INS.SIGN, 1 + i, chunks.length, chunks[i]);
      }

      return {
        sign_type: result.readBytes(1),
        r: result.readBytes(32),
        s: result.readBytes(32),
        v: result.readBytes(1),
        return_code: 0x9000,
        error_message: "No errors",
      };
    } catch (e) {
      throw processErrorResponse(e);
    }
  }

  async signEVMTransaction(
    path: string,
    rawTxHex: any,
    resolution?: LedgerEthTransactionResolution | null,
  ): Promise<{
    s: string;
    v: string;
    r: string;
  }> {
    return this.eth.signTransaction(path, rawTxHex, resolution);
  }

  async getETHAddress(
    path: string,
    boolDisplay?: boolean,
    boolChaincode?: boolean,
  ): Promise<{
    publicKey: string;
    address: string;
    chainCode?: string;
  }> {
    return this.eth.getAddress(path, boolDisplay, boolChaincode);
  }
}
