import { MetaAdapterResult } from './meta-adapter.port';

export interface MetaWriteObjectResult {
  id: string;
  configuredStatus?: string;
  effectiveStatus?: string;
}

export interface MetaWriteAdapterPort {
  enabled(): boolean;
  create(
    tenantId: string,
    credentialRef: string,
    edgePath: string,
    params: Record<string, string | number | boolean | object | unknown[]>,
  ): Promise<MetaAdapterResult<MetaWriteObjectResult>>;
  updateStatus(
    tenantId: string,
    credentialRef: string,
    externalObjectId: string,
    status: 'ACTIVE' | 'PAUSED',
  ): Promise<MetaAdapterResult<MetaWriteObjectResult>>;
  read(
    tenantId: string,
    credentialRef: string,
    externalObjectId: string,
    lifecycleObject?: boolean,
  ): Promise<MetaAdapterResult<MetaWriteObjectResult>>;
  searchCity(
    tenantId: string,
    credentialRef: string,
    city: string,
    countryCode: string,
  ): Promise<MetaAdapterResult<{ key: string; name: string }>>;
  createVideo(
    tenantId: string,
    credentialRef: string,
    adAccountId: string,
    fileUrl: string,
    title: string,
  ): Promise<MetaAdapterResult<MetaWriteObjectResult>>;
  readVideoStatus(
    tenantId: string,
    credentialRef: string,
    externalObjectId: string,
  ): Promise<MetaAdapterResult<{ id: string; videoStatus: string }>>;
}
