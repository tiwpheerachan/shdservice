/**
 * Every family of operations, imported for the registrations it makes. A family missing here is
 * missing from the document — scripts/test-openapi.mts notices: its routes would be undocumented.
 */
import './jobs';
import './sales';
import './stock';
import './admin';
import './data';
import './misc';
import './audit';
import './track';
import './alerts';

export { registry } from './registry';
