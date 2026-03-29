import axios from "axios";
import { utils as ethersUtils } from "ethers";
import { SwapRequest } from "../../../domain/entities/swap";
import { ThirdwebSwapAdapter } from "../thirdweb.swap.adapter";

jest.mock("axios");

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("ThirdwebSwapAdapter", () => {
  const originalClientId = process.env.THIRDWEB_CLIENT_ID;
  const originalSecretKey = process.env.THIRDWEB_SECRET_KEY;

  beforeEach(() => {
    process.env.THIRDWEB_CLIENT_ID = "test-client-id";
    delete process.env.THIRDWEB_SECRET_KEY;
    mockedAxios.get.mockReset();
    mockedAxios.post.mockReset();
  });

  afterAll(() => {
    process.env.THIRDWEB_CLIENT_ID = originalClientId;
    if (originalSecretKey) {
      process.env.THIRDWEB_SECRET_KEY = originalSecretKey;
    } else {
      delete process.env.THIRDWEB_SECRET_KEY;
    }
  });

  it("normalizes ERC20 token addresses and includes sellAmountWei when quoting", async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        data: {
          originAmount: "1000000",
          destinationAmount: "999000",
          estimatedExecutionTimeMs: 1000,
        },
      },
    });

    const adapter = new ThirdwebSwapAdapter();
    const request = new SwapRequest(
      1,
      8453,
      "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      BigInt(1000000),
      "0x419b64f7b107da0e88abc4f7c93bffd340939bc1",
      "0x419b64f7b107da0e88abc4f7c93bffd340939bc1"
    );

    await adapter.getQuote(request);

    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://bridge.thirdweb.com/v1/sell/quote",
      expect.objectContaining({
        params: expect.objectContaining({
          originTokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          destinationTokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          sellAmountWei: "1000000",
          amount: "1000000",
        }),
      })
    );
  });

  it("normalizes addresses and mirrors Thirdweb Sell.prepare payload", async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        data: {
          steps: [],
        },
      },
    });

    const adapter = new ThirdwebSwapAdapter();
    const request = new SwapRequest(
      1,
      8453,
      "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      BigInt(1000000),
      "0x419b64f7b107da0e88abc4f7c93bffd340939bc1",
      "0x419b64f7b107da0e88abc4f7c93bffd340939bc1"
    );

    await adapter.prepareSwap(request);

    expect(mockedAxios.post).toHaveBeenCalledWith(
      "https://bridge.thirdweb.com/v1/sell/prepare",
      {
        originChainId: "1",
        originTokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        destinationChainId: "8453",
        destinationTokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        amount: "1000000",
        sellAmountWei: "1000000",
        sender: ethersUtils.getAddress("0x419b64f7b107da0e88abc4f7c93bffd340939bc1"),
        receiver: ethersUtils.getAddress("0x419b64f7b107da0e88abc4f7c93bffd340939bc1"),
      },
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "x-client-id": "test-client-id",
        }),
      })
    );
  });
});
