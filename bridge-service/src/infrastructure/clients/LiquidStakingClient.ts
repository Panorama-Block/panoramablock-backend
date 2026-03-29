import axios, { AxiosInstance } from 'axios';

export type LiquidStakePositionResponse = {
  userAddress: string;
  sAvaxBalance: string;
  avaxEquivalent: string;
  exchangeRate: string;
  pendingUnlocks?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

export type LiquidStakePrepareStakeRequest = {
  userAddress: string;
  amount: string;
};

export type LiquidStakePrepareUnlockRequest = {
  userAddress: string;
  sAvaxAmount: string;
};

export type LiquidStakePrepareRedeemRequest = {
  userAddress: string;
  userUnlockIndex: number;
};

export type LiquidStakePrepareResponse = {
  bundle?: {
    steps?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

export class LiquidStakingClient {
  private readonly http: AxiosInstance;

  constructor(baseUrl: string) {
    const timeoutMs = Number(process.env.LIQUID_STAKING_TIMEOUT_MS || 10000);
    this.http = axios.create({
      baseURL: baseUrl.replace(/\/+$/, ''),
      timeout: timeoutMs,
    });
  }

  async getPosition(address: string): Promise<LiquidStakePositionResponse> {
    const res = await this.http.get(`/liquid-staking/position/${encodeURIComponent(address)}`);
    return res.data;
  }

  async prepareStake(request: LiquidStakePrepareStakeRequest): Promise<LiquidStakePrepareResponse> {
    const res = await this.http.post('/liquid-staking/prepare-stake', {
      address: request.userAddress,
      amount: request.amount,
    });
    return this.unwrapResponse(res.data);
  }

  async prepareRequestUnlock(request: LiquidStakePrepareUnlockRequest): Promise<LiquidStakePrepareResponse> {
    const res = await this.http.post('/liquid-staking/prepare-request-unlock', {
      address: request.userAddress,
      sAvaxAmount: request.sAvaxAmount,
    });
    return this.unwrapResponse(res.data);
  }

  async prepareRedeem(request: LiquidStakePrepareRedeemRequest): Promise<LiquidStakePrepareResponse> {
    const res = await this.http.post('/liquid-staking/prepare-redeem', {
      address: request.userAddress,
      userUnlockIndex: request.userUnlockIndex,
    });
    return this.unwrapResponse(res.data);
  }

  private unwrapResponse(payload: any): LiquidStakePrepareResponse {
    if (payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object') {
      return payload.data as LiquidStakePrepareResponse;
    }
    return payload as LiquidStakePrepareResponse;
  }
}
