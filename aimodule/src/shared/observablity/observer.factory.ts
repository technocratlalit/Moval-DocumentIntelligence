import { IObserverProvider } from './observer.interface.js';
import { PinoObserverProvider } from './provider/pino.js';
import { NewRelicObserverProvider } from './provider/newrelic.js';
import { CompositeObserverProvider } from './provider/composite.js';
import { _config } from '../../config/config.js';

/**
 * ObserverFactory — mirrors AIFactory / StorageFactory.
 *
 * Reads OBSERVABILITY_PROVIDER from config:
 *   'pino'     → Pino only (structured JSON logs)
 *   'newrelic' → New Relic only (APM + custom events)
 *   'both'     → Pino + New Relic
 *   'all'      → alias for 'both' (legacy)
 *   'signoz'   → alias for 'pino' (legacy — OTel removed)
 */
export class ObserverFactory {
  static getObserver(): IObserverProvider {
    const pino = new PinoObserverProvider();
    const nr = new NewRelicObserverProvider();

    switch (_config.OBSERVABILITY_PROVIDER) {
      case 'newrelic':
        return nr;
      case 'pino':
      case 'signoz':
        return pino;
      case 'both':
      case 'all':
        return new CompositeObserverProvider([pino, nr]);
      default:
        return nr;
    }
  }
}
