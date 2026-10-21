import { resolve } from 'node:path'
import { writeCadIntegrationSourceNotice } from '../../../build-support/cad-source-offer.mjs'

await writeCadIntegrationSourceNotice(resolve(import.meta.dirname, '..'))
