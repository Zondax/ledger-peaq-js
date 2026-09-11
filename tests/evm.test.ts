import { DeviceActionStatus } from "@ledgerhq/device-management-kit";
import { SignerEthBuilder } from "@ledgerhq/device-signer-kit-ethereum";
import { Observable } from "rxjs";

import { PeaqApp } from "../src";
import type { EvmSignerOptions } from "../src/types";

const mockSigner = { signTransaction: jest.fn(), getAddress: jest.fn(), signMessage: jest.fn() };
jest.mock("@ledgerhq/device-signer-kit-ethereum", () => ({
  SignerEthBuilder: jest
    .fn()
    .mockImplementation(() => ({ withContextModule: jest.fn(), build: () => mockSigner })),
}));

/** A finished DMK device action, the way the signer kit hands them out. */
function completed<Output>(output: Output) {
  return {
    observable: new Observable<{ status: DeviceActionStatus.Completed; output: Output }>((subscriber) => {
      subscriber.next({ status: DeviceActionStatus.Completed, output });
      subscriber.complete();
    }),
    cancel() {},
  };
}

/** A transport that must never be reached by the EVM methods. */
const transport = { send: jest.fn().mockRejectedValue(new Error("EVM methods must not use send()")) };
const evm = { dmk: {}, sessionId: "session-1" } as unknown as EvmSignerOptions;
const PATH = "m/44'/60'/0'/0/0";
const R = `0x${"11".repeat(32)}` as const;
const S = `0x${"22".repeat(32)}` as const;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("PeaqApp EVM methods through the DMK signer", () => {
  it("refuses EVM calls without a DMK session, before touching the device", async () => {
    const app = new PeaqApp(transport);
    await expect(app.getETHAddress(PATH)).rejects.toThrow("construct PeaqApp with { dmk, sessionId }");
    expect(SignerEthBuilder).not.toHaveBeenCalled();
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("builds the signer from the session once", async () => {
    const app = new PeaqApp(transport, { ...evm, originToken: "zondax" });
    mockSigner.getAddress.mockReturnValue(completed({ publicKey: "04ab", address: "0xAbC" }));
    await app.getETHAddress(PATH);
    await app.getETHAddress(PATH, true, true);
    expect(SignerEthBuilder).toHaveBeenCalledTimes(1);
    expect(SignerEthBuilder).toHaveBeenCalledWith({
      dmk: evm.dmk,
      sessionId: evm.sessionId,
      originToken: "zondax",
    });
    expect(mockSigner.getAddress).toHaveBeenLastCalledWith("44'/60'/0'/0/0", {
      checkOnDevice: true,
      returnChainCode: true,
      skipOpenApp: true,
    });
  });

  it("signs a transaction with the app already open and maps the signature", async () => {
    const app = new PeaqApp(transport, evm);
    mockSigner.signTransaction.mockReturnValue(completed({ r: R, s: S, v: 1 }));

    await expect(app.signEVMTransaction(PATH, "0x02c0")).resolves.toEqual({
      r: "11".repeat(32),
      s: "22".repeat(32),
      v: "01",
    });
    expect(mockSigner.signTransaction).toHaveBeenCalledWith("44'/60'/0'/0/0", new Uint8Array([0x02, 0xc0]), {
      skipOpenApp: true,
    });
  });

  it("signs a personal message as bytes and keeps v numeric", async () => {
    const app = new PeaqApp(transport, evm);
    mockSigner.signMessage.mockReturnValue(completed({ r: R, s: S, v: 28 }));
    const messageHex = Buffer.from("hello peaq", "utf8").toString("hex");

    await expect(app.signPersonalMessage(PATH, messageHex)).resolves.toEqual({
      r: "11".repeat(32),
      s: "22".repeat(32),
      v: 28,
    });
    expect(mockSigner.signMessage).toHaveBeenCalledWith(
      "44'/60'/0'/0/0",
      new Uint8Array(Buffer.from(messageHex, "hex")),
      { skipOpenApp: true },
    );
  });

  it("surfaces a device rejection as a DeviceActionError with statusCode 0x6985", async () => {
    const app = new PeaqApp(transport, evm);
    mockSigner.signTransaction.mockReturnValue({
      observable: new Observable((subscriber) => {
        subscriber.next({
          status: DeviceActionStatus.Error,
          error: { _tag: "EthAppCommandError", errorCode: "6985" },
        });
      }),
      cancel() {},
    });
    await expect(app.signEVMTransaction(PATH, "c0")).rejects.toMatchObject({
      name: "DeviceActionError",
      statusCode: 0x6985,
    });
  });
});
