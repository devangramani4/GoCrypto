import type { EngineRunner } from '@gocrypto/matching-engine';
import type { OrderAdmissionService } from '@gocrypto/risk-engine';
import type { Core, EngineGateway } from '@gocrypto/server-core';

export interface ApiDeps {
  core: Core;
  engine: EngineGateway;
  admission: OrderAdmissionService;
  /** Present only when the matching engine runs inside the API process. */
  runner?: EngineRunner;
}
